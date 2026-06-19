import type { ChatMessage, ChatTransport, InboundHandler } from './transport'
import { fetchWithTimeout } from './http'

/** Discord Gateway intents: GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT. */
const INTENTS = (1 << 0) | (1 << 9) | (1 << 15)

/**
 * Pure: turn a Discord MESSAGE_CREATE dispatch payload (`d`) into a chat message, ignoring
 * messages authored by a bot (so the gateway never echoes itself). Contract-tested.
 */
export function parseDiscordMessage(d: unknown): ChatMessage | null {
  const m = d as {
    channel_id?: string
    content?: string
    author?: { bot?: boolean; username?: string }
  }
  if (!m || typeof m.channel_id !== 'string' || typeof m.content !== 'string') return null
  if (m.author?.bot) return null
  if (m.content.length === 0) return null
  return { chatId: m.channel_id, text: m.content, from: m.author?.username }
}

/**
 * Discord bot transport — receives over the Gateway WebSocket (global `WebSocket`, Node 22+),
 * sends over the REST API via `fetch`. Zero native deps. (Live connection requires a bot token
 * with the MESSAGE_CONTENT privileged intent enabled.)
 */
export class DiscordTransport implements ChatTransport {
  readonly kind = 'discord'
  private ws: WebSocket | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private seq: number | null = null
  private handler: InboundHandler | null = null

  constructor(private readonly token: string) {}

  async start(onMessage: InboundHandler): Promise<void> {
    this.handler = onMessage
    const ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json')
    this.ws = ws
    ws.addEventListener('message', (ev: MessageEvent) => this.onFrame(String(ev.data)))
    ws.addEventListener('close', () => this.clearHeartbeat())
    // without an 'error' listener an auth/network failure is silently swallowed and the
    // heartbeat would leak — clear it and let close() fire (review).
    ws.addEventListener('error', () => this.clearHeartbeat())
  }

  private clearHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
  }

  private onFrame(data: string): void {
    let payload: { op?: number; t?: string; s?: number; d?: unknown }
    try {
      payload = JSON.parse(data)
    } catch {
      return
    }
    if (typeof payload.s === 'number') this.seq = payload.s
    if (payload.op === 10) {
      // HELLO — validate the interval (external data) before scheduling the heartbeat (review).
      const d = payload.d as { heartbeat_interval?: unknown } | null
      const interval = d?.heartbeat_interval
      if (typeof interval !== 'number' || interval <= 0) return
      this.heartbeat = setInterval(() => {
        this.ws?.send(JSON.stringify({ op: 1, d: this.seq }))
      }, interval)
      this.ws?.send(
        JSON.stringify({
          op: 2,
          d: {
            token: this.token,
            intents: INTENTS,
            properties: { os: 'linux', browser: 'between', device: 'between' },
          },
        }),
      )
    } else if (payload.op === 7 || payload.op === 9) {
      // RECONNECT / INVALID_SESSION — stop heartbeating and close so cleanup runs (review).
      this.clearHeartbeat()
      this.ws?.close()
    } else if (payload.op === 0 && payload.t === 'MESSAGE_CREATE') {
      const msg = parseDiscordMessage(payload.d)
      if (msg) void this.handler?.(msg)
    }
  }

  async send(channelId: string, text: string): Promise<void> {
    await fetchWithTimeout(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: { authorization: `Bot ${this.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ content: text }),
      },
      10000,
    )
  }

  async stop(): Promise<void> {
    this.clearHeartbeat()
    this.ws?.close()
    this.handler = null
  }
}
