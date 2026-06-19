/**
 * `fetch` with a hard client-side timeout (review: Node's global fetch has no default client
 * timeout, so a stalled connection can hang the gateway forever). Aborts after `timeoutMs` and
 * always clears the timer. Throws on abort/network error — callers decide how to recover.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
