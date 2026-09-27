import { dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import writeFileAtomic from 'write-file-atomic'
import type { BetweenState } from '../core/types'
import { SystemClock } from '../core/clock'
import { approvalFreshness, verifyApproval } from '../core/approval'
import { usesSimulatedEvidence } from '../core/evidence-trust'
import { StateRepository } from '../adapters/state-repository'
import { APPROVAL_SECRET_ENV, resolveApprovalSecret } from '../adapters/approval-secret'
import { betweenPaths } from '../adapters/paths'
import { GitAdapter } from '../adapters/git'
import { DEFAULT_CONFIG } from '../core/config-schema'
import { loadConfig } from '../runtime'
import { runChecks, shellRunner, type VerificationReport } from '../verify/runner'
import { evaluateCyclePolicy } from '../policy/gate'
import type { PolicyEvaluation } from '../policy/engine'
import { policyPath } from '../policy/load'
import { defaultPolicyYaml } from '../policy/schema'
import { noStateError } from './errors'

/** Run the configured verification checks and persist the report under `.between/`. */
export async function runConfiguredVerification(rootDir: string): Promise<VerificationReport> {
  const config = await loadConfig(rootDir)
  const report = await runChecks(config.verification_checks, shellRunner(rootDir))
  const reportPath = betweenPaths(rootDir).verifyReport
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFileAtomic(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  return report
}

export interface PolicyReport {
  project: string
  cycle: number
  evaluation: PolicyEvaluation
}

/** Evaluate the current cycle against policy-as-code (risk, gates, approvals). */
export async function evaluatePolicy(root: string): Promise<PolicyReport> {
  const state = await new StateRepository(root).read()
  if (!state) throw noStateError()
  const { evaluation } = await evaluateCyclePolicy(root, state, new SystemClock().nowIso())
  return { project: state.project.name, cycle: state.workflow.cycle, evaluation }
}

/** Write the default `.between/policy.yaml` unless one already exists. */
export async function initPolicy(root: string): Promise<{ path: string; created: boolean }> {
  const path = policyPath(root)
  if (existsSync(path)) return { path, created: false }
  await writeFile(path, defaultPolicyYaml(), 'utf8')
  return { path, created: true }
}

export interface PushVerdict {
  allowed: boolean
  /** null when there is no state at all (nothing to gate, nothing to report). */
  message: string | null
}

/** One ref update from git's pre-push stdin: `<local ref> <local sha> <remote ref> <remote sha>`. */
export interface PushUpdate {
  localRef: string
  localSha: string
  remoteRef: string
  remoteSha: string
}

export function parsePrePushInput(text: string): PushUpdate[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length === 4)
    .map(([localRef, localSha, remoteRef, remoteSha]) => ({
      localRef: localRef!,
      localSha: localSha!,
      remoteRef: remoteRef!,
      remoteSha: remoteSha!,
    }))
}

const BRANCH_PREFIX = 'refs/heads/'
const DELETED_SHA = /^0+$/

function refuse(message: string): PushVerdict {
  return { allowed: false, message: `refusing push - ${message}` }
}

/**
 * The pre-push gate. Pushes to protected branches (`protected_branches`, default `[main]`) need a
 * signed, fresh merge approval on a real (non-simulated) project, whose signed tree equals the
 * pushed commit's tree, and a satisfied cycle policy. Deleting a protected branch is refused.
 * Pushes to any other branch are not gated. `updates` are git's pre-push ref lines; when omitted,
 * the current branch's HEAD pushed to the same-named branch is checked.
 */
export async function verifyPush(root: string, updates?: PushUpdate[]): Promise<PushVerdict> {
  const state = await new StateRepository(root).read()
  if (!state) return { allowed: true, message: null }
  const git = new GitAdapter(root)
  const pushed = updates ?? (await currentBranchUpdate(git))
  const cfg = await loadConfig(root).catch(() => null)
  const protectedBranches = new Set(cfg?.protected_branches ?? DEFAULT_CONFIG.protected_branches)
  const targets = pushed.filter(
    (u) =>
      u.remoteRef.startsWith(BRANCH_PREFIX) &&
      protectedBranches.has(u.remoteRef.slice(BRANCH_PREFIX.length)),
  )
  if (targets.length === 0) {
    return {
      allowed: true,
      message: `no protected branch in this push (protected: ${[...protectedBranches].join(', ') || 'none'})`,
    }
  }
  const names = targets.map((u) => u.remoteRef.slice(BRANCH_PREFIX.length)).join(', ')
  const deleted = targets.find((u) => DELETED_SHA.test(u.localSha))
  if (deleted) {
    return refuse(
      `deleting protected branch ${deleted.remoteRef.slice(BRANCH_PREFIX.length)} is not allowed`,
    )
  }
  if (!cfg || usesSimulatedEvidence(state.evidence_trust, cfg)) {
    return refuse(
      'SIMULATION project (fake agent); reviews are not real verification. Run: between init --agent claude|codex.',
    )
  }
  const ap = state.approval
  if (!ap) {
    return refuse(`a push to ${names} needs a merge approval (run \`between approve merge\`)`)
  }
  if (ap.scope !== 'merge') {
    return refuse(`only a merge approval authorizes a push (got ${ap.scope})`)
  }
  const secret = resolveApprovalSecret(root)
  if (!secret) {
    return refuse(`${APPROVAL_SECRET_ENV} is not set, so the approval cannot be verified`)
  }
  const ok = verifyApproval(secret, ap.sig ?? '', {
    scope: ap.scope,
    diff_hash: ap.diff_hash,
    cycle: ap.cycle,
    bundle_id: ap.bundle_id,
    expires_at: ap.expires_at,
    tree: ap.tree ?? null,
  })
  if (!ok) return refuse('recorded approval failed signature verification')
  const stale = approvalFreshness(ap, currentApprovalBinding(state))
  if (stale) return refuse(`approval is no longer valid - ${stale} (re-approve the current diff)`)
  if (!ap.tree) {
    return refuse('approval is not bound to a tree; re-approve with `between approve merge`')
  }
  for (const u of targets) {
    const tree = await git.treeOf(u.localSha)
    if (tree !== ap.tree) {
      return refuse(
        `pushed tree for ${u.remoteRef.slice(BRANCH_PREFIX.length)} does not match the approved tree (approved ${ap.tree.slice(0, 12)}, pushing ${tree?.slice(0, 12) ?? 'unknown'})`,
      )
    }
  }
  const gate = await evaluateCyclePolicy(root, state, new SystemClock().nowIso())
  if (!gate.evaluation.satisfied) return refuse(`policy gate failed: ${gate.reason}`)
  return { allowed: true, message: `approval verified for protected push to ${names}` }
}

async function currentBranchUpdate(git: GitAdapter): Promise<PushUpdate[]> {
  const [branch, head] = await Promise.all([git.branch(), git.headSha()])
  if (!branch || !head) return []
  const ref = `${BRANCH_PREFIX}${branch}`
  return [{ localRef: ref, localSha: head, remoteRef: ref, remoteSha: '0'.repeat(40) }]
}

function currentApprovalBinding(state: BetweenState) {
  return {
    diff_hash: state.diff.hash,
    cycle: state.workflow.cycle,
    bundle_id: state.diff.bundle_id,
    nowMs: Date.now(),
  }
}
