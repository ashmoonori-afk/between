import { dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import writeFileAtomic from 'write-file-atomic'
import type { BetweenState } from '../core/types'
import { SystemClock } from '../core/clock'
import { approvalFreshness, verifyApproval } from '../core/approval'
import { usesSimulatedEvidence } from '../core/evidence-trust'
import { StateRepository } from '../adapters/state-repository'
import { resolveApprovalSecret } from '../adapters/approval-secret'
import { betweenPaths } from '../adapters/paths'
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

/**
 * The pre-push approval gate (P1-5): only a signed, fresh merge approval on a real (non-simulated)
 * project whose cycle policy is satisfied authorizes a push.
 */
export async function verifyPush(root: string): Promise<PushVerdict> {
  const state = await new StateRepository(root).read()
  if (!state) return { allowed: true, message: null }
  const cfg = await loadConfig(root).catch(() => null)
  if (!cfg || usesSimulatedEvidence(state.evidence_trust, cfg)) {
    return {
      allowed: false,
      message:
        'refusing push - SIMULATION project (fake agent); reviews are not real verification. Run: between init --agent claude|codex.',
    }
  }
  const secret = resolveApprovalSecret(root)
  const ap = state.approval
  if (!ap) {
    if (state.workflow.phase === 'human_gate') {
      return {
        allowed: false,
        message: 'human approval is pending (run `between approve merge`)',
      }
    }
    return { allowed: true, message: 'no approval gate pending' }
  }
  if (ap.scope !== 'merge') {
    return {
      allowed: false,
      message: `refusing push - only a merge approval authorizes a push (got ${ap.scope})`,
    }
  }
  const ok = verifyApproval(secret, ap.sig ?? '', {
    scope: ap.scope,
    diff_hash: ap.diff_hash,
    cycle: ap.cycle,
    bundle_id: ap.bundle_id,
    expires_at: ap.expires_at,
  })
  if (!ok) return { allowed: false, message: 'recorded approval failed signature verification' }
  const stale = approvalFreshness(ap, currentApprovalBinding(state))
  if (stale) {
    return {
      allowed: false,
      message: `approval is no longer valid - ${stale} (re-approve the current diff)`,
    }
  }
  const gate = await evaluateCyclePolicy(root, state, new SystemClock().nowIso())
  if (!gate.evaluation.satisfied) {
    return { allowed: false, message: `refusing push - policy gate failed: ${gate.reason}` }
  }
  return { allowed: true, message: 'approval verified' }
}

function currentApprovalBinding(state: BetweenState) {
  return {
    diff_hash: state.diff.hash,
    cycle: state.workflow.cycle,
    bundle_id: state.diff.bundle_id,
    nowMs: Date.now(),
  }
}
