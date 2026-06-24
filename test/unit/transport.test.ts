import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  OneShotTransport,
  PtyTransport,
  RoleSplitTransport,
} from '../../src/adapters/pty-transport'
import { PtyAgentHost, resolvePtyCommand, type PtyModule } from '../../src/adapters/pty-agent-host'
import { BaseAgentHost, type AgentHostKind, type AgentRole } from '../../src/adapters/agent-host'
import { FileTransport } from '../../src/adapters/signal-transport'
import { AckStore } from '../../src/adapters/ack-store'
import { betweenPaths, ackPath } from '../../src/adapters/paths'
import type { Ack } from '../../src/core/types'
import { buildSignal } from '../../src/adapters/signal-transport'
import type { Signal, SignalTransport } from '../../src/core/types'
import type { AgentControl } from '../../src/adapters/agent-control'

let dir: string
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

class MemoryAgentHost extends BaseAgentHost {
  readonly kind: AgentHostKind = 'pipe'
  readonly delivered: string[] = []
  stops = 0

  constructor(role: AgentRole) {
    super(role, 20)
  }

  async start(): Promise<void> {
    this.markStart()
  }

  async deliver(body: string): Promise<void> {
    this.delivered.push(body)
  }

  resize(): void {}

  async stop(): Promise<void> {
    this.stops += 1
    this.markExit(null)
  }
}

class MemoryPtyAgentHost extends MemoryAgentHost {
  override readonly kind = 'pty' as const
  starts = 0

  override async start(): Promise<void> {
    this.starts += 1
    this.markStart()
  }
}

class RecordingTransport implements SignalTransport, AgentControl {
  readonly kind: string
  readonly sent: Signal[] = []
  readonly aborts: string[] = []
  readonly steers: string[] = []

  constructor(kind: string) {
    this.kind = kind
  }

  async send(signal: Signal): Promise<void> {
    this.sent.push(signal)
  }

  async pollAck(): Promise<Ack | null> {
    return null
  }

  async abortActive(reason: string): Promise<void> {
    this.aborts.push(reason)
  }

  async steerActive(goal: string): Promise<void> {
    this.steers.push(goal)
  }
}

describe('OneShotTransport / PtyTransport pollAck delegation (I7)', () => {
  it('wraps Windows PTY commands so PATH and cmd shims resolve', () => {
    const command = resolvePtyCommand(
      'C:\\repo',
      'node "C:\\repo with spaces\\agent.mjs"',
      'win32',
      'C:\\Windows\\System32\\cmd.exe',
    )

    expect(command).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/c', 'node', 'C:\\repo with spaces\\agent.mjs'],
    })
  })

  it('keeps non-Windows PTY commands direct', () => {
    expect(resolvePtyCommand('/repo', 'codex --help', 'linux')).toEqual({
      file: 'codex',
      args: ['--help'],
    })
  })

  it('uses the latest resize when a PTY host starts after layout measurement', async () => {
    dir = await mkdtemp(join(tmpdir(), 'between-pty-resize-'))
    const spawns: Array<{ cols?: number; rows?: number }> = []
    const fakePty: PtyModule = {
      spawn(_file, _args, opts) {
        spawns.push({ cols: opts.cols, rows: opts.rows })
        return {
          onData() {},
          onExit() {},
          write() {},
          resize() {},
          kill() {},
        }
      },
    }
    const host = new PtyAgentHost('developer', 10, {
      command: 'node -e ""',
      root: dir,
      cwd: dir,
      loadPty: async () => fakePty,
    })

    host.resize(42, 7)
    await host.start()

    expect(spawns).toEqual([{ cols: 42, rows: 7 }])
    await host.stop()
  })

  it('returns exactly what FileTransport returns for the same ack file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'between-tx-'))
    await mkdir(betweenPaths(dir).acks, { recursive: true })
    const ack: Ack = {
      signal_id: 'reviewer-0001-abcdef012345',
      target: 'reviewer',
      cycle: 1,
      diff_hash: 'abcdef012345deadbeef',
      acked_at: '2026-06-19T00:00:00.000Z',
    }
    await new AckStore(dir).write(ack)

    const oneshot = new OneShotTransport(dir, {
      developerCommand: 'x',
      reviewerCommand: 'x',
      cwd: dir,
    })
    const pty = new PtyTransport(dir, { hosts: {} })
    const file = new FileTransport(dir)

    const expected = await file.pollAck(ack.signal_id)
    expect(expected).not.toBeNull()
    expect(await oneshot.pollAck(ack.signal_id)).toEqual(expected)
    expect(await pty.pollAck(ack.signal_id)).toEqual(expected)
  })

  it('returns null for a missing ack', async () => {
    dir = await mkdtemp(join(tmpdir(), 'between-tx-'))
    const oneshot = new OneShotTransport(dir, {
      developerCommand: 'x',
      reviewerCommand: 'x',
      cwd: dir,
    })
    expect(await oneshot.pollAck('nope')).toBeNull()
    // sanity: ackPath is well-formed
    expect(ackPath(betweenPaths(dir), 'nope')).toContain('nope.json')
  })

  it('exposes a stable transport kind', () => {
    expect(
      new OneShotTransport('x', { developerCommand: 'a', reviewerCommand: 'b', cwd: 'x' }).kind,
    ).toBe('oneshot')
    expect(new PtyTransport('x', { hosts: {} }).kind).toBe('pty')
  })

  it('marks a stopped PTY host as not alive before a restart', async () => {
    dir = await mkdtemp(join(tmpdir(), 'between-pty-host-'))
    const host = new PtyAgentHost('reviewer', 10, {
      command: 'node -e ""',
      root: dir,
      cwd: dir,
    })
    host.markStart()

    await host.stop()

    expect(host.snapshot().alive).toBe(false)
    expect(host.snapshot().exited).toBe(true)
  })

  it('steers and aborts active hosted agents through the transport control port', async () => {
    dir = await mkdtemp(join(tmpdir(), 'between-agent-control-'))
    const host = new MemoryAgentHost('developer')
    host.markStart()
    const transport = new PtyTransport(dir, { hosts: { developer: host } })

    await transport.steerActive('ship safe goal')
    await transport.abortActive('user_requested')

    expect(host.delivered[0]).toContain('ship safe goal')
    expect(host.stops).toBe(1)
    const snap = host.snapshot()
    expect(snap.alive).toBe(false)
    expect(
      snap.lines.some((line) => line.includes('[between] steer requested: ship safe goal')),
    ).toBe(true)
    expect(
      snap.lines.some((line) => line.includes('[between] abort requested: user_requested')),
    ).toBe(true)
  })

  it('starts a standby reviewer PTY only when a broker review signal arrives', async () => {
    dir = await mkdtemp(join(tmpdir(), 'between-reviewer-signal-'))
    const host = new MemoryPtyAgentHost('reviewer')
    const transport = new PtyTransport(dir, { hosts: { reviewer: host } })

    expect(host.snapshot().alive).toBe(false)
    await transport.send(
      buildSignal('reviewer', 1, 'abcdef0123456789', 'Between signal: review requested.', 'now'),
    )

    expect(host.starts).toBe(1)
    expect(host.snapshot().alive).toBe(true)
    expect(host.delivered).toEqual(['Between signal: review requested.'])
  })

  it('routes developer signals to PTY and reviewer signals to one-shot transport', async () => {
    const developer = new RecordingTransport('pty')
    const reviewer = new RecordingTransport('oneshot')
    const split = new RoleSplitTransport(developer, reviewer)
    const devSignal = buildSignal('developer', 1, 'abc', 'dev', 'now')
    const reviewSignal = buildSignal('reviewer', 1, 'abc', 'review', 'now')

    await split.send(devSignal)
    await split.send(reviewSignal)
    await split.abortActive('user_requested')
    await split.steerActive('new goal')

    expect(developer.sent).toEqual([devSignal])
    expect(reviewer.sent).toEqual([reviewSignal])
    expect(developer.aborts).toEqual(['user_requested'])
    expect(reviewer.aborts).toEqual(['user_requested'])
    expect(developer.steers).toEqual(['new goal'])
    expect(reviewer.steers).toEqual(['new goal'])
  })
})
