import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '../../src/core/clock'
import { initProject } from '../../src/adapters/init-project'
import { buildDaemon } from '../../src/runtime'
import { CommandBus } from '../../src/adapters/command-bus'
import { AckStore } from '../../src/adapters/ack-store'
import { StateRepository } from '../../src/adapters/state-repository'
import { EventsLog } from '../../src/adapters/events-log'
import { buildSignal } from '../../src/adapters/signal-transport'
import { signApproval } from '../../src/core/approval'
import { resolveApprovalSecret } from '../../src/adapters/approval-secret'
import {
  betweenPaths,
  reviewPath,
  verifyPath,
  signalPath,
  snapshotPath,
} from '../../src/adapters/paths'
import type { Ack } from '../../src/core/types'

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
  const sig = signApproval(resolveApprovalSecret(dir), {
    scope,
    diff_hash: st?.diff.hash ?? null,
    cycle: st?.workflow.cycle ?? 0,
  })
  await new CommandBus(dir).submit({ kind: 'approve', scope, sig })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-it-'))
  await git(['init', '-b', 'main'])
  await git(['config', 'user.email', 't@example.com'])
  await git(['config', 'user.name', 'Tester'])
  await writeFile(join(dir, 'app.txt'), 'v1\n')
  await git(['add', '-A'])
  await git(['commit', '-m', 'init'])
})

afterEach(async () => {
  try {
    await rm(dir, { recursive: true, force: true })
  } catch {
    // Windows can hold a handle briefly after a git child exits — cleanup is best-effort
  }
})

describe('headless walking skeleton (M3)', () => {
  it(
    'drives edit -> debounce -> review_requested -> ack -> review -> human_gate, and survives restart',
    async () => {
      const fc = new FakeClock(Date.UTC(2026, 5, 19, 0, 0, 0))
      await initProject(dir, {}, fc)
      const d = await buildDaemon(dir, fc)
      await d.load()

      const bus = new CommandBus(dir)
      const events = new EventsLog(dir)
      const p = betweenPaths(dir)

      // lock a goal; one tick drains the goal (idle->goal_locked) and advances to developing
      await bus.submit({ kind: 'goal', goal: 'ship the broker' })
      await d.tick()
      expect(d.state.workflow.phase).toBe('developing')

      // §15.4: a tracked change is detected within one interval
      await writeFile(join(dir, 'app.txt'), 'v2 changed by developer\n')
      await d.tick()
      expect(d.state.workflow.phase).toBe('debouncing')

      // §15.5: not reviewed until the debounce window elapses
      await d.tick()
      expect(d.state.workflow.phase).toBe('debouncing')
      fc.advance(26_000)
      await d.tick()
      expect(d.state.workflow.phase).toBe('review_requested')
      expect(d.state.workflow.cycle).toBe(1)
      const hash = d.state.diff.hash
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
      expect(existsSync(signalPath(p, 'reviewer'))).toBe(true)
      expect(existsSync(snapshotPath(p, 1))).toBe(true)

      // I7: reviewing is gated on a real ack (no ack -> stays put)
      await d.tick()
      expect(d.state.workflow.phase).toBe('review_requested')
      await ackCurrent(1, hash!, fc)
      await d.tick()
      expect(d.state.workflow.phase).toBe('reviewing')

      // reviewer writes a clean structured review + a passing verify
      await writeFile(
        reviewPath(p, 1),
        JSON.stringify({ cycle: 1, diff_hash: hash, findings: [], complete: true }),
      )
      await writeFile(
        verifyPath(p, 1),
        JSON.stringify({ diff_hash: hash, passed: true, summary: 'ok' }),
      )
      await d.tick()
      expect(d.state.workflow.phase).toBe('review_written')
      await d.tick()
      expect(d.state.workflow.phase).toBe('human_gate')
      // hash is committed as reviewed only when the cycle completes (verify_passed -> human_gate)
      expect(d.state.workflow.reviewed_hashes).toContain(hash)

      // §15.8: every transition is logged
      const names = (await events.read()).map((e) => e.event)
      for (const expected of [
        'goal_locked',
        'diff_detected',
        'diff_stable',
        'signal_sent',
        'review_acked',
        'review_written',
        'verify_passed',
      ]) {
        expect(names).toContain(expected)
      }

      // restart recovery (§3.9, I2): a fresh daemon reloads the persisted phase
      const d2 = await buildDaemon(dir, fc)
      await d2.load()
      expect(d2.state.workflow.phase).toBe('human_gate')

      // human approves the merge -> done
      await signedApprove('merge')
      await d2.tick()
      expect(d2.state.workflow.phase).toBe('done')
      expect(d2.state.approval?.scope).toBe('merge')
    },
    INTEGRATION_TIMEOUT_MS,
  )

  it(
    '§15.6: the same diff hash does not trigger a repeated review',
    async () => {
      const fc = new FakeClock(Date.UTC(2026, 5, 19, 0, 0, 0))
      await initProject(dir, {}, fc)
      const d = await buildDaemon(dir, fc)
      await d.load()
      const bus = new CommandBus(dir)
      const p = betweenPaths(dir)

      await bus.submit({ kind: 'goal', goal: 'g' })
      await d.tick() // -> developing
      await writeFile(join(dir, 'app.txt'), 'edited\n')
      await d.tick() // -> debouncing
      fc.advance(26_000)
      await d.tick() // -> review_requested, cycle 1
      expect(d.state.workflow.cycle).toBe(1)
      const hash = d.state.diff.hash!

      await ackCurrent(1, hash, fc)
      await d.tick() // -> reviewing
      await writeFile(
        reviewPath(p, 1),
        JSON.stringify({ cycle: 1, diff_hash: hash, findings: [], complete: true }),
      )
      await writeFile(
        verifyPath(p, 1),
        JSON.stringify({ diff_hash: hash, passed: true, summary: 'ok' }),
      )
      await d.tick() // -> review_written (records reviewed hash)
      await d.tick() // -> human_gate
      await signedApprove('merge')
      await d.tick() // -> done

      // start another goal with the file UNCHANGED -> same hash -> no new cycle
      await bus.submit({ kind: 'goal', goal: 'g2' })
      await d.tick() // done -> developing (goal reset)
      expect(d.state.workflow.phase).toBe('developing')
      fc.advance(60_000)
      await d.tick() // watch: hash already reviewed -> no new cycle
      expect(d.state.workflow.phase).toBe('developing')
      expect(d.state.workflow.cycle).toBe(1)
    },
    INTEGRATION_TIMEOUT_MS,
  )
})
