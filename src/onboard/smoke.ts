import type { Channel } from './plan'

export interface SmokeResult {
  ok: boolean
  detail: string
}

const DEFAULT_SMOKE_TIMEOUT_MS = 10_000

type FetchInit = {
  method?: string
  headers?: Record<string, string>
  signal?: AbortSignal
}

/** Minimal fetch surface so the smoke test can be unit-tested without the network. */
export type FetchLike = (url: string, init?: FetchInit) => Promise<{ json(): Promise<unknown> }>

async function fetchJsonWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: FetchInit | undefined,
  timeoutMs: number,
): Promise<unknown> {
  const abort = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort()
      reject(new Error(`smoke timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })
  const request = (async () => {
    const res = await fetchImpl(url, { ...init, signal: abort.signal })
    return res.json()
  })()

  try {
    return await Promise.race([request, timedOut])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Validate a live channel's bot token by calling its identity endpoint (no message sent):
 * Telegram `getMe`, Discord `users/@me`. Returns a friendly result; never throws on a bad
 * token (returns ok:false). Echo always passes. The token is read from env, never logged.
 */
export async function smokeChannel(
  channel: Channel,
  token: string | undefined,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  timeoutMs = DEFAULT_SMOKE_TIMEOUT_MS,
): Promise<SmokeResult> {
  if (channel === 'echo') return { ok: true, detail: 'echo channel (no credentials needed)' }
  if (!token) return { ok: false, detail: 'no token in environment' }

  try {
    if (channel === 'telegram') {
      const body = (await fetchJsonWithTimeout(
        fetchImpl,
        `https://api.telegram.org/bot${token}/getMe`,
        undefined,
        timeoutMs,
      )) as {
        ok?: boolean
        result?: { username?: string }
        description?: string
      }
      return body.ok
        ? { ok: true, detail: `telegram bot @${body.result?.username ?? '?'}` }
        : { ok: false, detail: `telegram: ${body.description ?? 'getMe failed'}` }
    }
    // discord
    const body = (await fetchJsonWithTimeout(
      fetchImpl,
      'https://discord.com/api/v10/users/@me',
      {
        headers: { authorization: `Bot ${token}` },
      },
      timeoutMs,
    )) as { username?: string; id?: string; message?: string }
    return body.username
      ? { ok: true, detail: `discord bot @${body.username} (id ${body.id})` }
      : { ok: false, detail: `discord: ${body.message ?? 'auth failed'}` }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : 'request failed' }
  }
}
