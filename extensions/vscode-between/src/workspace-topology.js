import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { BetweenWorkspaceError } from './workspace-errors.js'

export async function configureTopology(root, action) {
  const builder = parseAgentCount(action.builderAgentCount, 'builderAgentCount')
  const reviewer = parseAgentCount(action.reviewerAgentCount, 'reviewerAgentCount')
  const path = join(root, '.between', 'config.yaml')
  const before = existsSync(path)
    ? await readFile(path, 'utf8')
    : 'schema_version: 1\nide_cli_rules_mode: project_only\n'
  const config = parseConfigYaml(before)
  const permissionMode = parsePermissionMode(
    action.permissionMode ?? readScalar(config, 'ide_permission_mode') ?? 'guard',
    'permissionMode',
  )
  const workingFolder = parseWorkingFolder(
    action.workingFolder ?? readScalar(config, 'ide_working_folder') ?? '.',
    'workingFolder',
  )
  const followupMode = parseFollowupMode(
    action.followupMode ?? readScalar(config, 'ide_followup_mode') ?? 'steer',
    'followupMode',
  )
  const patch = [
    ['builder_agent_count', String(builder)],
    ['reviewer_agent_count', String(reviewer)],
  ]
  if (action.permissionMode !== undefined) {
    patch.push(['ide_permission_mode', permissionMode])
  }
  if (action.workingFolder !== undefined) {
    patch.push(['ide_working_folder', yamlScalar(workingFolder)])
  }
  if (action.followupMode !== undefined) {
    patch.push(['ide_followup_mode', followupMode])
  }
  const after = patch.reduce((text, [key, value]) => setYamlScalar(text, key, value), before)
  await writeFile(path, after, 'utf8')
  return {
    ok: true,
    builderAgentCount: builder,
    reviewerAgentCount: reviewer,
    permissionMode,
    workingFolder,
    followupMode,
  }
}

export async function readIdeProfile(root) {
  const path = join(root, '.between', 'config.yaml')
  const text = existsSync(path) ? await readFile(path, 'utf8') : ''
  const config = parseConfigYaml(text)
  const builderAgentCount = parseAgentCount(
    readScalar(config, 'builder_agent_count') ?? '1',
    'builder_agent_count',
  )
  const reviewerAgentCount = parseAgentCount(
    readScalar(config, 'reviewer_agent_count') ?? '1',
    'reviewer_agent_count',
  )
  const rulesMode =
    readScalar(config, 'ide_cli_rules_mode') === 'inherit_global'
      ? 'inherit_global'
      : 'project_only'
  const permissionMode = parsePermissionMode(
    readScalar(config, 'ide_permission_mode') ?? 'guard',
    'ide_permission_mode',
  )
  const workingFolder = parseWorkingFolder(
    readScalar(config, 'ide_working_folder') ?? '.',
    'ide_working_folder',
  )
  const followupMode = parseFollowupMode(
    readScalar(config, 'ide_followup_mode') ?? 'steer',
    'ide_followup_mode',
  )
  return {
    builderAgentCount,
    reviewerAgentCount,
    rulesMode,
    permissionMode,
    workingFolder,
    followupMode,
    panes: [
      ...buildPanes('builder', builderAgentCount),
      ...buildPanes('reviewer', reviewerAgentCount),
    ],
  }
}

function buildPanes(role, count) {
  return Array.from({ length: count }, (_unused, index) => {
    const n = index + 1
    const label = `${role === 'builder' ? 'Builder' : 'Reviewer'} ${n}`
    return { id: `${role}-${n}`, label, role, target: `${role}:${n}` }
  })
}

function parseAgentCount(value, label) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 16) {
    throw new BetweenWorkspaceError(`${label} must be an integer from 1 to 16`)
  }
  return n
}

function parsePermissionMode(value, label) {
  if (value === 'read_only' || value === 'guard' || value === 'full_access') return value
  throw new BetweenWorkspaceError(`${label} must be read_only, guard, or full_access`)
}

function parseFollowupMode(value, label) {
  if (value === 'steer' || value === 'queue') return value
  throw new BetweenWorkspaceError(`${label} must be steer or queue`)
}

function parseWorkingFolder(value, label) {
  const normalized = String(value ?? '').replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new BetweenWorkspaceError(`${label} must be a project-local relative path`)
  }
  if (normalized.split('/').includes('..')) {
    throw new BetweenWorkspaceError(`${label} must be a project-local relative path`)
  }
  return String(value)
}

function parseConfigYaml(text) {
  if (!text.trim()) return {}
  try {
    const parsed = parseYaml(text)
    if (parsed === null || parsed === undefined) return {}
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BetweenWorkspaceError('config.yaml must be a YAML mapping')
    }
    return parsed
  } catch (error) {
    if (error instanceof BetweenWorkspaceError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new BetweenWorkspaceError(`config.yaml must be valid YAML: ${message}`)
  }
}

function readScalar(config, key) {
  const value = config[key]
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  throw new BetweenWorkspaceError(`${key} must be a scalar value`)
}

function setYamlScalar(text, key, value) {
  const safeKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^(\\s*${safeKey}:\\s*)(.*)$`, 'm')
  if (re.test(text)) {
    return text.replace(re, (_match, prefix, tail) => {
      return `${prefix}${value}${trailingYamlComment(tail)}`
    })
  }
  const sep = text.endsWith('\n') || text.length === 0 ? '' : '\n'
  return `${text}${sep}${key}: ${value}\n`
}

function yamlScalar(value) {
  return JSON.stringify(value)
}

function trailingYamlComment(tail) {
  let quote = null
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
