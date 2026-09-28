import { existsSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import { DEVELOPER_DENIED_EDITS } from '../agents/real-agents'
import { upgradePristineAgentScripts } from '../agents/generated-scripts'
import { betweenPaths } from './paths'
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
  await upgradePristineAgentScripts(betweenPaths(root).agents)
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
  role?: AgentRole,
): { file: string; args: string[] } {
  const args = command.args.map((arg) => resolveIfRepoPath(root, arg))
  return {
    file: resolveIfRepoPath(root, command.file),
    args: role === 'developer' ? withDeveloperDenyRules(command.file, args) : args,
  }
}

/**
 * A developer launched as the Claude Code CLI directly (no generated wrapper) gets the same
 * permission deny rules the wrapper passes, unless the command already sets --disallowedTools.
 */
export function withDeveloperDenyRules(file: string, args: string[]): string[] {
  const name = basename(file.replace(/\\/g, '/')).toLowerCase()
  if (!/^claude(\.exe|\.cmd)?$/.test(name) || args.includes('--disallowedTools')) return args
  return [...args, '--disallowedTools', ...DEVELOPER_DENIED_EDITS]
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
