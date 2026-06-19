import { readFile, writeFile } from 'node:fs/promises'
import type { Clock } from '../core/types'
import { SystemClock } from '../core/clock'
import { initProject } from '../adapters/init-project'
import { betweenPaths } from '../adapters/paths'
import { planOnboarding, applyConfigPatch, TOKEN_ENV, type Channel, type AgentPreset } from './plan'
import { smokeChannel, type FetchLike, type SmokeResult } from './smoke'

const CHANNELS: Channel[] = ['echo', 'telegram', 'discord']
const AGENTS: AgentPreset[] = ['fake', 'claude', 'codex']

export interface OnboardOptions {
  channel?: Channel
  agent?: AgentPreset
  vault?: string
  chatId?: string
  /** when true, never prompt — fall back to provided opts / safe defaults (CI, tests). */
  nonInteractive?: boolean
}

export interface OnboardIO {
  /** ask the user a question and resolve to their trimmed answer (interactive only). */
  ask(prompt: string): Promise<string>
  print(line: string): void
  env: NodeJS.ProcessEnv
  fetchImpl?: FetchLike
  clock?: Clock
}

export interface OnboardOutcome {
  channel: Channel
  agent: AgentPreset
  initialized: boolean
  smoke: SmokeResult | null
  warnings: string[]
  nextSteps: string[]
}

function asEnum<T extends string>(value: string | undefined, allowed: T[], fallback: T): T {
  return value && (allowed as string[]).includes(value) ? (value as T) : fallback
}

/**
 * First-run onboarding: scaffold the workspace, choose + persist the gateway channel (token stays
 * in env), and smoke-test the credentials. Prompts only for fields not supplied as options and
 * only when interactive; otherwise uses opts/defaults. IO is injected so it is fully testable.
 */
export async function runOnboard(
  root: string,
  opts: OnboardOptions,
  io: OnboardIO,
): Promise<OnboardOutcome> {
  const clock = io.clock ?? new SystemClock()
  const interactive = !opts.nonInteractive

  // 1) choose channel + agent (prompt only for what's missing)
  let channel = asEnum(opts.channel, CHANNELS, 'echo')
  if (interactive && !opts.channel) {
    const a = await io.ask(`Gateway channel? [echo|telegram|discord] (echo): `)
    channel = asEnum(a, CHANNELS, 'echo')
  }
  let agent = asEnum(opts.agent, AGENTS, 'fake')
  if (interactive && !opts.agent) {
    const a = await io.ask(`Agent wrappers? [fake|claude|codex] (fake): `)
    agent = asEnum(a, AGENTS, 'fake')
  }
  let vault = opts.vault
  if (interactive && opts.vault === undefined) {
    const a = await io.ask(`Obsidian vault path for memory? (blank to skip): `)
    vault = a || undefined
  }
  let chatId = opts.chatId
  if (interactive && channel !== 'echo' && opts.chatId === undefined) {
    const label = channel === 'telegram' ? 'chat id' : 'channel id'
    const a = await io.ask(`${channel} ${label} to notify? (blank to skip): `)
    chatId = a || undefined
  }

  // 2) scaffold workspace (idempotent) — also writes the chosen agent's wrapper scripts
  const init = await initProject(root, { vaultPath: vault || undefined, agent }, clock)
  io.print(init.alreadyExisted ? 'workspace: already initialized' : 'workspace: initialized')

  // 3) plan + apply config patch (secrets excluded by construction)
  const hasTokenEnv = channel !== 'echo' && Boolean(io.env[TOKEN_ENV[channel]])
  const plan = planOnboarding({ channel, agent, vaultPath: vault, chatId, hasTokenEnv })
  const cfgPath = betweenPaths(root).config
  const before = await readFile(cfgPath, 'utf8')
  const after = applyConfigPatch(before, plan.configPatch)
  if (after !== before) await writeFile(cfgPath, after, 'utf8')
  io.print(`gateway: ${channel}${chatId ? ` -> ${chatId}` : ''}`)

  // 4) smoke-test the live channel's credentials (no message sent)
  let smoke: SmokeResult | null = null
  if (plan.smoke) {
    const token = io.env[TOKEN_ENV[plan.smoke]]
    smoke = await smokeChannel(plan.smoke, token, io.fetchImpl)
    io.print(`smoke:   ${smoke.ok ? 'ok' : 'FAILED'} — ${smoke.detail}`)
  }

  for (const w of plan.warnings) io.print(`! ${w}`)
  if (plan.nextSteps.length) {
    io.print('next:')
    for (const s of plan.nextSteps) io.print(`  ${s}`)
  }

  return {
    channel,
    agent,
    initialized: !init.alreadyExisted,
    smoke,
    warnings: plan.warnings,
    nextSteps: plan.nextSteps,
  }
}
