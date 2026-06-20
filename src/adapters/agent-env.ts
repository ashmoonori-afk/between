import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentRole } from './agent-host'

export interface AgentEnvEntry {
  name: string
  value_sha256: string
  category: string
}

export interface AgentEnvManifest {
  schema_version: 1
  role: AgentRole | 'unknown'
  created_at: string
  kept_required: string[]
  stripped: AgentEnvEntry[]
  allowlisted: AgentEnvEntry[]
  counts: { input: number; kept: number; stripped: number }
}

export interface AgentSandboxEnv {
  env: Record<string, string | undefined>
  manifest: AgentEnvManifest
}

export interface AgentSandboxEnvOptions {
  baseEnv?: Record<string, string | undefined>
  allowlist?: string[]
  role?: AgentRole | 'unknown'
  nowIso?: string
}

const APPROVAL_SECRET_ENV_NAME = 'BETWEEN_APPROVAL_SECRET'
const REQUIRED_RUNTIME = new Set([
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'HOME',
  'USERPROFILE',
  'TEMP',
  'TMP',
  'FORCE_COLOR',
  'NO_COLOR',
  'TERM',
  'COLORTERM',
  'BETWEEN_ROOT',
  'LANG',
  'LC_ALL',
  'TZ',
])
const EXACT_DENY = new Set([
  APPROVAL_SECRET_ENV_NAME,
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITLAB_TOKEN',
  'BITBUCKET_TOKEN',
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  'GIT_ASKPASS',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_CREDENTIAL_HELPER',
  'NPM_TOKEN',
  'NODE_AUTH_TOKEN',
  'NPM_CONFIG__AUTH_TOKEN',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'AZURE_CLIENT_SECRET',
  'AZURE_CLIENT_ID',
  'AZURE_TENANT_ID',
  'AZURE_FEDERATED_TOKEN_FILE',
])

export function buildAgentSandboxEnv(
  extra: Record<string, string | undefined>,
  opts: AgentSandboxEnvOptions = {},
): AgentSandboxEnv {
  const merged: Record<string, string | undefined> = { ...(opts.baseEnv ?? process.env), ...extra }
  const allowlist = new Set((opts.allowlist ?? []).map((name) => name.toUpperCase()))
  const env: Record<string, string | undefined> = {}
  const stripped: AgentEnvEntry[] = []
  const allowlisted: AgentEnvEntry[] = []
  const keptRequired = new Set<string>()

  for (const [name, value] of Object.entries(merged)) {
    if (value === undefined) continue
    const upper = name.toUpperCase()
    const required = REQUIRED_RUNTIME.has(upper)
    const allowed = allowlist.has(upper)
    if (!required && !allowed && shouldStrip(upper)) {
      stripped.push(entry(name, value, categoryOf(upper)))
      continue
    }
    env[name] = value
    if (required) keptRequired.add(name)
    if (allowed) allowlisted.push(entry(name, value, 'allowlisted'))
  }

  stripped.sort(compareEntry)
  allowlisted.sort(compareEntry)
  return {
    env,
    manifest: {
      schema_version: 1,
      role: opts.role ?? 'unknown',
      created_at: opts.nowIso ?? new Date().toISOString(),
      kept_required: [...keptRequired].sort((a, b) => a.localeCompare(b)),
      stripped,
      allowlisted,
      counts: {
        input: Object.keys(merged).length,
        kept: Object.keys(env).length,
        stripped: stripped.length,
      },
    },
  }
}

export async function writeAgentEnvManifest(
  root: string,
  role: AgentRole,
  manifest: AgentEnvManifest,
): Promise<string> {
  const dir = join(root, '.between', 'agent-env')
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${Date.now()}-${role}-${randomUUID()}.json`)
  await writeFile(path, `${JSON.stringify({ ...manifest, role }, null, 2)}\n`, 'utf8')
  return path
}

function entry(name: string, value: string, category: string): AgentEnvEntry {
  return { name, value_sha256: createHash('sha256').update(value).digest('hex'), category }
}

function compareEntry(a: AgentEnvEntry, b: AgentEnvEntry): number {
  return a.name.localeCompare(b.name)
}

function shouldStrip(upper: string): boolean {
  if (EXACT_DENY.has(upper)) return true
  if (upper.startsWith('GCM_') || upper.startsWith('CLOUDSDK_AUTH_')) return true
  return /(?:TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_KEY|ACCESS_KEY|API_KEY|CREDENTIAL|_AUTH)/.test(
    upper,
  )
}

function categoryOf(upper: string): string {
  if (upper === APPROVAL_SECRET_ENV_NAME) return 'approval'
  if (upper.startsWith('SSH_')) return 'ssh'
  if (upper.startsWith('GIT') || upper.startsWith('GH') || upper.startsWith('GITHUB')) return 'git'
  if (upper.startsWith('NPM') || upper.startsWith('NODE_AUTH')) return 'npm'
  if (upper.startsWith('AWS') || upper.startsWith('GOOGLE') || upper.startsWith('AZURE')) {
    return 'cloud'
  }
  return 'credential'
}
