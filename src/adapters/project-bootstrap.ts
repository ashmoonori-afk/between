import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execa } from 'execa'
import type { Clock } from '../core/types'
import { SystemClock } from '../core/clock'
import type { AgentPreset } from '../core/constants'
import { betweenPaths } from './paths'
import { initProject } from './init-project'
import { installPrePushHookDetailed, type PrePushHookInstallResult } from './git-hooks'
import { APPROVAL_SECRET_ENV, resolveApprovalSecret } from './approval-secret'

export type ProjectBootstrapLevel = 'ok' | 'warn' | 'error'

export interface ProjectBootstrapAction {
  readonly level: ProjectBootstrapLevel
  readonly code: string
  readonly message: string
}

export interface ProjectStartBootstrapResult {
  readonly root: string
  readonly actions: readonly ProjectBootstrapAction[]
  readonly gitReady: boolean
  readonly betweenReady: boolean
  readonly approvalSecretReady: boolean
}

export interface ProjectStartBootstrapOptions {
  readonly clock?: Clock
  readonly preferPty?: boolean
  readonly developer?: AgentPreset
  readonly reviewer?: AgentPreset
}

export async function ensureProjectStartBootstrap(
  root: string,
  opts: ProjectStartBootstrapOptions = {},
): Promise<ProjectStartBootstrapResult> {
  const absRoot = resolve(root)
  const clock = opts.clock ?? new SystemClock()
  const actions: ProjectBootstrapAction[] = []
  let gitReady = await isGitRepo(absRoot)

  if (!gitReady) {
    const initialized = await gitInit(absRoot)
    actions.push(initialized)
    gitReady = initialized.level === 'ok'
  } else {
    actions.push(ok('git_ready', 'git repository ready'))
  }

  const paths = betweenPaths(absRoot)
  const hadPrePushHook = existsSync(join(absRoot, '.git', 'hooks', 'pre-push'))
  const hadConfig = existsSync(paths.config)
  const hadState = existsSync(paths.state)
  if (!hadConfig || !hadState) {
    await initProject(
      absRoot,
      { developer: opts.developer ?? 'claude', reviewer: opts.reviewer ?? 'codex' },
      clock,
    )
    actions.push(
      ok('between_initialized', 'project initialized with Claude developer and Codex reviewer'),
    )
    if (!hadConfig && opts.preferPty) {
      await switchNewProjectToPty(paths.config)
      actions.push(ok('terminal_agents_enabled', 'embedded terminal agents enabled'))
    }
  } else {
    actions.push(ok('between_ready', 'between project ready'))
  }

  if (gitReady) actions.push(hookAction(installPrePushHookDetailed(absRoot), hadPrePushHook))

  const configText = existsSync(paths.config) ? await readFile(paths.config, 'utf8') : ''
  if (configText.includes('fake-agent.mjs')) {
    actions.push(
      warn(
        'real_agents_required',
        'fake agent config detected; run between init --developer claude --reviewer codex for real review',
      ),
    )
  }

  const approvalSecretReady = Boolean(resolveApprovalSecret(absRoot))
  if (!approvalSecretReady) {
    actions.push(
      warn(
        'approval_secret_missing',
        `set ${APPROVAL_SECRET_ENV} before merge approval to keep push permission human-signed`,
      ),
    )
  }

  return {
    root: absRoot,
    actions,
    gitReady,
    betweenReady: existsSync(paths.config) && existsSync(paths.state),
    approvalSecretReady,
  }
}

export function formatProjectStartBootstrap(result: ProjectStartBootstrapResult): string[] {
  return result.actions
    .filter((action) => action.code !== 'git_ready' && action.code !== 'between_ready')
    .map((action) => `between: ${action.level} ${action.code} - ${action.message}`)
}

async function isGitRepo(root: string): Promise<boolean> {
  const result = await execa('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: root,
    reject: false,
  }).catch(() => null)
  return result?.exitCode === 0 && result.stdout.trim() === 'true'
}

async function gitInit(root: string): Promise<ProjectBootstrapAction> {
  try {
    const result = await execa('git', ['init', '-q'], { cwd: root, reject: false })
    return result.exitCode === 0
      ? ok('git_initialized', 'git init completed')
      : error('git_init_failed', result.stderr || 'git init failed')
  } catch (e) {
    return error('git_init_failed', e instanceof Error ? e.message : String(e))
  }
}

async function switchNewProjectToPty(configPath: string): Promise<void> {
  const body = await readFile(configPath, 'utf8')
  const next = body
    .replace('agent_mode: oneshot', 'agent_mode: pty')
    .replace(
      "developer_command: 'node .between/agents/claude-agent.mjs developer'",
      "developer_command: 'claude'",
    )
    .replace(
      "reviewer_command: 'node .between/agents/codex-agent.mjs reviewer'",
      "reviewer_command: 'codex'",
    )
  await writeFile(configPath, next, 'utf8')
}

function hookAction(
  result: PrePushHookInstallResult,
  hadPrePushHook: boolean,
): ProjectBootstrapAction {
  switch (result.kind) {
    case 'installed':
      return ok('pre_push_hook_installed', 'pre-push review gate installed')
    case 'already_installed':
      if (!hadPrePushHook) return ok('pre_push_hook_installed', 'pre-push review gate installed')
      return ok('pre_push_hook_ready', 'pre-push review gate ready')
    case 'not_git_repo':
      return warn('pre_push_hook_skipped', 'not a git repository')
    case 'conflict':
      return warn('pre_push_hook_conflict', `existing pre-push hook left unchanged: ${result.path}`)
    case 'failed':
      return error('pre_push_hook_failed', result.reason)
    default: {
      const _never: never = result
      return _never
    }
  }
}

function ok(code: string, message: string): ProjectBootstrapAction {
  return { level: 'ok', code, message }
}

function warn(code: string, message: string): ProjectBootstrapAction {
  return { level: 'warn', code, message }
}

function error(code: string, message: string): ProjectBootstrapAction {
  return { level: 'error', code, message }
}
