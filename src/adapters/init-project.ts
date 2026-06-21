import { mkdir, readFile, writeFile, access, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { Clock, ProjectRef } from '../core/types'
import { defaultConfigYaml } from '../core/config-schema'
import { initialState } from '../core/state'
import { StateRepository } from './state-repository'
import { betweenPaths, betweenSubdirs } from './paths'
import { FAKE_AGENT_SOURCE } from '../agents/fake-agent'
import { CLAUDE_AGENT_SOURCE, CODEX_AGENT_SOURCE } from '../agents/real-agents'
import { PRESET_SCRIPT, type AgentPreset } from '../core/constants'
import { installPrePushHook } from './git-hooks'

export interface InitOptions {
  vaultPath?: string
  /** shorthand: wrap BOTH roles with this preset (fake default). Overridden per-role below. */
  agent?: AgentPreset
  /** developer-role wrapper preset (defaults to `agent`); providers are swappable (A7). */
  developer?: AgentPreset
  /** reviewer-role wrapper preset (defaults to `agent`); e.g. claude dev + codex reviewer. */
  reviewer?: AgentPreset
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

  // A7: each role names its own provider (defaulting to the `--agent` shorthand, else fake).
  const developer: AgentPreset = opts.developer ?? opts.agent ?? 'fake'
  const reviewer: AgentPreset = opts.reviewer ?? opts.agent ?? 'fake'
  const anyReal = developer !== 'fake' || reviewer !== 'fake'

  if (!existsSync(p.config)) {
    let body = defaultConfigYaml()
    if (vaultPath) {
      body = body.replace("vault_path: ''", `vault_path: ${JSON.stringify(vaultPath)}`)
    }
    if (anyReal) body = body.replace('agent_mode: file', 'agent_mode: oneshot')
    // per-role replace (a no-op for fake since PRESET_SCRIPT.fake === fake-agent.mjs)
    body = body
      .replace(
        "developer_command: 'node .between/agents/fake-agent.mjs developer'",
        `developer_command: 'node .between/agents/${PRESET_SCRIPT[developer]} developer'`,
      )
      .replace(
        "reviewer_command: 'node .between/agents/fake-agent.mjs reviewer'",
        `reviewer_command: 'node .between/agents/${PRESET_SCRIPT[reviewer]} reviewer'`,
      )
    await writeFile(p.config, body, 'utf8')
    created.push(p.config)
  }

  if (!existsSync(p.state)) {
    const repo = new StateRepository(absRoot)
    // A5: a fake wrapper in EITHER role makes the project a SIMULATION (not real verification).
    const evidenceTrust = developer === 'fake' || reviewer === 'fake' ? 'simulated' : 'real'
    await repo.write(
      initialState(
        { project, developerName: developer, reviewerName: reviewer, evidenceTrust },
        clock,
      ),
    )
    created.push(p.state)
  }

  // always ship the fake-agent (file-mode default); add whichever real wrappers a role needs
  const scripts: Array<[string, string]> = [['fake-agent.mjs', FAKE_AGENT_SOURCE]]
  const needed = new Set<AgentPreset>([developer, reviewer])
  if (needed.has('claude')) scripts.push(['claude-agent.mjs', CLAUDE_AGENT_SOURCE])
  if (needed.has('codex')) scripts.push(['codex-agent.mjs', CODEX_AGENT_SOURCE])
  for (const [name, source] of scripts) {
    const file = join(p.agents, name)
    if (!existsSync(file)) {
      await writeFile(file, source, 'utf8')
      created.push(file)
    }
  }

  await ensureGitignore(absRoot)

  const hook = installPrePushHook(absRoot)
  if (hook && !existedBefore) created.push(hook)

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
