import type { ChatMessage, ChatTransport, InboundHandler } from './transport'
import { fetchWithTimeout } from './http'

/** Discord Gateway intents: GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT. */
const INTENTS = (1 << 0) | (1 << 9) | (1 << 15)
export interface DiscordTransportOptions {
  readonly reconnectDelayMs?: number
}

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
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private seq: number | null = null
  private handler: InboundHandler | null = null
  private stopped = true
  private readonly reconnectDelayMs: number

  constructor(
    private readonly token: string,
    opts: DiscordTransportOptions = {},
  ) {
    this.reconnectDelayMs = opts.reconnectDelayMs ?? 1000
  }

  async start(onMessage: InboundHandler): Promise<void> {
    this.handler = onMessage
    this.stopped = false
    this.connect()
  }

  private connect(): void {
    const ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json')
    this.ws = ws
    ws.addEventListener('message', (ev: MessageEvent) => {
      if (this.ws === ws) this.onFrame(String(ev.data))
    })
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return
      this.clearHeartbeat()
      this.scheduleReconnect(ws)
    })
    ws.addEventListener('error', () => {
      if (this.ws === ws) this.scheduleReconnect(ws)
    })
  }

  private clearHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
  }

  private scheduleReconnect(socket: WebSocket): void {
    if (this.stopped || this.reconnectTimer) return
    this.clearHeartbeat()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.stopped && this.handler) this.connect()
    }, this.reconnectDelayMs)
    socket.close()
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
      if (this.ws) this.scheduleReconnect(this.ws)
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
    this.stopped = true
    this.clearHeartbeat()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    const ws = this.ws
    this.ws = null
    ws?.close()
    this.handler = null
  }
}
