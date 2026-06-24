import type { Command } from 'commander'
import { loadConfig } from '../runtime'
import { updateIdeConfig } from '../ide/config'
import {
  buildIdeCliInvocation,
  buildIdeProfile,
  formatIdeCliInvocation,
  formatIdeProfile,
  type IdeTarget,
} from '../ide/profile'
import { print, printJson } from './output'
import { fail, root } from './shared'

interface IdeCommandOptions {
  readonly json?: boolean
  readonly builderAgents?: number
  readonly reviewerAgents?: number
  readonly rulesMode?: 'project_only' | 'inherit_global'
  readonly permissionMode?: 'read_only' | 'guard' | 'full_access'
  readonly workingFolder?: string
  readonly followupMode?: 'steer' | 'queue'
  readonly printCli?: string
}

export function registerIdeCommand(program: Command): void {
  program
    .command('ide')
    .description('Project-local IDE control plane, topology, and local CLI invocation profile')
    .option('--json', 'output machine-readable JSON')
    .option('--builder-agents <n>', 'set project-local Builder agent count (1-16)', parseCount)
    .option('--reviewer-agents <n>', 'set project-local Reviewer agent count (1-16)', parseCount)
    .option(
      '--rules-mode <mode>',
      'set IDE CLI rule profile: project_only | inherit_global',
      parseRulesMode,
    )
    .option(
      '--permission-mode <mode>',
      'set IDE permission intent: read_only | guard | full_access',
      parsePermissionMode,
    )
    .option(
      '--working-folder <path>',
      'set project-local working folder hint for IDE-launched agents',
      parseWorkingFolder,
    )
    .option('--followup-mode <mode>', 'set IDE follow-up intent: steer | queue', parseFollowupMode)
    .option(
      '--print-cli <target>',
      'print IDE-only local CLI invocation for builder | reviewer | builder:n | reviewer:n',
    )
    .action(async (opts: IdeCommandOptions) => {
      try {
        await updateTopologyIfRequested(opts)
        const cfg = await loadConfig(root())
        const profile = buildIdeProfile(cfg)
        const role = parseOptionalRole(opts.printCli)
        const invocation = role ? buildIdeCliInvocation(root(), role, cfg) : null
        if (opts.json) {
          printJson({ profile, invocation })
          return
        }
        print(formatIdeProfile(profile))
        if (invocation) {
          print('')
          print('IDE-only CLI invocation')
          print(formatIdeCliInvocation(invocation))
        }
      } catch (e) {
        await fail(e)
      }
    })
}

async function updateTopologyIfRequested(opts: IdeCommandOptions): Promise<void> {
  if (
    opts.builderAgents === undefined &&
    opts.reviewerAgents === undefined &&
    opts.rulesMode === undefined &&
    opts.permissionMode === undefined &&
    opts.workingFolder === undefined &&
    opts.followupMode === undefined
  ) {
    return
  }
  await updateIdeConfig(root(), {
    builderAgentCount: opts.builderAgents,
    reviewerAgentCount: opts.reviewerAgents,
    rulesMode: opts.rulesMode,
    permissionMode: opts.permissionMode,
    workingFolder: opts.workingFolder,
    followupMode: opts.followupMode,
  })
}

function parseCount(value: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 16) {
    throw new Error('agent count must be an integer from 1 to 16')
  }
  return n
}

function parseOptionalRole(value: string | undefined): IdeTarget | string | null {
  if (value === undefined) return null
  if (/^(builder|reviewer)(:[1-9][0-9]*)?$/.test(value)) return value
  throw new Error('--print-cli must be builder, reviewer, builder:n, or reviewer:n')
}

function parseRulesMode(value: string): 'project_only' | 'inherit_global' {
  if (value === 'project_only' || value === 'inherit_global') return value
  throw new Error('--rules-mode must be project_only or inherit_global')
}

function parsePermissionMode(value: string): 'read_only' | 'guard' | 'full_access' {
  if (value === 'read_only' || value === 'guard' || value === 'full_access') return value
  throw new Error('--permission-mode must be read_only, guard, or full_access')
}

function parseFollowupMode(value: string): 'steer' | 'queue' {
  if (value === 'steer' || value === 'queue') return value
  throw new Error('--followup-mode must be steer or queue')
}

function parseWorkingFolder(value: string): string {
  const normalized = value.replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error('ide_working_folder must be a project-local relative path')
  }
  if (normalized.split('/').includes('..')) {
    throw new Error('ide_working_folder must be a project-local relative path')
  }
  return value
}
