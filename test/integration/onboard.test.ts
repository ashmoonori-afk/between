import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { runOnboard, type OnboardIO } from '../../src/onboard/wizard'
import type { FetchLike } from '../../src/onboard/smoke'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-onboard-'))
  await execa('git', ['init', '-q'], { cwd: dir })
  await execa('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
  await execa('git', ['config', 'user.name', 't'], { cwd: dir })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function io(over: Partial<OnboardIO> = {}): OnboardIO & { lines: string[] } {
  const lines: string[] = []
  return {
    lines,
    ask: async () => '',
    print: (l) => lines.push(l),
    env: {},
    ...over,
  }
}

describe('runOnboard (integration)', () => {
  it('scaffolds the workspace and persists the echo channel', async () => {
    const sink = io()
    const out = await runOnboard(
      dir,
      { channel: 'echo', agent: 'fake', nonInteractive: true },
      sink,
    )
    expect(out.channel).toBe('echo')
    expect(out.initialized).toBe(true)
    const cfg = await readFile(join(dir, '.between', 'config.yaml'), 'utf8')
    expect(cfg).toMatch(/gateway_channel: echo/)
    expect(out.smoke).toBeNull()
  })

  it('telegram: persists chat id, smokes the token from env, and NEVER writes the token', async () => {
    const calls: string[] = []
    const fakeFetch: FetchLike = async (url) => {
      calls.push(url)
      return { json: async () => ({ ok: true, result: { username: 'Betweendevbot' } }) }
    }
    const sink = io({ env: { BETWEEN_TELEGRAM_TOKEN: 'SECRET-TOKEN-XYZ' }, fetchImpl: fakeFetch })
    const out = await runOnboard(
      dir,
      { channel: 'telegram', agent: 'fake', chatId: '1170346056', nonInteractive: true },
      sink,
    )
    expect(out.smoke?.ok).toBe(true)
    expect(out.smoke?.detail).toMatch(/Betweendevbot/)
    expect(calls[0]).toContain('/getMe')

    const cfg = await readFile(join(dir, '.between', 'config.yaml'), 'utf8')
    expect(cfg).toMatch(/gateway_channel: telegram/)
    expect(cfg).toMatch(/telegram_chat_id: "1170346056"/)
    // the secret must never be persisted to disk
    expect(cfg).not.toContain('SECRET-TOKEN-XYZ')
  })

  it('warns when a live channel is chosen without the token env set', async () => {
    const sink = io({ env: {} })
    const out = await runOnboard(
      dir,
      { channel: 'discord', agent: 'fake', nonInteractive: true },
      sink,
    )
    expect(out.warnings.join(' ')).toMatch(/BETWEEN_DISCORD_TOKEN/)
    expect(out.smoke?.ok).toBe(false)
  })

  it('interactive: prompts only for missing fields', async () => {
    const answers = ['telegram', 'fake', '', '999']
    let i = 0
    const sink = io({
      ask: async () => answers[i++] ?? '',
      env: { BETWEEN_TELEGRAM_TOKEN: 't' },
      fetchImpl: async () => ({ json: async () => ({ ok: true, result: { username: 'b' } }) }),
    })
    const out = await runOnboard(dir, {}, sink)
    expect(out.channel).toBe('telegram')
    const cfg = await readFile(join(dir, '.between', 'config.yaml'), 'utf8')
    expect(cfg).toMatch(/telegram_chat_id: "999"/)
  })
})
