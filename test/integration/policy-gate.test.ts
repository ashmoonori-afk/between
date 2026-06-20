import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '../../src/core/clock'
import { initialState } from '../../src/core/state'
import { StateRepository } from '../../src/adapters/state-repository'
import { betweenPaths, reviewPath, verifyPath } from '../../src/adapters/paths'
import { buildBundle } from '../../src/review/bundle'
import { writeBundle, bundlePath } from '../../src/review/store'
import { evaluateCyclePolicy } from '../../src/policy/gate'
import type { CommandRunner } from '../../src/verify/runner'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-pgate-'))
  const p = betweenPaths(dir)
  await mkdir(p.reviews, { recursive: true })
  await mkdir(p.verify, { recursive: true })

  // a HIGH-risk change (src/auth/**) so the default gate set includes dependency_audit.
  const bundle = buildBundle({
    diff: {
      tracked: 'diff --git a/src/auth/login.ts b/src/auth/login.ts\n+const ok = true',
      trackedRaw: ':100644 100644 a b M\tsrc/auth/login.ts',
      untracked: [],
    },
    repository: { head_sha: 'a'.repeat(40), branch: 'main', index_tree: 't' },
    environment: { between_version: '0.1.0', git_version: 'git', attributes_hash: '' },
  })
  await writeBundle(dir, bundle)

  let state = initialState(
    { project: { name: 'pg', root: dir, obsidian_project_path: null } },
    new FakeClock(0),
  )
  state = {
    ...state,
    workflow: { ...state.workflow, cycle: 1 },
    diff: { ...state.diff, bundle_id: bundle.bundle_id, hash: bundle.diff_hash },
  }
  await new StateRepository(dir).write(state)
  // a clean review + passing verify so only secret_scan / dependency_audit can decide the outcome.
  await writeFile(
    reviewPath(p, 1),
    JSON.stringify({ cycle: 1, diff_hash: bundle.diff_hash, findings: [], complete: true }),
  )
  await writeFile(
    verifyPath(p, 1),
    JSON.stringify({ diff_hash: bundle.diff_hash, passed: true, summary: 'ok' }),
  )
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

const auditRunner =
  (total: number): CommandRunner =>
  async () => ({
    exitCode: total === 0 ? 0 : 1,
    stdout: JSON.stringify({ metadata: { vulnerabilities: { total } } }),
    stderr: '',
  })

describe('evaluateCyclePolicy (#5 lifecycle gate, injected dep-audit runner)', () => {
  it('high-risk + clean audit -> SATISFIED (runner is injected, never spawns npm)', async () => {
    const state = (await new StateRepository(dir).read())!
    const gate = await evaluateCyclePolicy(dir, state, new FakeClock(0).nowIso(), auditRunner(0))
    expect(gate.evaluation.risk).toBe('high')
    expect(gate.evaluation.satisfied).toBe(true)
    expect(gate.reason).toBe('')
  })

  it('a dependency vulnerability fails the gate with a clear reason', async () => {
    const state = (await new StateRepository(dir).read())!
    const gate = await evaluateCyclePolicy(dir, state, new FakeClock(0).nowIso(), auditRunner(3))
    expect(gate.evaluation.satisfied).toBe(false)
    expect(gate.reason).toMatch(/dependency_audit/)
  })

  it('fails CLOSED when the pinned bundle file is missing/deleted (review HIGH fail-open)', async () => {
    const state = (await new StateRepository(dir).read())!
    // delete the bundle file while state still pins its id -> content is unverifiable
    await rm(bundlePath(dir, state.diff.bundle_id!), { force: true })
    await expect(
      evaluateCyclePolicy(dir, state, new FakeClock(0).nowIso(), auditRunner(0)),
    ).rejects.toThrow(/missing or unreadable/)
  })
})
