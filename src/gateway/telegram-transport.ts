import type { ChatMessage, ChatTransport, InboundHandler } from './transport'

interface TelegramUpdate {
  update_id: number
  message?: { chat: { id: number }; text?: string; from?: { username?: string } }
}

/**
 * Pure: turn a Telegram `getUpdates` response into chat messages + the next long-poll offset.
 * Contract-tested without any network or credentials.
 */
export function parseTelegramUpdates(body: unknown): {
  messages: ChatMessage[]
  nextOffset: number | null
} {
  const result = ((body as { result?: TelegramUpdate[] })?.result ?? []) as TelegramUpdate[]
  const messages: ChatMessage[] = []
  let maxId = -1
  for (const u of result) {
    if (typeof u.update_id === 'number') maxId = Math.max(maxId, u.update_id)
    const m = u.message
    if (m && typeof m.text === 'string') {
      messages.push({ chatId: String(m.chat.id), text: m.text, from: m.from?.username })
    }
  }
  return { messages, nextOffset: maxId >= 0 ? maxId + 1 : null }
}

/** Telegram Bot API transport — HTTP long-polling via global `fetch` (zero native deps). */
export class TelegramTransport implements ChatTransport {
  readonly kind = 'telegram'
  private offset = 0
  private running = false
  private handler: InboundHandler | null = null

  constructor(private readonly token: string) {}

  private api(method: string): string {
    return `https://api.telegram.org/bot${this.token}/${method}`
  }

  async start(onMessage: InboundHandler): Promise<void> {
    this.handler = onMessage
    this.running = true
    void this.poll()
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const res = await fetch(`${this.api('getUpdates')}?timeout=30&offset=${this.offset}`)
        const { messages, nextOffset } = parseTelegramUpdates(await res.json())
        if (nextOffset !== null) this.offset = nextOffset
        for (const m of messages) await this.handler?.(m)
      } catch {
        await new Promise((r) => setTimeout(r, 2000)) // back off on transient errors
      }
    }
  }

  async send(chatId: string, text: string): Promise<void> {
    await fetch(this.api('sendMessage'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
  }

  async stop(): Promise<void> {
    this.running = false
    this.handler = null
  }
}
