import { describe, it, expect } from 'vitest'
import { parseTelegramUpdates } from '../../src/gateway/telegram-transport'
import { parseDiscordMessage } from '../../src/gateway/discord-transport'
import { createChatTransport } from '../../src/gateway/factory'
import { parseConfig } from '../../src/core/config-schema'

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
