import { describe, expect, it } from 'vitest'
import { smokeChannel, type FetchLike } from '../../src/onboard/smoke'

describe('smokeChannel', () => {
  it('times out a live channel identity request that never settles', async () => {
    const stuckFetch: FetchLike = () => new Promise<never>(() => {})

    const result = await Promise.race([
      smokeChannel('telegram', 'TOKEN', stuckFetch, 10),
      new Promise<'still-pending'>((resolve) => setTimeout(() => resolve('still-pending'), 50)),
    ])

    expect(result).not.toBe('still-pending')
    expect(result).toMatchObject({ ok: false })
    if (result !== 'still-pending') {
      expect(result.detail).toMatch(/timed out/i)
    }
  })
})
