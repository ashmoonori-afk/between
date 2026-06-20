import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '../../src/core/clock'
import { initProject } from '../../src/adapters/init-project'
import { buildDaemon } from '../../src/runtime'
import { CommandBus } from '../../src/adapters/command-bus'
import { AckStore } from '../../src/adapters/ack-store'
import { EventsLog } from '../../src/adapters/events-log'
import { StateRepository } from '../../src/adapters/state-repository'
import { buildSignal } from '../../src/adapters/signal-transport'
import { betweenPaths, reviewPath, verifyPath } from '../../src/adapters/paths'
import { signApproval, approvalExpiry } from '../../src/core/approval'
import { resolveApprovalSecret } from '../../src/adapters/approval-secret'
import { replayStateFromEvents, ReplayError } from '../../src/core/replay'
import type { Ack, BetweenState } from '../../src/core/types'

let dir: string
const INTEGRATION_TIMEOUT_MS = 90_000

async function git(args: string[]): Promise<void> {
  await execa('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir })
}

async function ackCurrent(cycle: number, hash: string, fc: FakeClock): Promise<void> {
  const id = buildSignal('reviewer', cycle, hash, '', '').id
  const ack: Ack = {
    signal_id: id,
    target: 'reviewer',
    cycle,
    diff_hash: hash,
    acked_at: fc.nowIso(),
  }
  await new AckStore(dir).write(ack)
}

async function signedApprove(scope: 'merge' | 'deploy' | 'promote_rule'): Promise<void> {
  const st = await new StateRepository(dir).read()
  const bundleId = st?.diff.bundle_id ?? null
  const expiresAt = approvalExpiry(Date.now())
  const sig = signApproval(resolveApprovalSecret(dir), {
    scope,
    diff_hash: st?.diff.hash ?? null,
    cycle: st?.workflow.cycle ?? 0,
    bundle_id: bundleId,
    expires_at: expiresAt,
  })
  await new CommandBus(dir).submit({
    kind: 'approve',
    scope,
    sig,
    bundle_id: bundleId,
    expires_at: expiresAt,
  })
}

async function completedCycle(fc: FakeClock): Promise<BetweenState> {
  await initProject(dir, {}, fc)
  const daemon = await buildDaemon(dir, fc)
  await daemon.load()
  const bus = new CommandBus(dir)
  const paths = betweenPaths(dir)

  await bus.submit({ kind: 'goal', goal: 'ship replay' })
  await daemon.tick()
  await writeFile(join(dir, 'app.txt'), 'v2 replayable change\n')
  await daemon.tick()
  fc.advance(26_000)
  await daemon.tick()
  const hash = daemon.state.diff.hash
  if (!hash) throw new Error('expected cycle diff hash')

  await ackCurrent(1, hash, fc)
  await daemon.tick()
  await writeFile(
    reviewPath(paths, 1),
    JSON.stringify({ cycle: 1, diff_hash: hash, findings: [], complete: true }),
  )
  await writeFile(
    verifyPath(paths, 1),
    JSON.stringify({ diff_hash: hash, passed: true, summary: 'ok' }),
  )
  await daemon.tick()
  await daemon.tick()
  await signedApprove('merge')
  await daemon.tick()

  const current = await new StateRepository(dir).read()
  if (!current) throw new Error('expected completed state')
  return current
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-replay-'))
  await git(['init', '-b', 'main'])
  await git(['config', 'user.email', 't@example.com'])
  await git(['config', 'user.name', 'Tester'])
  await writeFile(join(dir, 'app.txt'), 'v1\n')
  await git(['add', '-A'])
  await git(['commit', '-m', 'init'])
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

describe('exact journal replay (B5)', () => {
  it(
    'reconstructs the final state from verified events after state.json is deleted',
    async () => {
      const fc = new FakeClock(Date.UTC(2026, 5, 20, 0, 0, 0))
      const original = await completedCycle(fc)
      const eventsLog = new EventsLog(dir)
      const entries = await eventsLog.read()
      const replayed = replayStateFromEvents(entries, original.journal)

      await rm(betweenPaths(dir).state, { force: true })
      const recovered = await buildDaemon(dir, fc)
      await recovered.load()

      expect(replayed.workflow.phase).toBe(original.workflow.phase)
      expect(replayed.workflow.cycle).toBe(original.workflow.cycle)
      expect(replayed.diff).toEqual(original.diff)
      expect(replayed.approval).toEqual(original.approval)
      expect(replayed.journal).toEqual(original.journal)
      expect(recovered.state.workflow.phase).toBe(original.workflow.phase)
      expect(recovered.state.workflow.cycle).toBe(original.workflow.cycle)
      expect(recovered.state.diff).toEqual(original.diff)
      expect(recovered.state.approval).toEqual(original.approval)
    },
    INTEGRATION_TIMEOUT_MS,
  )

  it(
    'refuses a tail-truncated journal when a pinned head exists',
    async () => {
      const fc = new FakeClock(Date.UTC(2026, 5, 20, 0, 0, 0))
      const original = await completedCycle(fc)
      const entries = await new EventsLog(dir).read()

      expect(() => replayStateFromEvents(entries.slice(0, 2), original.journal)).toThrow(
        ReplayError,
      )
      expect(() => replayStateFromEvents(entries.slice(0, 2), original.journal)).toThrow(
        /journal TAMPERED/,
      )
    },
    INTEGRATION_TIMEOUT_MS,
  )
})
