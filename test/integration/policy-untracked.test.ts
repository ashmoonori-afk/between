import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '../../src/core/clock'
import { initialState } from '../../src/core/state'
import { StateRepository } from '../../src/adapters/state-repository'
import { betweenPaths, reviewPath, verifyPath } from '../../src/adapters/paths'
import { buildBundle, type BundlePayload } from '../../src/review/bundle'
import { writeBundle } from '../../src/review/store'
import { evaluateCyclePolicy } from '../../src/policy/gate'
import { collectEvidence } from '../../src/evidence/collect'
import { collectCockpitData } from '../../src/ui/cockpit'
import { DEFAULT_POLICY } from '../../src/policy/schema'
import type { DiffInput } from '../../src/core/types'
import type { CommandRunner } from '../../src/verify/runner'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-untracked-policy-'))
  const paths = betweenPaths(dir)
  await mkdir(paths.reviews, { recursive: true })
  await mkdir(paths.verify, { recursive: true })
  const state = initialState(
    { project: { name: 'untracked', root: dir, obsidian_project_path: null } },
    new FakeClock(0),
  )
  await new StateRepository(dir).write({ ...state, workflow: { ...state.workflow, cycle: 1 } })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})
const auditRunner =
  (total: number): CommandRunner =>
  async () => ({
    exitCode: total === 0 ? 0 : 1,
    stdout: JSON.stringify({ metadata: { vulnerabilities: { total } } }),
    stderr: '',
  })

function payload(path: string, content: string | Buffer): BundlePayload {
  const bytes = Buffer.from(content)
  const oid = createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex')
  return {
    path,
    oid,
    size: bytes.byteLength,
    encoding: 'base64',
    content: bytes.toString('base64'),
  }
}

async function pinBundle(diff: DiffInput, payloads: BundlePayload[]) {
  const bundle = buildBundle({
    diff,
    payloads,
    repository: { head_sha: 'a'.repeat(40), branch: 'main', index_tree: 't' },
    environment: { between_version: '0.1.0', git_version: 'git', attributes_hash: '' },
  })
  await writeBundle(dir, bundle)
  const previous = await new StateRepository(dir).read()
  if (!previous) throw new Error('test state missing')
  const state = {
    ...previous,
    diff: { ...previous.diff, bundle_id: bundle.bundle_id, hash: bundle.diff_hash },
  }
  await new StateRepository(dir).write(state)
  const p = betweenPaths(dir)
  await writeFile(
    reviewPath(p, 1),
    JSON.stringify({ cycle: 1, diff_hash: bundle.diff_hash, findings: [], complete: true }),
  )
  await writeFile(
    verifyPath(p, 1),
    JSON.stringify({ diff_hash: bundle.diff_hash, passed: true, summary: 'ok' }),
  )
  expect((await collectEvidence(dir, new FakeClock(0).nowIso(), state))?.verify?.passed).toBe(true)
  return state
}

describe('untracked bundle policy inputs', () => {
  it.each([true, false])(
    'classifies high-risk untracked paths with captured content=%s',
    async (captured) => {
      const clean = payload('src/auth/x.ts', 'export const ok = true')
      const state = await pinBundle(
        { tracked: '', trackedRaw: '', untracked: [{ path: clean.path, oid: clean.oid }] },
        captured ? [clean] : [],
      )
      const run = vi.fn(auditRunner(0))
      const gate = await evaluateCyclePolicy(dir, state, new FakeClock(0).nowIso(), run)
      const cockpit = await collectCockpitData(dir, new FakeClock(0).nowIso())
      expect(gate.evaluation.risk).toBe('high')
      expect(gate.evaluation.requiredApprovals).toEqual(DEFAULT_POLICY.approvals.high)
      expect(run).toHaveBeenCalledTimes(1)
      expect(cockpit?.risk).toBe('high')
      const expected = captured ? 'pass' : 'fail'
      expect(gate.evaluation.gates.find((g) => g.name === 'secret_scan')?.status).toBe(expected)
      expect(cockpit?.gates.find((g) => g.name === 'secret_scan')?.status).toBe(expected)
      expect(gate.evaluation.satisfied).toBe(captured)
    },
  )

  it.each([
    {
      name: 'opaque introduced secret',
      text: 'const key = "AKIAIOSFODNN7EXAMPLE"',
      status: 'fail',
    },
    { name: 'closest clean content', text: 'const key = "public-value"', status: 'pass' },
    { name: 'literal ++ beginning', text: '++AKIAIOSFODNN7EXAMPLE', status: 'fail' },
    { name: 'empty content', text: '', status: 'pass' },
  ])('scans untracked text: $name', async ({ text, status }) => {
    const introduced = payload('src/auth/x.ts', text)
    const state = await pinBundle(
      {
        tracked: '',
        trackedRaw: ':100644 100644 a b M\tsrc/auth/tracked.ts',
        untracked: [{ path: introduced.path, oid: introduced.oid }],
      },
      [introduced],
    )
    const gate = await evaluateCyclePolicy(dir, state, new FakeClock(0).nowIso(), auditRunner(0))
    const cockpit = await collectCockpitData(dir, new FakeClock(0).nowIso())
    expect(gate.evaluation.gates.find((g) => g.name === 'secret_scan')?.status).toBe(status)
    expect(cockpit?.gates.find((g) => g.name === 'secret_scan')?.status).toBe(status)
  })

  it.each(['matching', 'wrong-path', 'wrong-oid', 'omitted'])(
    'requires captured content identity: %s',
    async (kind) => {
      const clean = payload('src/auth/x.ts', 'public-value')
      const supplied =
        kind === 'omitted'
          ? []
          : [
              {
                ...clean,
                path: kind === 'wrong-path' ? 'src/auth/other.ts' : clean.path,
                oid: kind === 'wrong-oid' ? 'f'.repeat(40) : clean.oid,
              },
            ]
      const state = await pinBundle(
        {
          tracked: '',
          trackedRaw: ':100644 100644 a b M\tsrc/auth/tracked.ts',
          untracked: [{ path: clean.path, oid: clean.oid }],
        },
        supplied,
      )
      const gate = await evaluateCyclePolicy(dir, state, new FakeClock(0).nowIso(), auditRunner(0))
      const cockpit = await collectCockpitData(dir, new FakeClock(0).nowIso())
      const expected = kind === 'matching' ? 'pass' : 'fail'
      expect(gate.evaluation.gates.find((g) => g.name === 'secret_scan')?.status).toBe(expected)
      expect(cockpit?.gates.find((g) => g.name === 'secret_scan')?.status).toBe(expected)
    },
  )

  it.each([Buffer.from([0, 65]), Buffer.from([255]), Buffer.from('\uFFFD')])(
    'preserves captured non-text scope (%j)',
    async (bytes) => {
      const binary = payload('src/auth/x.ts', bytes)
      const state = await pinBundle(
        {
          tracked: '',
          trackedRaw: ':100644 100644 a b M\tsrc/auth/tracked.ts',
          untracked: [{ path: binary.path, oid: binary.oid }],
        },
        [binary],
      )
      const gate = await evaluateCyclePolicy(dir, state, new FakeClock(0).nowIso(), auditRunner(0))
      expect(gate.evaluation.gates.find((g) => g.name === 'secret_scan')?.status).toBe('pass')
    },
  )

  it.each([true, false])(
    'enforces only configured normal-risk scanning: enabled=%s',
    async (enabled) => {
      const normal = payload('src/feature.ts', 'AKIAIOSFODNN7EXAMPLE')
      await writeFile(
        join(betweenPaths(dir).dir, 'policy.yaml'),
        JSON.stringify({
          ...DEFAULT_POLICY,
          gates: {
            ...DEFAULT_POLICY.gates,
            normal: enabled ? ['verification', 'secret_scan'] : DEFAULT_POLICY.gates.normal,
          },
        }),
      )
      const state = await pinBundle(
        { tracked: '', trackedRaw: '', untracked: [{ path: normal.path, oid: normal.oid }] },
        [normal],
      )
      const run = vi.fn(auditRunner(0))
      const gate = await evaluateCyclePolicy(dir, state, new FakeClock(0).nowIso(), run)
      expect(gate.evaluation.risk).toBe('normal')
      expect(gate.evaluation.satisfied).toBe(!enabled)
      expect(run).not.toHaveBeenCalled()
    },
  )

  it('ignores unrelated payloads and never assembles tokens across files', async () => {
    const a = payload('src/auth/a.ts', 'AKIAIOSFOD')
    const b = payload('src/auth/b.ts', 'NN7EXAMPLE')
    const unrelated = payload('src/auth/unused.ts', 'AKIAIOSFODNN7EXAMPLE')
    const state = await pinBundle(
      {
        tracked: '',
        trackedRaw: ':100644 100644 a b M\tsrc/auth/tracked.ts',
        untracked: [a, b].map(({ path, oid }) => ({ path, oid })),
      },
      [a, b, unrelated],
    )
    const gate = await evaluateCyclePolicy(dir, state, new FakeClock(0).nowIso(), auditRunner(0))
    expect(gate.evaluation.gates.find((g) => g.name === 'secret_scan')?.status).toBe('pass')
  })
})
