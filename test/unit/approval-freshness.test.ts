import { describe, it, expect } from 'vitest'
import { approvalFreshness } from '../../src/core/approval'

const fresh = {
  diff_hash: 'A',
  cycle: 3,
  bundle_id: 'B',
  expires_at: new Date(10_000).toISOString(),
}
const state = { diff_hash: 'A', cycle: 3, bundle_id: 'B', nowMs: 5_000 }

describe('approvalFreshness (A2)', () => {
  it('returns null when the approval matches the current diff/cycle/bundle and is unexpired', () => {
    expect(approvalFreshness(fresh, state)).toBeNull()
  })

  it('rejects a stale diff hash (the P0-2 reuse bug)', () => {
    expect(approvalFreshness({ ...fresh, diff_hash: 'OLD' }, state)).toMatch(/diff hash/)
  })

  it('rejects a different cycle', () => {
    expect(approvalFreshness({ ...fresh, cycle: 2 }, state)).toMatch(/cycle/)
  })

  it('rejects an approval not bound to the current bundle', () => {
    expect(approvalFreshness({ ...fresh, bundle_id: 'OTHER' }, state)).toMatch(/bundle/)
  })

  it('rejects an expired approval', () => {
    expect(approvalFreshness(fresh, { ...state, nowMs: 20_000 })).toMatch(/expired/)
  })
})
