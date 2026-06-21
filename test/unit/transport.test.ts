import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OneShotTransport, PtyTransport } from '../../src/adapters/pty-transport'
import { PtyAgentHost } from '../../src/adapters/pty-agent-host'
import { BaseAgentHost, type AgentHostKind, type AgentRole } from '../../src/adapters/agent-host'
import { FileTransport } from '../../src/adapters/signal-transport'
import { AckStore } from '../../src/adapters/ack-store'
import { betweenPaths, ackPath } from '../../src/adapters/paths'
import type { Ack } from '../../src/core/types'

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

describe('OneShotTransport / PtyTransport pollAck delegation (I7)', () => {
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
})
