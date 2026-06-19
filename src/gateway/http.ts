/**
 * `fetch` with a hard client-side timeout. Node's global fetch has no default client timeout,
 * so a stalled connection can hang the gateway forever.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<Response> {
  const callerSignal = init.signal
  const controller = new AbortController()
  const abortFromCaller = (): void => controller.abort(callerSignal?.reason)
  if (callerSignal?.aborted) {
    controller.abort(callerSignal.reason)
  } else {
    callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
  }
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`request timed out after ${timeoutMs}ms`, 'TimeoutError'))
  }, timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', abortFromCaller)
  }
}
