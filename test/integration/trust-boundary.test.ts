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
import { reviewPath, verifyPath, betweenPaths } from '../../src/adapters/paths'
import { signApproval, approvalExpiry } from '../../src/core/approval'
import { resolveApprovalSecret } from '../../src/adapters/approval-secret'

let dir: string
const INTEGRATION_TIMEOUT_MS = 90_000

async function git(args: string[]): Promise<void> {
  await execa('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir })
}

/** Drive a fresh repo all the way to human_gate (cycle 1) and return the reviewed hash. */
async function toHumanGate(d: Awaited<ReturnType<typeof buildDaemon>>, fc: FakeClock) {
  const bus = new CommandBus(dir)
  const p = betweenPaths(dir)
  await bus.submit({ kind: 'goal', goal: 'g' })
  await d.tick() // developing
  await writeFile(join(dir, 'app.txt'), 'v2\n')
  await d.tick() // debouncing
  fc.advance(26_000)
  await d.tick() // review_requested
  const hash = d.state.diff.hash!
  const id = buildSignal('reviewer', 1, hash, '', '').id
  await new AckStore(dir).write({
    signal_id: id,
    target: 'reviewer',
    cycle: 1,
    diff_hash: hash,
    acked_at: fc.nowIso(),
  })
  await d.tick() // reviewing
  await writeFile(
    reviewPath(p, 1),
    JSON.stringify({ cycle: 1, diff_hash: hash, findings: [], complete: true }),
  )
  await writeFile(
    verifyPath(p, 1),
    JSON.stringify({ diff_hash: hash, passed: true, summary: 'ok' }),
  )
  await d.tick() // review_written
  await d.tick() // human_gate
  return hash
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-trust-'))
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
    /* best-effort */
  }
})

describe('approval trust boundary (P1-5)', () => {
  it(
    'rejects a forged (unsigned / bad-sig) approve and accepts a valid signed one',
    async () => {
      const fc = new FakeClock(Date.UTC(2026, 5, 19, 0, 0, 0))
      await initProject(dir, {}, fc) // provisions the .git approval secret
      const d = await buildDaemon(dir, fc)
      await d.load()
      const hash = await toHumanGate(d, fc)
      expect(d.state.workflow.phase).toBe('human_gate')

      const bus = new CommandBus(dir)

      // forged: unsigned approve -> rejected, stays at the gate
      await bus.submit({ kind: 'approve', scope: 'merge' })
      await d.tick()
      expect(d.state.workflow.phase).toBe('human_gate')

      // forged: invalid signature -> rejected
      await bus.submit({ kind: 'approve', scope: 'merge', sig: 'not-a-real-signature' })
      await d.tick()
      expect(d.state.workflow.phase).toBe('human_gate')

      const rejects = (await new EventsLog(dir).read()).filter(
        (e) => e.event === 'approval_rejected',
      )
      expect(rejects.length).toBeGreaterThanOrEqual(2)

      // valid: a signature from the provisioned secret -> approved (F1: signs bundle + expiry too)
      const secret = resolveApprovalSecret(dir)
      expect(secret).not.toBe('')
      const bundleId = d.state.diff.bundle_id
      const expiresAt = approvalExpiry(Date.now())
      const sig = signApproval(secret, {
        scope: 'merge',
        diff_hash: hash,
        cycle: 1,
        bundle_id: bundleId,
        expires_at: expiresAt,
      })
      await bus.submit({
        kind: 'approve',
        scope: 'merge',
        sig,
        bundle_id: bundleId,
        expires_at: expiresAt,
      })
      await d.tick()
      expect(d.state.workflow.phase).toBe('done')
      expect(d.state.approval?.scope).toBe('merge')
      expect(d.state.approval?.sig).toBe(sig)

      // the recorded token verifies independently (what `verify-push` / the pre-push hook checks)
      const persisted = await new StateRepository(dir).read()
      expect(persisted?.approval?.sig).toBe(sig)
    },
    INTEGRATION_TIMEOUT_MS,
  )
})
