import { describe, it, expect } from 'vitest'
import { parseInterval, MIN_DASH_INTERVAL_MS } from '../../src/cli/args'

describe('parseInterval (review P2)', () => {
  it('accepts a valid integer interval', () => {
    expect(parseInterval('1000')).toBe(1000)
    expect(parseInterval(String(MIN_DASH_INTERVAL_MS))).toBe(MIN_DASH_INTERVAL_MS)
  })

  it('rejects zero, negative, non-integer, NaN, and below-floor values', () => {
    for (const bad of ['0', '-5', 'abc', '100', '12.5', '', 'NaN', '1e9999']) {
      expect(() => parseInterval(bad)).toThrow()
    }
  })
})
