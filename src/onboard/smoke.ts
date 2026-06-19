import type { Channel } from './plan'

export interface SmokeResult {
  ok: boolean
  detail: string
}

/** Minimal fetch surface so the smoke test can be unit-tested without the network. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{ json(): Promise<unknown> }>

/**
 * Validate a live channel's bot token by calling its identity endpoint (no message sent):
 * Telegram `getMe`, Discord `users/@me`. Returns a friendly result; never throws on a bad
 * token (returns ok:false). Echo always passes. The token is read from env, never logged.
 */
export async function smokeChannel(
  channel: Channel,
  token: string | undefined,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<SmokeResult> {
  if (channel === 'echo') return { ok: true, detail: 'echo channel (no credentials needed)' }
  if (!token) return { ok: false, detail: 'no token in environment' }

  try {
    if (channel === 'telegram') {
      const res = await fetchImpl(`https://api.telegram.org/bot${token}/getMe`)
      const body = (await res.json()) as {
        ok?: boolean
        result?: { username?: string }
        description?: string
      }
      return body.ok
        ? { ok: true, detail: `telegram bot @${body.result?.username ?? '?'}` }
        : { ok: false, detail: `telegram: ${body.description ?? 'getMe failed'}` }
    }
    // discord
    const res = await fetchImpl('https://discord.com/api/v10/users/@me', {
      headers: { authorization: `Bot ${token}` },
    })
    const body = (await res.json()) as { username?: string; id?: string; message?: string }
    return body.username
      ? { ok: true, detail: `discord bot @${body.username} (id ${body.id})` }
      : { ok: false, detail: `discord: ${body.message ?? 'auth failed'}` }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : 'request failed' }
  }
}
