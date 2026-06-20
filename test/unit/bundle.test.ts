import { describe, it, expect } from 'vitest'
import { buildBundle, BUNDLE_SCHEMA_VERSION, type ReviewBundleInput } from '../../src/review/bundle'
import { hashDiff } from '../../src/core/diff-hash'

const base: ReviewBundleInput = {
  diff: {
    tracked: 'diff --git a/x b/x\n+hi',
    trackedRaw: ':100644 100644 a b M\tx',
    untracked: [],
  },
  repository: { head_sha: 'abc', branch: 'main', index_tree: 'tree1' },
  environment: { between_version: '0.1.0', git_version: 'git 2.40', attributes_hash: '' },
}

describe('buildBundle', () => {
  it('is deterministic and content-addressed', () => {
    const a = buildBundle(base)
    const b = buildBundle(base)
    expect(a.bundle_id).toBe(b.bundle_id)
    expect(a.schema_version).toBe(BUNDLE_SCHEMA_VERSION)
    expect(a.bundle_id).toMatch(/^[a-f0-9]{64}$/)
  })

  it('diff_hash equals the canonical core hash (approved == bundled invariant)', () => {
    expect(buildBundle(base).diff_hash).toBe(hashDiff(base.diff))
  })

  it('changing repo/env provenance changes bundle_id but NOT diff_hash', () => {
    const a = buildBundle(base)
    const b = buildBundle({ ...base, repository: { ...base.repository, head_sha: 'different' } })
    expect(b.diff_hash).toBe(a.diff_hash) // same change content
    expect(b.bundle_id).not.toBe(a.bundle_id) // different provenance
  })

  it('changing the diff content changes both hashes', () => {
    const a = buildBundle(base)
    const b = buildBundle({ ...base, diff: { ...base.diff, tracked: 'totally different' } })
    expect(b.diff_hash).not.toBe(a.diff_hash)
    expect(b.bundle_id).not.toBe(a.bundle_id)
  })

  it('carries the full diff content so a reviewer can read it from the bundle', () => {
    const a = buildBundle(base)
    expect(a.diff.tracked).toContain('+hi')
    expect(a.diff.trackedRaw).toContain('M\tx')
  })
})
