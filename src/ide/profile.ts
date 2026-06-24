import { join } from 'node:path'
import type { BetweenConfig } from '../core/config-schema'

export type IdeRole = 'builder' | 'reviewer'
export type IdeTarget = IdeRole | `${IdeRole}:${number}`

export interface IdePaneTarget {
  readonly id: string
  readonly label: string
  readonly role: IdeRole
  readonly target: string
}

export interface IdeProfile {
  readonly builderAgentCount: number
  readonly reviewerAgentCount: number
  readonly rulesMode: BetweenConfig['ide_cli_rules_mode']
  readonly permissionMode: BetweenConfig['ide_permission_mode']
  readonly workingFolder: string
  readonly followupMode: BetweenConfig['ide_followup_mode']
  readonly panes: readonly IdePaneTarget[]
}

export interface IdeCliInvocation {
  readonly role: IdeRole
  readonly target: string
  readonly command: string
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  readonly bypassesGlobalRules: boolean
  readonly bypassesBrokerPolicy: false
}

export function buildIdeProfile(config: BetweenConfig): IdeProfile {
  return {
    builderAgentCount: config.builder_agent_count,
    reviewerAgentCount: config.reviewer_agent_count,
    rulesMode: config.ide_cli_rules_mode,
    permissionMode: config.ide_permission_mode,
    workingFolder: config.ide_working_folder,
    followupMode: config.ide_followup_mode,
    panes: [
      ...buildPanes('builder', config.builder_agent_count),
      ...buildPanes('reviewer', config.reviewer_agent_count),
    ],
  }
}

export function buildIdeCliInvocation(
  root: string,
  target: IdeTarget | string,
  config: BetweenConfig,
): IdeCliInvocation {
  const pane = resolveIdeTarget(target, config)
  const command = pane.role === 'builder' ? config.developer_command : config.reviewer_command
  const env: Record<string, string> = {
    BETWEEN_IDE: '1',
    BETWEEN_IDE_ROLE: pane.role,
    BETWEEN_IDE_TARGET: pane.target,
    BETWEEN_IDE_RULES: config.ide_cli_rules_mode,
    BETWEEN_IDE_PERMISSION_MODE: config.ide_permission_mode,
    BETWEEN_IDE_WORKING_FOLDER: config.ide_working_folder,
    BETWEEN_IDE_FOLLOWUP_MODE: config.ide_followup_mode,
    BETWEEN_ROOT: root,
  }
  if (isCodexCommand(command)) {
    env.CODEX_HOME = join(root, config.ide_cli_profile_dir, 'codex')
  }
  return {
    role: pane.role,
    target: pane.target,
    command,
    cwd: config.agent_cwd || root,
    env,
    bypassesGlobalRules: config.ide_cli_rules_mode === 'project_only',
    bypassesBrokerPolicy: false,
  }
}

export function resolveIdeTarget(target: IdeTarget | string, config: BetweenConfig): IdePaneTarget {
  const normalized =
    target === 'builder' || target === 'reviewer' ? `${target}:1` : String(target).trim()
  const pane = buildIdeProfile(config).panes.find((item) => item.target === normalized)
  if (!pane) {
    throw new Error(
      `Unknown IDE target "${target}". Expected builder:1-${config.builder_agent_count} or reviewer:1-${config.reviewer_agent_count}`,
    )
  }
  return pane
}

export function formatIdeProfile(profile: IdeProfile): string {
  const ruleText =
    profile.rulesMode === 'project_only'
      ? 'project-only, global rules bypassed for IDE CLI; broker policy still enforced'
      : 'inherits global agent rules; broker policy still enforced'
  return [
    'Between IDE topology',
    `  Builder agents:  ${profile.builderAgentCount}`,
    `  Reviewer agents: ${profile.reviewerAgentCount}`,
    `  Rule profile:    ${ruleText}`,
    `  Permission mode: ${profile.permissionMode}`,
    `  Working folder:  ${profile.workingFolder}`,
    `  Follow-up mode:  ${profile.followupMode}`,
    '  Targets:',
    ...profile.panes.map((pane) => `    - ${pane.target} (${pane.label})`),
  ].join('\n')
}

export function formatIdeCliInvocation(invocation: IdeCliInvocation): string {
  return [
    `role: ${invocation.role}`,
    `target: ${invocation.target}`,
    `cwd: ${invocation.cwd}`,
    `command: ${invocation.command}`,
    'env:',
    ...Object.entries(invocation.env).map(([key, value]) => `  ${key}=${quoteShell(value)}`),
    `bypasses_global_rules: ${invocation.bypassesGlobalRules}`,
    `bypasses_broker_policy: ${invocation.bypassesBrokerPolicy}`,
  ].join('\n')
}

function buildPanes(role: IdeRole, count: number): IdePaneTarget[] {
  return Array.from({ length: count }, (_unused, index) => {
    const n = index + 1
    const label = `${role === 'builder' ? 'Builder' : 'Reviewer'} ${n}`
    return { id: `${role}-${n}`, label, role, target: `${role}:${n}` }
  })
}

function quoteShell(value: string): string {
  return JSON.stringify(value)
}

function isCodexCommand(command: string): boolean {
  const normalized = command.trim().replaceAll('\\', '/').toLowerCase()
  const first = normalized.split(/\s+/)[0] ?? ''
  return first === 'codex' || first.endsWith('/codex') || isGeneratedCodexWrapper(normalized)
}

function isGeneratedCodexWrapper(command: string): boolean {
  return /(^|\s)(["']?)\.between\/agents\/codex-agent\.mjs\2(\s|$)/.test(command)
}
