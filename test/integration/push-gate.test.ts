import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '../../src/core/clock'
import { initProject } from '../../src/adapters/init-project'
import { signApproval, approvalExpiry } from '../../src/core/approval'

let dir: string
let key: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-pushgate-'))
  await execa('git', ['init', '-q'], { cwd: dir })
  await execa('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
  await execa('git', ['config', 'user.name', 't'], { cwd: dir })
  // a real preset so evidence_trust is 'real' (a simulation would be blocked first)
  await initProject(dir, { developer: 'claude', reviewer: 'codex' }, new FakeClock(0))
  key = (await readFile(join(dir, '.git', 'between-approval.key'), 'utf8')).trim()
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

/** Write a state.json whose approval is signed for the given scope over the FULL F1 claim. */
async function writeState(over: {
  scope: 'merge' | 'deploy' | 'promote_rule'
  stateHash?: string
  tamperBundle?: boolean
  expired?: boolean
}): Promise<void> {
  const diffHash = 'X'
  const bundleId = 'B'
  const expiresAt = over.expired ? approvalExpiry(-3_600_000) : approvalExpiry(Date.now())
  const sig = signApproval(key, {
    scope: over.scope,
    diff_hash: diffHash,
    cycle: 1,
    bundle_id: bundleId,
    expires_at: expiresAt,
  })
  const state = {
    workflow: { phase: 'done', cycle: 1 },
    diff: { hash: over.stateHash ?? diffHash, bundle_id: bundleId },
    evidence_trust: 'real',
    approval: {
      scope: over.scope,
      diff_hash: diffHash,
      cycle: 1,
      bundle_id: over.tamperBundle ? 'TAMPERED' : bundleId,
      expires_at: expiresAt,
      sig,
    },
  }
  await writeFile(join(dir, '.between', 'state.json'), JSON.stringify(state, null, 2))
}

async function runGate(): Promise<{ code: number; stderr: string }> {
  const r = await execa('node', ['.git/between-verify-push.mjs'], { cwd: dir, reject: false })
  return { code: r.exitCode ?? 0, stderr: r.stderr }
}

describe('pre-push gate (F1 + F2 regressions)', () => {
  it('allows a fresh, signed MERGE approval', async () => {
    await writeState({ scope: 'merge' })
    expect((await runGate()).code).toBe(0)
  })

  it('F2: refuses a signed DEPLOY approval (only merge authorizes a push)', async () => {
    await writeState({ scope: 'deploy' })
    const { code, stderr } = await runGate()
    expect(code).toBe(1)
    expect(stderr).toMatch(/only a merge approval/)
  })

  it('F2: refuses a signed PROMOTE_RULE approval', async () => {
    await writeState({ scope: 'promote_rule' })
    expect((await runGate()).code).toBe(1)
  })

  it('F1: refuses a merge approval whose bundle_id was tampered after signing', async () => {
    await writeState({ scope: 'merge', tamperBundle: true })
    const { code, stderr } = await runGate()
    expect(code).toBe(1)
    expect(stderr).toMatch(/signature verification/)
  })

  it('A2: refuses a merge approval once the current diff moved on', async () => {
    await writeState({ scope: 'merge', stateHash: 'Y' }) // current diff != approved diff
    expect((await runGate()).code).toBe(1)
  })

  it('A2: refuses an expired merge approval', async () => {
    await writeState({ scope: 'merge', expired: true })
    expect((await runGate()).code).toBe(1)
  })
})
