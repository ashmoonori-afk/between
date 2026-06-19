import type { ApprovalScope } from './types'

/**
 * Single source of truth for the small enumerations that were previously duplicated across
 * cli.ts / gateway / onboard / adapters. Types live in core; values here.
 */

export const APPROVAL_SCOPES: ApprovalScope[] = ['merge', 'deploy', 'promote_rule']

export const AGENT_PRESETS = ['fake', 'claude', 'codex'] as const
export type AgentPreset = (typeof AGENT_PRESETS)[number]

export const GATEWAY_CHANNELS = ['echo', 'telegram', 'discord'] as const
export type GatewayChannel = (typeof GATEWAY_CHANNELS)[number]

/** Maps an agent preset to its wrapper script filename under `.between/agents/`. */
export const PRESET_SCRIPT: Record<AgentPreset, string> = {
  fake: 'fake-agent.mjs',
  claude: 'claude-agent.mjs',
  codex: 'codex-agent.mjs',
}
