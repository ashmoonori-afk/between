import { describe, it, expect, afterEach } from 'vitest'
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { initProject } from '../../src/adapters/init-project'
import { parseConfig } from '../../src/core/config-schema'
import { FakeClock } from '../../src/core/clock'

let dir: string
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

async function init(agent?: 'fake' | 'claude' | 'codex') {
  dir = await mkdtemp(join(tmpdir(), 'between-initagent-'))
  await initProject(dir, { agent }, new FakeClock(0))
  const cfg = parseConfig(parseYaml(await readFile(join(dir, '.between', 'config.yaml'), 'utf8')))
  return cfg
}

describe('init --agent presets (Task 1)', () => {
  it('fake (default) keeps file mode + bundles fake-agent.mjs', async () => {
    const cfg = await init('fake')
    expect(cfg.agent_mode).toBe('file')
    expect(cfg.developer_command).toContain('fake-agent.mjs')
    expect(existsSync(join(dir, '.between', 'agents', 'fake-agent.mjs'))).toBe(true)
  })

  it('claude sets oneshot + claude wrapper for both roles', async () => {
    const cfg = await init('claude')
    expect(cfg.agent_mode).toBe('oneshot')
    expect(cfg.developer_command).toBe('node .between/agents/claude-agent.mjs developer')
    expect(cfg.reviewer_command).toBe('node .between/agents/claude-agent.mjs reviewer')
    expect(existsSync(join(dir, '.between', 'agents', 'claude-agent.mjs'))).toBe(true)
    // fake-agent still shipped as the file-mode fallback
    expect(existsSync(join(dir, '.between', 'agents', 'fake-agent.mjs'))).toBe(true)
  })

  it('codex sets oneshot + codex wrapper', async () => {
    const cfg = await init('codex')
    expect(cfg.agent_mode).toBe('oneshot')
    expect(cfg.reviewer_command).toBe('node .between/agents/codex-agent.mjs reviewer')
    expect(existsSync(join(dir, '.between', 'agents', 'codex-agent.mjs'))).toBe(true)
  })

  it('writes a quoted vault path when the absolute Windows path contains spaces', async () => {
    dir = await mkdtemp(join(tmpdir(), 'between-init-vault-'))
    const vault = join(dir, 'vault with spaces')
    await mkdir(vault)

    await initProject(dir, { vaultPath: vault }, new FakeClock(0))
    const body = await readFile(join(dir, '.between', 'config.yaml'), 'utf8')
    const cfg = parseConfig(parseYaml(body))

    expect(cfg.vault_path).toBe(vault)
    expect(body).toContain(`vault_path: ${JSON.stringify(vault)}`)
  })
})
