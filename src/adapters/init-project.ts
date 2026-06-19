import { mkdir, readFile, writeFile, access, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { stringify as yamlStringify } from 'yaml'
import type { Clock, ProjectRef } from '../core/types'
import { defaultConfigYaml } from '../core/config-schema'
import { initialState } from '../core/state'
import { StateRepository } from './state-repository'
import { betweenPaths, betweenSubdirs } from './paths'
import { FAKE_AGENT_SOURCE } from '../agents/fake-agent'
import { CLAUDE_AGENT_SOURCE, CODEX_AGENT_SOURCE, type AgentPreset } from '../agents/real-agents'

export interface InitOptions {
  vaultPath?: string
  /** which agent wraps the developer/reviewer roles: fake (default), claude, or codex */
  agent?: AgentPreset
}

export interface InitResult {
  created: string[]
  alreadyExisted: boolean
  project: ProjectRef
}

/** Create `.between/` scaffolding, config, initial state, and a `.gitignore` entry (idempotent). */
export async function initProject(
  root: string,
  opts: InitOptions,
  clock: Clock,
): Promise<InitResult> {
  const absRoot = resolve(root)
  const p = betweenPaths(absRoot)
  const created: string[] = []
  const existedBefore = existsSync(p.state)

  for (const dir of betweenSubdirs(p)) {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
      created.push(dir)
    }
  }

  let vaultPath = opts.vaultPath?.trim()
  if (vaultPath) {
    // I25 / security M4: validate the vault is an existing directory before storing it
    vaultPath = resolve(vaultPath)
    let isDir = false
    try {
      isDir = (await stat(vaultPath)).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) throw new Error(`--vault path is not an existing directory: ${vaultPath}`)
  }
  const project: ProjectRef = {
    name: basename(absRoot),
    root: absRoot,
    obsidian_project_path: vaultPath
      ? join(vaultPath, 'Between', 'Projects', basename(absRoot))
      : null,
  }

  const preset: AgentPreset = opts.agent ?? 'fake'
  const presetScript =
    preset === 'claude'
      ? 'claude-agent.mjs'
      : preset === 'codex'
        ? 'codex-agent.mjs'
        : 'fake-agent.mjs'

  if (!existsSync(p.config)) {
    let body = defaultConfigYaml()
    if (vaultPath) {
      // serialize via the YAML library so a path with quotes/backslashes/newlines is safe (H1)
      body = body.replace("vault_path: ''", `vault_path: ${yamlStringify(vaultPath).trim()}`)
    }
    if (preset !== 'fake') {
      body = body
        .replace('agent_mode: file', 'agent_mode: oneshot')
        .replace(
          "developer_command: 'node .between/agents/fake-agent.mjs developer'",
          `developer_command: 'node .between/agents/${presetScript} developer'`,
        )
        .replace(
          "reviewer_command: 'node .between/agents/fake-agent.mjs reviewer'",
          `reviewer_command: 'node .between/agents/${presetScript} reviewer'`,
        )
    }
    await writeFile(p.config, body, 'utf8')
    created.push(p.config)
  }

  if (!existsSync(p.state)) {
    const repo = new StateRepository(absRoot)
    await repo.write(initialState({ project }, clock))
    created.push(p.state)
  }

  // always ship the fake-agent (file-mode default); add the chosen real wrapper too
  const scripts: Array<[string, string]> = [['fake-agent.mjs', FAKE_AGENT_SOURCE]]
  if (preset === 'claude') scripts.push(['claude-agent.mjs', CLAUDE_AGENT_SOURCE])
  if (preset === 'codex') scripts.push(['codex-agent.mjs', CODEX_AGENT_SOURCE])
  for (const [name, source] of scripts) {
    const file = join(p.agents, name)
    if (!existsSync(file)) {
      await writeFile(file, source, 'utf8')
      created.push(file)
    }
  }

  await ensureGitignore(absRoot)

  return { created, alreadyExisted: existedBefore, project }
}

/** Ensure `.between/` is gitignored so the broker's own writes can't self-trigger the loop (I22). */
async function ensureGitignore(root: string): Promise<void> {
  const file = join(root, '.gitignore')
  const entry = '.between/'
  let contents = ''
  try {
    await access(file)
    contents = await readFile(file, 'utf8')
  } catch {
    // no .gitignore yet
  }
  const lines = contents.split(/\r?\n/).map((l) => l.trim())
  if (lines.includes(entry)) return
  const next =
    contents.length > 0 && !contents.endsWith('\n')
      ? `${contents}\n${entry}\n`
      : `${contents}${entry}\n`
  await writeFile(file, next, 'utf8')
}
