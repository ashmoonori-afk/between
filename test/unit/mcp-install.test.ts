import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, win32 } from 'node:path'
import {
  installQuickReviewCommand,
  quickReviewPath,
  renderQuickReviewCommand,
  uninstallQuickReviewCommand,
} from '../../src/onboard/mcp-install'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'between-mcp-install-'))
  dirs.push(dir)
  return dir
}

describe('quick-review command paths', () => {
  it('resolves Claude and Codex paths from Unix environment overrides', () => {
    const home = '/home/tester'
    const env = {
      HOME: home,
      CLAUDE_CONFIG_DIR: '/config/claude',
      CODEX_HOME: '/config/codex',
    }

    expect(quickReviewPath('claude', { platform: 'darwin', env, homedir: () => home })).toBe(
      '/config/claude/commands/bqr.md',
    )
    expect(quickReviewPath('codex', { platform: 'linux', env, homedir: () => home })).toBe(
      '/config/codex/skills/bqr/SKILL.md',
    )
  })

  it('uses the injected Windows home when overrides are absent', () => {
    const home = String.raw`C:\Users\tester`

    expect(quickReviewPath('claude', { platform: 'win32', env: {}, homedir: () => home })).toBe(
      win32.join(home, '.claude', 'commands', 'bqr.md'),
    )
    expect(quickReviewPath('codex', { platform: 'win32', env: {}, homedir: () => home })).toBe(
      win32.join(home, '.codex', 'skills', 'bqr', 'SKILL.md'),
    )
  })
})

describe('managed quick-review command files', () => {
  it('reports a missing command file as not installed', async () => {
    const home = await tempHome()
    const options = { platform: 'linux' as const, env: { HOME: home }, homedir: () => home }

    expect((await uninstallQuickReviewCommand('claude', options)).status).toBe('not_installed')
  })

  it('installs byte-identically and reports an idempotent second install', async () => {
    const home = await tempHome()
    const options = { platform: 'linux' as const, env: { HOME: home }, homedir: () => home }
    const first = await installQuickReviewCommand('claude', options)
    const path = quickReviewPath('claude', options)
    const before = await readFile(path)
    const second = await installQuickReviewCommand('claude', options)

    expect(first.status).toBe('installed')
    expect(second.status).toBe('up_to_date')
    expect(await readFile(path)).toEqual(before)
  })

  it('preserves user-edited and unmarked files byte-for-byte', async () => {
    const home = await tempHome()
    const options = { platform: 'linux' as const, env: { HOME: home }, homedir: () => home }
    await installQuickReviewCommand('claude', options)
    const claudePath = quickReviewPath('claude', options)
    const edited = Buffer.from(`${await readFile(claudePath, 'utf8')}\nUser note.\n`)
    await writeFile(claudePath, edited)

    const codexPath = quickReviewPath('codex', options)
    const unmarked = Buffer.from('Existing user skill.\n')
    await mkdir(dirname(codexPath), { recursive: true })
    await writeFile(codexPath, unmarked)

    expect((await installQuickReviewCommand('claude', options)).status).toBe('skipped_user_edited')
    expect(await readFile(claudePath)).toEqual(edited)
    expect((await installQuickReviewCommand('codex', options)).status).toBe('skipped_user_edited')
    expect(await readFile(codexPath)).toEqual(unmarked)
  })

  it('uninstalls only managed unmodified files', async () => {
    const home = await tempHome()
    const options = { platform: 'linux' as const, env: { HOME: home }, homedir: () => home }
    await installQuickReviewCommand('claude', options)
    await installQuickReviewCommand('codex', options)
    const codexPath = quickReviewPath('codex', options)
    const edited = `${await readFile(codexPath, 'utf8')}\nUser note.\n`
    await writeFile(codexPath, edited)

    expect((await uninstallQuickReviewCommand('claude', options)).status).toBe('removed')
    expect((await uninstallQuickReviewCommand('codex', options)).status).toBe('skipped_user_edited')
    expect(await readFile(codexPath, 'utf8')).toBe(edited)
  })

  it('renders host-specific frontmatter and a managed ownership marker', () => {
    const claude = renderQuickReviewCommand('claude')
    const codex = renderQuickReviewCommand('codex')

    expect(claude.startsWith('---\ndescription: ')).toBe(true)
    expect(codex.startsWith('---\nname: bqr\ndescription: ')).toBe(true)
    expect(claude).toMatch(/<!-- between-dev:managed sha256=[a-f0-9]{64} --/)
    expect(codex).toMatch(/<!-- between-dev:managed sha256=[a-f0-9]{64} --/)
  })
})
