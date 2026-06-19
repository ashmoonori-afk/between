import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchWithTimeout } from '../../src/gateway/http'

afterEach(() => vi.restoreAllMocks())

describe('fetchWithTimeout', () => {
  it('passes an AbortSignal and returns the response', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      expect((init as RequestInit)?.signal).toBeInstanceOf(AbortSignal)
      return new Response('ok')
    })
    const res = await fetchWithTimeout('https://example.test', {}, 1000)
    expect(await res.text()).toBe('ok')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('aborts when the request outlives the timeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = (init as RequestInit)?.signal
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    await expect(fetchWithTimeout('https://example.test', {}, 10)).rejects.toThrow(/abort/i)
  })
})
