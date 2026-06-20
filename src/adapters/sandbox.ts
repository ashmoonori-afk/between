import { chmod, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildAgentSandboxEnv, type AgentEnvManifest, type AgentSandboxEnv } from './agent-env'

export type SandboxRole = 'reviewer' | 'verifier'

export interface SandboxManifest {
  schema_version: 1
  role: SandboxRole
  worktree: string
  readonly: { applied: boolean; method: 'chmod-best-effort' }
  network: { denied: boolean; mode: 'env-contract' }
  push_credentials: false
  env: AgentEnvManifest
}

export function buildSandboxedAgentEnv(
  role: SandboxRole,
  root: string,
  baseEnv: Record<string, string | undefined> = process.env,
): AgentSandboxEnv {
  return buildAgentSandboxEnv(
    {
      BETWEEN_ROOT: root,
      BETWEEN_SANDBOX_ROLE: role,
      BETWEEN_NETWORK_DISABLED: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
    { baseEnv, role: role === 'reviewer' ? 'reviewer' : 'unknown' },
  )
}

export async function sealSandboxedWorktree(
  root: string,
  role: SandboxRole,
  worktree: string,
): Promise<SandboxManifest> {
  await makeTreeReadOnly(worktree)
  const sandbox = buildSandboxedAgentEnv(role, root)
  const manifest: SandboxManifest = {
    schema_version: 1,
    role,
    worktree,
    readonly: { applied: true, method: 'chmod-best-effort' },
    network: { denied: true, mode: 'env-contract' },
    push_credentials: false,
    env: sandbox.manifest,
  }
  await writeSandboxManifest(root, manifest)
  return manifest
}

export async function writeSandboxManifest(
  root: string,
  manifest: SandboxManifest,
): Promise<string> {
  const path = sandboxManifestPath(root, manifest.role)
  await mkdir(join(root, '.between', 'sandbox'), { recursive: true })
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return path
}

export async function readSandboxManifest(
  root: string,
  role: SandboxRole,
): Promise<SandboxManifest | null> {
  try {
    return JSON.parse(await readFile(sandboxManifestPath(root, role), 'utf8')) as SandboxManifest
  } catch {
    return null
  }
}

export function sandboxManifestPath(root: string, role: SandboxRole): string {
  return join(root, '.between', 'sandbox', `${role}.json`)
}

export async function makeTreeReadOnly(path: string): Promise<void> {
  await chmodTree(path, 0o444, 0o555, 'children-first')
}

export async function makeTreeWritable(path: string): Promise<void> {
  await chmodTree(path, 0o644, 0o755, 'parent-first')
}

async function chmodTree(
  path: string,
  fileMode: number,
  dirMode: number,
  order: 'children-first' | 'parent-first',
): Promise<void> {
  const info = await stat(path).catch(() => null)
  if (!info) return
  if (!info.isDirectory()) {
    await chmod(path, fileMode).catch(() => {})
    return
  }
  if (order === 'parent-first') await chmod(path, dirMode).catch(() => {})
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    await chmodTree(join(path, entry.name), fileMode, dirMode, order)
  }
  if (order === 'children-first') await chmod(path, dirMode).catch(() => {})
}
