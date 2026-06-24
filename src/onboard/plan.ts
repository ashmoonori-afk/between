import type { BetweenConfig } from '../core/config-schema'
import { PRESET_SCRIPT } from '../core/constants'

/** Chat channels a first-run user can wire the broker to. */
export type Channel = BetweenConfig['gateway_channel']
/** Agent wrappers the developer/reviewer roles can run as. */
import type { AgentPreset } from '../core/constants'
export type { AgentPreset }

export interface OnboardAnswers {
  channel: Channel
  agent: AgentPreset
  /** Obsidian vault root for human-readable memory (optional). */
  vaultPath?: string
  /** telegram chat id OR discord channel id to notify (optional, non-secret). */
  chatId?: string
  /** whether the channel's token env var is already set in the environment. */
  hasTokenEnv: boolean
}

export interface OnboardPlan {
  /** ordered [key, value] scalars to write into config.yaml (comments preserved). */
  configPatch: Array<[string, string]>
  /** env var the user must export for the chosen live channel (secret stays out of config). */
  envVarNeeded: string | null
  /** which live channel to smoke-test after applying, or null for echo. */
  smoke: Exclude<Channel, 'echo'> | null
  warnings: string[]
  nextSteps: string[]
}

/** Token env var per live channel — tokens are NEVER written to config.yaml (secrets stay in env). */
export const TOKEN_ENV: Record<Exclude<Channel, 'echo'>, string> = {
  telegram: 'BETWEEN_TELEGRAM_TOKEN',
  discord: 'BETWEEN_DISCORD_TOKEN',
}

/** Quote a YAML scalar so paths with spaces/backslashes and numeric-looking ids stay literal. */
function yamlScalar(value: string): string {
  return JSON.stringify(value) // JSON strings are valid YAML double-quoted scalars
}

/**
 * Pure: turn first-run answers into a config patch + the env var the user must set + a smoke
 * target + warnings/next-steps. Keeps all secrets (bot tokens) OUT of config.yaml — only the
 * non-secret chat/channel id is persisted; the token lives in `BETWEEN_*_TOKEN`. Unit-tested.
 */
export function planOnboarding(answers: OnboardAnswers): OnboardPlan {
  const configPatch: Array<[string, string]> = [['gateway_channel', answers.channel]]
  const warnings: string[] = []
  const nextSteps: string[] = []

  if (answers.vaultPath && answers.vaultPath.trim()) {
    configPatch.push(['vault_path', yamlScalar(answers.vaultPath.trim())])
  }

  if (answers.agent !== 'fake') {
    const script = PRESET_SCRIPT[answers.agent]
    configPatch.push(['agent_mode', 'oneshot'])
    configPatch.push(['developer_command', yamlScalar(`node .between/agents/${script} developer`)])
    configPatch.push(['reviewer_command', yamlScalar(`node .between/agents/${script} reviewer`)])
  }

  let envVarNeeded: string | null = null
  let smoke: Exclude<Channel, 'echo'> | null = null

  if (answers.channel !== 'echo') {
    envVarNeeded = TOKEN_ENV[answers.channel]
    smoke = answers.channel
    const idKey = answers.channel === 'telegram' ? 'telegram_chat_id' : 'discord_channel_id'
    if (answers.chatId && answers.chatId.trim()) {
      configPatch.push([idKey, yamlScalar(answers.chatId.trim())])
    }
    if (!answers.hasTokenEnv) {
      warnings.push(
        `${envVarNeeded} is not set — export it before \`between gateway\` (the token must NOT go in config.yaml).`,
      )
      nextSteps.push(
        `Set ${envVarNeeded} in your shell environment without putting the token in command text`,
      )
    }
    nextSteps.push('between gateway   # bridge the chat to the broker')
  } else {
    nextSteps.push('between gateway   # echo channel (no credentials needed)')
  }

  nextSteps.push('between start     # run the broker watcher loop')

  return { configPatch, envVarNeeded, smoke, warnings, nextSteps }
}

/**
 * Replace the value of a `key: value   # comment` line in a YAML body, preserving any trailing
 * comment and indentation. Quoted `#` characters remain part of the scalar. Appends `key: value`
 * if the key is absent. Pure + unit-tested.
 */
export function setYamlScalar(text: string, key: string, value: string): string {
  const safeKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^(\\s*${safeKey}:\\s*)(.*)$`, 'm')
  if (re.test(text)) {
    return text.replace(re, (_m, prefix: string, tail: string) => {
      return `${prefix}${value}${trailingYamlComment(tail)}`
    })
  }
  const sep = text.endsWith('\n') || text.length === 0 ? '' : '\n'
  return `${text}${sep}${key}: ${value}\n`
}

/** Apply an ordered config patch to a YAML body. */
export function applyConfigPatch(text: string, patch: Array<[string, string]>): string {
  return patch.reduce((acc, [key, value]) => setYamlScalar(acc, key, value), text)
}

function trailingYamlComment(tail: string): string {
  let quote: '"' | "'" | null = null
  let escaped = false

  for (let index = 0; index < tail.length; index += 1) {
    const ch = tail[index]
    if (quote === '"') {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === quote) {
        quote = null
      }
      continue
    }
    if (quote === "'") {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '#' && (index === 0 || /\s/.test(tail[index - 1] ?? ''))) {
      let start = index
      while (start > 0 && /\s/.test(tail[start - 1] ?? '')) start -= 1
      return tail.slice(start)
    }
  }

  return ''
}
