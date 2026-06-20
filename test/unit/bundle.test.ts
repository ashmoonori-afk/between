import { describe, it, expect } from 'vitest'
import {
  buildBundle,
  verifyBundleIntegrity,
  BUNDLE_SCHEMA_VERSION,
  type ReviewBundleInput,
} from '../../src/review/bundle'
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

describe('verifyBundleIntegrity (finding #4)', () => {
  it('accepts a freshly built bundle', () => {
    expect(verifyBundleIntegrity(buildBundle(base)).ok).toBe(true)
  })

  it('rejects a bundle whose diff was edited after sealing (diff_hash mismatch)', () => {
    const b = buildBundle(base)
    const tampered = { ...b, diff: { ...b.diff, tracked: 'EVIL injected diff' } }
    const r = verifyBundleIntegrity(tampered)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/diff_hash/)
  })

  it('rejects a bundle whose provenance was edited but diff_hash left intact (bundle_id mismatch)', () => {
    const b = buildBundle(base)
    const tampered = { ...b, repository: { ...b.repository, head_sha: 'attacker-sha' } }
    const r = verifyBundleIntegrity(tampered)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/bundle_id/)
  })

  it('rejects a bundle with a forged-consistent diff_hash but stale bundle_id', () => {
    const b = buildBundle(base)
    // attacker swaps the diff AND recomputes diff_hash to match, but cannot silently keep bundle_id
    const evilDiff = { ...b.diff, tracked: 'EVIL' }
    const tampered = { ...b, diff: evilDiff, diff_hash: hashDiff(evilDiff) }
    expect(verifyBundleIntegrity(tampered).ok).toBe(false) // bundle_id no longer matches
  })

  it('rejects a bundle whose sealed payload was edited after sealing', () => {
    const b = buildBundle({
      ...base,
      diff: { ...base.diff, untracked: [{ path: 'note.bin', oid: 'oid1' }] },
      payloads: [
        {
          path: 'note.bin',
          oid: 'oid1',
          size: 3,
          encoding: 'base64',
          content: Buffer.from([1, 2, 3]).toString('base64'),
        },
      ],
    })
    const tampered = {
      ...b,
      payloads: [{ ...b.payloads[0]!, content: Buffer.from([1, 2, 4]).toString('base64') }],
    }
    const r = verifyBundleIntegrity(tampered)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/bundle_id/)
  })

  it('reports malformed input as not-ok instead of throwing', () => {
    expect(verifyBundleIntegrity({} as never).ok).toBe(false)
  })

  it('rejects an in-place schema_version downgrade (review)', () => {
    const b = buildBundle(base)
    const r = verifyBundleIntegrity({ ...b, schema_version: 1 })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/schema_version/)
  })
})
