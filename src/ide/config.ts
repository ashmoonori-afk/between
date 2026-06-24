import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import { betweenPaths } from '../adapters/paths'
import { parseConfig, type BetweenConfig } from '../core/config-schema'
import { applyConfigPatch } from '../onboard/plan'

export interface IdeConfigPatch {
  readonly builderAgentCount?: number
  readonly reviewerAgentCount?: number
  readonly rulesMode?: BetweenConfig['ide_cli_rules_mode']
  readonly profileDir?: string
  readonly permissionMode?: BetweenConfig['ide_permission_mode'] | string
  readonly workingFolder?: string
  readonly followupMode?: BetweenConfig['ide_followup_mode'] | string
}

export async function updateIdeConfig(root: string, patch: IdeConfigPatch): Promise<BetweenConfig> {
  const configPath = betweenPaths(root).config
  const scalarPatch = buildScalarPatch(patch)
  const before = await readFile(configPath, 'utf8')
  const after = applyConfigPatch(before, scalarPatch)
  const config = parseConfig(parseYaml(after))
  await writeConfigAtomically(configPath, after)
  return config
}

function buildScalarPatch(patch: IdeConfigPatch): Array<[string, string]> {
  const out: Array<[string, string]> = []
  if (patch.builderAgentCount !== undefined) {
    out.push(['builder_agent_count', String(assertAgentCount(patch.builderAgentCount))])
  }
  if (patch.reviewerAgentCount !== undefined) {
    out.push(['reviewer_agent_count', String(assertAgentCount(patch.reviewerAgentCount))])
  }
  if (patch.rulesMode !== undefined) {
    if (patch.rulesMode !== 'project_only' && patch.rulesMode !== 'inherit_global') {
      throw new Error('rules mode must be project_only or inherit_global')
    }
    out.push(['ide_cli_rules_mode', patch.rulesMode])
  }
  if (patch.profileDir !== undefined) {
    out.push(['ide_cli_profile_dir', yamlScalar(patch.profileDir)])
  }
  if (patch.permissionMode !== undefined) {
    out.push(['ide_permission_mode', assertPermissionMode(patch.permissionMode)])
  }
  if (patch.workingFolder !== undefined) {
    out.push([
      'ide_working_folder',
      yamlScalar(assertProjectLocalWorkingFolder(patch.workingFolder)),
    ])
  }
  if (patch.followupMode !== undefined) {
    out.push(['ide_followup_mode', assertFollowupMode(patch.followupMode)])
  }
  return out
}

function assertAgentCount(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 16) {
    throw new Error('agent count must be an integer from 1 to 16')
  }
  return value
}

function yamlScalar(value: string): string {
  return JSON.stringify(value)
}

function assertPermissionMode(value: string): BetweenConfig['ide_permission_mode'] {
  if (value === 'read_only' || value === 'guard' || value === 'full_access') return value
  throw new Error('permission mode must be read_only, guard, or full_access')
}

function assertFollowupMode(value: string): BetweenConfig['ide_followup_mode'] {
  if (value === 'steer' || value === 'queue') return value
  throw new Error('follow-up mode must be steer or queue')
}

function assertProjectLocalWorkingFolder(value: string): string {
  const normalized = value.replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error('ide_working_folder must be a project-local relative path')
  }
  if (normalized.split('/').includes('..')) {
    throw new Error('ide_working_folder must be a project-local relative path')
  }
  return value
}

async function writeConfigAtomically(path: string, text: string): Promise<void> {
  const tmp = `${path}.${randomUUID()}.tmp`
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, path)
}
