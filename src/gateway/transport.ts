/**
 * Chat transport port (Phase 2). The gateway bridges a human chat (Telegram / Discord / a
 * local echo) to the Between broker. Concrete transports implement this interface; the
 * `GatewaySession` is transport-agnostic, so adding Telegram/Discord later (Phase 3) needs
 * no session changes — and the echo transport makes the whole gateway testable with zero creds.
 */
export interface ChatMessage {
  chatId: string
  text: string
  from?: string
}

export type InboundHandler = (msg: ChatMessage) => void | Promise<void>

export interface ChatTransport {
  readonly kind: string
  /** Begin receiving inbound messages; `onMessage` is called per message. */
  start(onMessage: InboundHandler): Promise<void>
  /** Send an outbound reply to a chat. */
  send(chatId: string, text: string): Promise<void>
  stop(): Promise<void>
}
