import type { ChatTransport, InboundHandler } from './transport'

/**
 * In-memory transport (Phase 2). Needs no credentials: tests/dev inject inbound messages with
 * `inject()` and read outbound replies from `sent`. This is what makes the gateway dogfoodable
 * before any Telegram/Discord token exists.
 */
export class EchoTransport implements ChatTransport {
  readonly kind = 'echo'
  readonly sent: Array<{ chatId: string; text: string }> = []
  private handler: InboundHandler | null = null

  async start(onMessage: InboundHandler): Promise<void> {
    this.handler = onMessage
  }

  async send(chatId: string, text: string): Promise<void> {
    this.sent.push({ chatId, text })
  }

  async stop(): Promise<void> {
    this.handler = null
  }

  /** Simulate an inbound chat message and await the session's handling. */
  async inject(chatId: string, text: string): Promise<void> {
    if (this.handler) await this.handler({ chatId, text })
  }

  /** The most recent outbound reply text (test convenience). */
  lastSent(): string | null {
    return this.sent.at(-1)?.text ?? null
  }
}
