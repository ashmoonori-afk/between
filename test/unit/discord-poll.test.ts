import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  DiscordPollTransport,
  parseDiscordRestMessage,
} from '../../src/gateway/discord-poll-transport'
import { DiscordTransport } from '../../src/gateway/discord-transport'
import { createChatTransport } from '../../src/gateway/factory'
import { parseConfig } from '../../src/core/config-schema'
import type { ChatMessage } from '../../src/gateway/transport'

afterEach(() => vi.restoreAllMocks())

describe('parseDiscordRestMessage (contract)', () => {
  it('maps a REST channel message to a chat message', () => {
    expect(
      parseDiscordRestMessage('CH', { id: '1', content: 'status', author: { username: 'u' } }),
    ).toEqual({ chatId: 'CH', text: 'status', from: 'u' })
  })

  it('ignores bot authors and empty content', () => {
    expect(
      parseDiscordRestMessage('CH', { id: '1', content: 'hi', author: { bot: true } }),
    ).toBeNull()
    expect(parseDiscordRestMessage('CH', { id: '1', content: '' })).toBeNull()
    expect(parseDiscordRestMessage('CH', { id: '1' })).toBeNull()
  })
})

describe('createChatTransport — discord_mode', () => {
  const cfg = (over: Record<string, unknown>) => parseConfig(over)

  it('gateway mode builds the WS transport', () => {
    const t = createChatTransport(
      cfg({ gateway_channel: 'discord', discord_bot_token: 't', discord_mode: 'gateway' }),
      {},
    )
    expect(t).toBeInstanceOf(DiscordTransport)
  })

  it('poll mode builds the REST poll transport', () => {
    const t = createChatTransport(
      cfg({
        gateway_channel: 'discord',
        discord_bot_token: 't',
        discord_mode: 'poll',
        discord_channel_id: 'CH',
      }),
      {},
    )
    expect(t).toBeInstanceOf(DiscordPollTransport)
  })

  it('poll mode without a channel id is a clear error', () => {
    expect(() =>
      createChatTransport(
        cfg({ gateway_channel: 'discord', discord_bot_token: 't', discord_mode: 'poll' }),
        {},
      ),
    ).toThrow(/discord_channel_id/)
  })
})

describe('DiscordPollTransport lifecycle', () => {
  it('seeds the cursor, delivers new messages, and advances past them', async () => {
    let served = false
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('limit=1')) return new Response(JSON.stringify([{ id: '100' }])) // seed
      if (u.includes('after=100') && !served) {
        served = true
        return new Response(
          JSON.stringify([{ id: '101', content: 'goal x', author: { username: 'u' } }]),
        )
      }
      return new Response(JSON.stringify([])) // nothing new
    })

    const got: ChatMessage[] = []
    const t = new DiscordPollTransport('tok', 'CH', 5)
    await t.start(async (m) => {
      got.push(m)
    })
    await new Promise((r) => setTimeout(r, 40))
    await t.stop()

    expect(got).toEqual([{ chatId: 'CH', text: 'goal x', from: 'u' }])
  })

  it('survives a 429 (does not advance the cursor) then delivers on retry', async () => {
    let rateLimited = false
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('limit=1')) return new Response(JSON.stringify([{ id: '100' }]))
      if (u.includes('after=100') && !rateLimited) {
        rateLimited = true
        return new Response('{}', { status: 429 }) // rate limited — must not crash or deliver
      }
      if (u.includes('after=100')) {
        return new Response(
          JSON.stringify([{ id: '101', content: 'after 429', author: { username: 'u' } }]),
        )
      }
      return new Response(JSON.stringify([]))
    })

    const got: ChatMessage[] = []
    const t = new DiscordPollTransport('tok', 'CH', 5)
    await t.start(async (m) => {
      got.push(m)
    })
    await new Promise((r) => setTimeout(r, 60))
    await t.stop()

    expect(got).toEqual([{ chatId: 'CH', text: 'after 429', from: 'u' }])
  })

  it('a throwing handler does not stall the loop', async () => {
    let served = false
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('limit=1')) return new Response(JSON.stringify([{ id: '100' }]))
      if (u.includes('after=100') && !served) {
        served = true
        return new Response(
          JSON.stringify([
            { id: '102', content: 'ok2', author: { username: 'u' } }, // newest first
            { id: '101', content: 'boom', author: { username: 'u' } },
          ]),
        )
      }
      return new Response(JSON.stringify([]))
    })

    const got: string[] = []
    const t = new DiscordPollTransport('tok', 'CH', 5)
    await t.start(async (m) => {
      if (m.text === 'boom') throw new Error('handler blew up')
      got.push(m.text)
    })
    await new Promise((r) => setTimeout(r, 40))
    await t.stop()

    expect(got).toEqual(['ok2']) // the bad message was isolated; the good one still delivered
  })
})
