import { describe, it, expect } from 'vitest'
import {
  countBlocking,
  reviewIsClean,
  cycleShouldEnd,
  reviewMatchesCurrent,
  parseReviewRecord,
} from '../../src/core/findings'
import type { Finding } from '../../src/core/types'

const blocking: Finding = { id: 'f1', severity: 'blocking', summary: 'bug', target_hash: 'h1' }
const nonBlocking: Finding = { id: 'f2', severity: 'non-blocking', summary: 'nit', target_hash: 'h1' }

describe('findings', () => {
  it('counts blocking findings', () => {
    expect(countBlocking([blocking, nonBlocking, blocking])).toBe(2)
    expect(countBlocking([nonBlocking])).toBe(0)
  })

  it('a review is clean only when complete and free of blocking findings', () => {
    expect(reviewIsClean({ findings: [nonBlocking], complete: true })).toBe(true)
    expect(reviewIsClean({ findings: [blocking], complete: true })).toBe(false)
    expect(reviewIsClean({ findings: [], complete: false })).toBe(false)
  })

  it('cycle ends only with a clean review and a passing verify for the same hash', () => {
    const review = { findings: [nonBlocking], complete: true, diff_hash: 'h1' }
    expect(cycleShouldEnd(review, { passed: true, diff_hash: 'h1' })).toBe(true)
    expect(cycleShouldEnd(review, { passed: false, diff_hash: 'h1' })).toBe(false)
    // hash mismatch never ends the cycle (I14)
    expect(cycleShouldEnd(review, { passed: true, diff_hash: 'OTHER' })).toBe(false)
    expect(cycleShouldEnd(review, null)).toBe(false)
  })

  it('matches a review to the current hash only when complete', () => {
    expect(reviewMatchesCurrent({ complete: true, diff_hash: 'h1' }, 'h1')).toBe(true)
    expect(reviewMatchesCurrent({ complete: false, diff_hash: 'h1' }, 'h1')).toBe(false)
    expect(reviewMatchesCurrent({ complete: true, diff_hash: 'h1' }, 'h2')).toBe(false)
  })

  it('parses a valid review record and rejects an invalid one', () => {
    const ok = parseReviewRecord({ cycle: 7, diff_hash: 'h1', findings: [blocking], complete: true })
    expect(ok.findings).toHaveLength(1)
    expect(() => parseReviewRecord({ cycle: 7, diff_hash: 'h1', findings: [{ id: 'x' }], complete: true })).toThrow()
  })
})
