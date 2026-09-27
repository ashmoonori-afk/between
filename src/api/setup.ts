import { execa } from 'execa'
import type { Clock } from '../core/types'
import { SystemClock } from '../core/clock'
import { AGENT_PRESETS, type AgentPreset } from '../core/constants'
import { initProject, type InitResult } from '../adapters/init-project'
import { GitAdapter } from '../adapters/git'
import { loadConfig } from '../runtime'
import { BetweenApiError } from './errors'

export function parseAgentPreset(
  value: string | undefined,
  label: string,
): AgentPreset | undefined {
  if (value && !AGENT_PRESETS.includes(value as AgentPreset)) {
    throw new BetweenApiError(
      'invalid_argument',
      `${label} must be one of: ${AGENT_PRESETS.join(', ')}`,
    )
  }
  return value as AgentPreset | undefined
}

export interface InitWorkspaceOptions {
  vaultPath?: string
  agent?: AgentPreset
  developer?: AgentPreset
  reviewer?: AgentPreset
}

/** Create or refresh `.between/` scaffolding, config, and initial state (idempotent). */
export async function initWorkspace(
  root: string,
  opts: InitWorkspaceOptions = {},
  clock: Clock = new SystemClock(),
): Promise<InitResult> {
  return initProject(root, opts, clock)
}

export interface DoctorCheck {
  ok: boolean | 'warn'
  label: string
}

export interface DoctorReport {
  checks: DoctorCheck[]
  /** false when any check failed outright (warnings do not fail). */
  ok: boolean
}

/** Diagnose git, repo, config, vault, and optional pty support. `strict` adds the secret policy. */
export async function runDoctor(
  root: string,
  opts: { strict?: boolean } = {},
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = []
  const git = new GitAdapter(root)
  try {
    const v = await execa('git', ['--version'], { reject: false })
    checks.push({ ok: v.exitCode === 0, label: `git: ${v.stdout.trim() || 'not found'}` })
  } catch {
    checks.push({ ok: false, label: 'git: not found' })
  }
  checks.push({ ok: await git.isRepo(), label: 'inside a git work tree' })
  try {
    const cfg = await loadConfig(root)
    checks.push({ ok: true, label: 'between initialized (config valid)' })
    checks.push({
      ok: cfg.vault_path ? true : 'warn',
      label: cfg.vault_path
        ? `vault: ${cfg.vault_path}`
        : 'vault: not set (Obsidian memory disabled)',
    })
    if (opts.strict) {
      // A6: bot tokens must live in env, never in config.yaml — fail strict if one leaked in.
      const secretInConfig = Boolean(cfg.telegram_bot_token) || Boolean(cfg.discord_bot_token)
      checks.push({
        ok: secretInConfig ? false : true,
        label: secretInConfig
          ? 'SECRET in config.yaml — move telegram_bot_token/discord_bot_token to BETWEEN_*_TOKEN env'
          : 'no literal bot tokens in config.yaml (env-only policy)',
      })
    }
  } catch {
    checks.push({ ok: false, label: 'between initialized (run `between init`)' })
  }
  let ptyOk = false
  try {
    const ptyModule = '@lydell/node-pty'
    await import(ptyModule)
    ptyOk = true
  } catch {
    ptyOk = false
  }
  checks.push({
    ok: ptyOk ? true : 'warn',
    label: ptyOk
      ? '@lydell/node-pty available (terminal mode ready)'
      : 'node-pty unavailable (headless file-signal mode only)',
  })
  return { checks, ok: !checks.some((c) => c.ok === false) }
}
