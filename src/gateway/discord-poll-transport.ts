import type { ChatMessage, ChatTransport, InboundHandler } from './transport'
import { fetchWithTimeout } from './http'

interface RestMessage {
  id: string
  content?: string
  author?: { bot?: boolean; username?: string }
}

/**
 * Pure: turn a Discord REST channel message into a ChatMessage, ignoring bot authors (so the
 * gateway never echoes itself) and empty content. The channel id is the chat id. Contract-tested.
 */
export function parseDiscordRestMessage(channelId: string, m: RestMessage): ChatMessage | null {
  if (!m || typeof m.content !== 'string' || m.content.length === 0) return null
  if (m.author?.bot) return null
  return { chatId: channelId, text: m.content, from: m.author?.username }
}

/**
 * Discord transport via REST channel polling instead of the realtime Gateway WS. Unlike the WS
 * path it needs **no MESSAGE_CONTENT privileged intent** (that gates content only over the
 * Gateway) and it **replays messages missed while offline** (it advances a last-seen id like
 * Telegram's long-poll). Requires View Channel + Read Message History on the target channel.
 */
export class DiscordPollTransport implements ChatTransport {
  readonly kind = 'discord'
  private running = false
  private handler: InboundHandler | null = null
  private lastId: string | null = null
  private pollTask: Promise<void> | null = null
  private wake: (() => void) | null = null

  constructor(
    private readonly token: string,
    private readonly channelId: string,
    private readonly intervalMs = 4000,
  ) {}

  private get headers(): Record<string, string> {
    return { authorization: `Bot ${this.token}`, 'content-type': 'application/json' }
  }
  private endpoint(channelId: string): string {
    return `https://discord.com/api/v10/channels/${channelId}/messages`
  }

  async start(onMessage: InboundHandler): Promise<void> {
    this.handler = onMessage
    this.running = true
    // seed with the newest message so we only deliver messages sent from now on
    this.lastId = await this.latestId()
    this.pollTask = this.poll()
  }

  private async latestId(): Promise<string | null> {
    try {
      const res = await fetchWithTimeout(
        `${this.endpoint(this.channelId)}?limit=1`,
        { headers: this.headers },
        10000,
      )
      if (!res.ok) return null
      const arr = (await res.json()) as RestMessage[]
      return Array.isArray(arr) && arr[0] ? arr[0].id : null
    } catch {
      return null
    }
  }

  /** Honor Discord's 429 Retry-After (seconds) header, falling back to the poll interval. */
  private retryAfterMs(res: Response): number {
    const header = res.headers.get('retry-after')
    const seconds = header ? Number(header) : NaN
    return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : this.intervalMs
  }

  private async poll(): Promise<void> {
    while (this.running) {
      let delay = this.intervalMs
      try {
        const base = this.endpoint(this.channelId)
        const url = this.lastId ? `${base}?after=${this.lastId}&limit=50` : `${base}?limit=50`
        const res = await fetchWithTimeout(url, { headers: this.headers }, 15000)
        if (res.status === 429) {
          // rate limited — wait the server-dictated window instead of hammering (review).
          delay = this.retryAfterMs(res)
        } else if (res.ok) {
          const arr = (await res.json()) as RestMessage[]
          if (Array.isArray(arr) && arr.length > 0) {
            const chronological = [...arr].reverse() // REST returns newest-first
            const handler = this.handler // pin so a concurrent stop() can't drop a message mid-batch
            for (const m of chronological) {
              const msg = parseDiscordRestMessage(this.channelId, m)
              if (msg && handler) {
                // isolate handler faults from fetch faults: one bad message must not stall the loop
                try {
                  await handler(msg)
                } catch {
                  /* swallow a handler fault and keep polling */
                }
              }
            }
            this.lastId = chronological[chronological.length - 1]!.id
          }
        }
        // other non-ok (401/403/404/5xx): skip this round, keep the cursor, retry after `delay`
      } catch {
        // transient network/timeout — fall through to the backoff sleep and retry
      }
      if (this.running) await this.sleep(delay)
    }
  }

  /** Interruptible sleep so `stop()` returns promptly instead of waiting out the interval. */
  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.wake = null
        resolve()
      }, ms)
      this.wake = () => {
        clearTimeout(timer)
        this.wake = null
        resolve()
      }
    })
  }

  async send(channelId: string, text: string): Promise<void> {
    await fetchWithTimeout(
      this.endpoint(channelId),
      { method: 'POST', headers: this.headers, body: JSON.stringify({ content: text }) },
      10000,
    )
  }

  async stop(): Promise<void> {
    this.running = false
    this.handler = null
    this.wake?.()
    const task = this.pollTask
    this.pollTask = null
    if (task) await task
  }
}
