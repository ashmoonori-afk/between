import { afterEach, describe, it, expect, vi } from 'vitest'
import { parseTelegramUpdates, TelegramTransport } from '../../src/gateway/telegram-transport'
import { DiscordTransport, parseDiscordMessage } from '../../src/gateway/discord-transport'
import { createChatTransport } from '../../src/gateway/factory'
import { parseConfig } from '../../src/core/config-schema'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('parseTelegramUpdates (contract)', () => {
  it('extracts text messages and the next offset', () => {
    const body = {
      result: [
        {
          update_id: 10,
          message: { chat: { id: 1170346056 }, text: 'status', from: { username: 'u' } },
        },
        { update_id: 11, message: { chat: { id: 1170346056 } } }, // no text -> skipped
        { update_id: 12, message: { chat: { id: 1170346056 }, text: 'goal ship it' } },
      ],
    }
    const { messages, nextOffset } = parseTelegramUpdates(body)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toEqual({ chatId: '1170346056', text: 'status', from: 'u' })
    expect(nextOffset).toBe(13)
  })

  it('returns no messages + null offset for an empty result', () => {
    expect(parseTelegramUpdates({ result: [] })).toEqual({ messages: [], nextOffset: null })
    expect(parseTelegramUpdates({})).toEqual({ messages: [], nextOffset: null })
  })

  it('skips empty + over-length text but still advances the offset', () => {
    const body = {
      result: [
        { update_id: 1, message: { chat: { id: 9 }, text: '' } }, // empty -> skipped
        { update_id: 2, message: { chat: { id: 9 }, text: 'x'.repeat(5000) } }, // too long -> skipped
        { update_id: 3, message: { chat: { id: 9 }, text: 'ok' } },
      ],
    }
    const { messages, nextOffset } = parseTelegramUpdates(body)
    expect(messages).toEqual([{ chatId: '9', text: 'ok', from: undefined }])
    expect(nextOffset).toBe(4) // offset still advances past the skipped updates
  })
})

describe('TelegramTransport lifecycle', () => {
  it('aborts an in-flight long poll when stopped', async () => {
    const aborts: boolean[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = (init as RequestInit)?.signal
          signal?.addEventListener(
            'abort',
            () => {
              aborts.push(true)
              reject(new DOMException('aborted', 'AbortError'))
            },
            { once: true },
          )
          setTimeout(() => reject(new Error('long poll was not aborted')), 10)
        }),
    )

    const transport = new TelegramTransport('token')
    await transport.start(async () => {})
    const result = await Promise.race([
      transport.stop().then(() => 'stopped' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 100)),
    ])

    expect(result).toBe('stopped')
    expect(aborts).toEqual([true])
  })
})

describe('parseDiscordMessage (contract)', () => {
  it('maps a MESSAGE_CREATE payload to a chat message', () => {
    expect(
      parseDiscordMessage({ channel_id: '42', content: 'status', author: { username: 'u' } }),
    ).toEqual({ chatId: '42', text: 'status', from: 'u' })
  })

  it('ignores bot authors and malformed payloads', () => {
    expect(
      parseDiscordMessage({ channel_id: '42', content: 'hi', author: { bot: true } }),
    ).toBeNull()
    expect(parseDiscordMessage({ channel_id: '42' })).toBeNull()
    expect(parseDiscordMessage(null)).toBeNull()
  })
})

describe('DiscordTransport lifecycle', () => {
  it('reconnects when Discord requests reconnect', async () => {
    vi.useFakeTimers()

    type Listener = (event: { readonly data?: string }) => void
    class FakeWebSocket {
      readonly sent: string[] = []
      private readonly listeners = new Map<string, Listener[]>()

      constructor(readonly url: string) {
        sockets.push(this)
      }

      addEventListener(type: string, listener: Listener): void {
        const current = this.listeners.get(type) ?? []
        current.push(listener)
        this.listeners.set(type, current)
      }

      send(data: string): void {
        this.sent.push(data)
      }

      close(): void {
        this.emit('close')
      }

      emitMessage(payload: unknown): void {
        this.emit('message', JSON.stringify(payload))
      }

      private emit(type: string, data?: string): void {
        for (const listener of this.listeners.get(type) ?? []) listener({ data })
      }
    }

    const sockets: FakeWebSocket[] = []
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const transport = new DiscordTransport('token', { reconnectDelayMs: 5 })
    await transport.start(async () => {})
    expect(sockets).toHaveLength(1)

    sockets[0]?.emitMessage({ op: 7 })
    await vi.advanceTimersByTimeAsync(5)

    expect(sockets).toHaveLength(2)
    await transport.stop()
  })

  it('ignores a stale close event from the previous Discord socket after reconnecting', async () => {
    vi.useFakeTimers()

    type Listener = (event: { readonly data?: string }) => void
    class FakeWebSocket {
      readonly sent: string[] = []
      readonly closes: string[] = []
      private readonly listeners = new Map<string, Listener[]>()

      constructor(readonly url: string) {
        sockets.push(this)
      }

      addEventListener(type: string, listener: Listener): void {
        const current = this.listeners.get(type) ?? []
        current.push(listener)
        this.listeners.set(type, current)
      }

      send(data: string): void {
        this.sent.push(data)
      }

      close(): void {
        this.closes.push('close')
      }

      emitClose(): void {
        this.emit('close')
      }

      emitMessage(payload: unknown): void {
        this.emit('message', JSON.stringify(payload))
      }

      private emit(type: string, data?: string): void {
        for (const listener of this.listeners.get(type) ?? []) listener({ data })
      }
    }

    const sockets: FakeWebSocket[] = []
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const transport = new DiscordTransport('token', { reconnectDelayMs: 5 })
    await transport.start(async () => {})
    const oldSocket = sockets[0]
    oldSocket?.emitMessage({ op: 7 })
    await vi.advanceTimersByTimeAsync(5)
    const newSocket = sockets[1]
    expect(newSocket).toBeDefined()
    newSocket?.emitMessage({ op: 10, d: { heartbeat_interval: 10 } })
    expect(newSocket?.sent).toHaveLength(1)

    oldSocket?.emitClose()
    await vi.advanceTimersByTimeAsync(10)

    expect(newSocket?.closes).toEqual([])
    expect(newSocket?.sent).toHaveLength(2)
    expect(JSON.parse(newSocket?.sent[1] ?? '{}')).toEqual({ op: 1, d: null })
    await transport.stop()
  })
})

describe('createChatTransport', () => {
  const cfg = (over: Record<string, unknown>) => parseConfig(over)

  it('defaults to echo', () => {
    expect(createChatTransport(cfg({}), {}).kind).toBe('echo')
  })

  it('builds telegram/discord when a token is present', () => {
    expect(
      createChatTransport(cfg({ gateway_channel: 'telegram', telegram_bot_token: 't' }), {}).kind,
    ).toBe('telegram')
    expect(
      createChatTransport(cfg({ gateway_channel: 'discord' }), { BETWEEN_DISCORD_TOKEN: 'd' }).kind,
    ).toBe('discord')
  })

  it('throws when a live channel has no token', () => {
    expect(() => createChatTransport(cfg({ gateway_channel: 'telegram' }), {})).toThrow(/telegram/)
    expect(() => createChatTransport(cfg({ gateway_channel: 'discord' }), {})).toThrow(/discord/)
  })
})
