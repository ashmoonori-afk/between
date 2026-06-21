import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { AgentRole } from './agent-host'
import { buildAgentSandboxEnv, writeAgentEnvManifest } from './agent-env'
import { buildSandboxedAgentEnv } from './sandbox'
import { StateRepository } from './state-repository'
import { WorktreeProvider } from './worktree'
import { readBundle } from '../review/store'
import { materializeBundle } from '../review/materialize'

export interface AgentExecution {
  cwd: string
  env: Record<string, string | undefined>
  reviewerWorktree?: string
}

export async function prepareAgentExecution(
  root: string,
  role: AgentRole,
  defaultCwd: string,
  extraEnv: Record<string, string | undefined> = {},
): Promise<AgentExecution> {
  if (role === 'reviewer') return prepareReviewerExecution(root, extraEnv)
  const sandbox = buildAgentSandboxEnv(
    { ...extraEnv, BETWEEN_ROOT: root },
    { role, baseEnv: process.env },
  )
  await writeAgentEnvManifest(root, role, sandbox.manifest)
  return { cwd: defaultCwd, env: sandbox.env }
}

export function resolveAgentCommandPaths(
  root: string,
  command: { file: string; args: string[] },
): { file: string; args: string[] } {
  return {
    file: resolveIfRepoPath(root, command.file),
    args: command.args.map((arg) => resolveIfRepoPath(root, arg)),
  }
}

async function prepareReviewerExecution(
  root: string,
  extraEnv: Record<string, string | undefined>,
): Promise<AgentExecution> {
  const state = await new StateRepository(root).read()
  const bundleId = state?.diff.bundle_id
  if (!bundleId) throw new Error('cannot launch reviewer without a sealed review bundle')
  const bundle = await readBundle(root, bundleId)
  if (!bundle) throw new Error(`cannot launch reviewer: bundle ${bundleId} not found`)
  const reviewerWorktree = await materializeBundle(bundle, new WorktreeProvider(root))
  const sandbox = buildSandboxedAgentEnv('reviewer', root, process.env, {
    ...extraEnv,
    BETWEEN_REVIEW_WORKTREE: reviewerWorktree,
  })
  await writeAgentEnvManifest(root, 'reviewer', sandbox.manifest)
  return { cwd: reviewerWorktree, env: sandbox.env, reviewerWorktree }
}

function resolveIfRepoPath(root: string, value: string): string {
  if (!looksLikeRelativePath(value) || isAbsolute(value)) return value
  const candidate = resolve(root, value)
  return existsSync(candidate) ? candidate : value
}

function looksLikeRelativePath(value: string): boolean {
  return value.startsWith('.') || value.includes('/') || value.includes('\\')
}
