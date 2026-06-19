import { describe, it, expect } from 'vitest'
import { hashDiff, canonicalDiffPayload, isEmptyDiff } from '../../src/core/diff-hash'
import type { DiffInput } from '../../src/core/types'

const base: DiffInput = {
  tracked: 'diff --git a/x b/x\n+hello',
  trackedRaw: ':100644 100644 aaa bbb M\tx',
  untracked: [],
}

describe('diff-hash', () => {
  it('is deterministic for identical input', () => {
    expect(hashDiff(base)).toBe(hashDiff({ ...base }))
  })

  it('changes when tracked content changes', () => {
    expect(hashDiff(base)).not.toBe(hashDiff({ ...base, tracked: base.tracked + '\n+world' }))
  })

  it('is independent of untracked entry order (sorted canonically)', () => {
    const a: DiffInput = {
      ...base,
      untracked: [
        { path: 'b.txt', oid: '111' },
        { path: 'a.txt', oid: '222' },
      ],
    }
    const b: DiffInput = {
      ...base,
      untracked: [
        { path: 'a.txt', oid: '222' },
        { path: 'b.txt', oid: '111' },
      ],
    }
    expect(hashDiff(a)).toBe(hashDiff(b))
  })

  it('distinguishes different untracked content', () => {
    const a: DiffInput = { ...base, untracked: [{ path: 'a.txt', oid: '111' }] }
    const b: DiffInput = { ...base, untracked: [{ path: 'a.txt', oid: '222' }] }
    expect(hashDiff(a)).not.toBe(hashDiff(b))
  })

  it('detects an empty diff', () => {
    expect(isEmptyDiff({ tracked: '', trackedRaw: '', untracked: [] })).toBe(true)
    expect(isEmptyDiff(base)).toBe(false)
  })

  it('produces a versioned canonical payload with all sections', () => {
    const payload = canonicalDiffPayload(base)
    expect(payload).toContain('BETWEEN_DIFF_V1')
    expect(payload).toContain('TRACKED')
    expect(payload).toContain('RAW')
    expect(payload).toContain('UNTRACKED')
  })

  it('returns a 64-char hex sha-256', () => {
    expect(hashDiff(base)).toMatch(/^[0-9a-f]{64}$/)
  })
})
