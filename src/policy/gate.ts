import type { BetweenState } from '../core/types'
import type { CommandRunner } from '../verify/runner'
import type { ReviewBundle } from '../review/bundle'
import type { PolicyEvaluation } from './engine'
import { evaluatePolicy, classifyRisk, changedPathsFromRaw } from './engine'
import { loadPolicy } from './load'
import { collectEvidence } from '../evidence/collect'
import { readBundle } from '../review/store'
import { scanDiffForSecrets } from '../verify/secret-scan'
import { runDepAudit } from '../verify/dep-audit'
import { shellRunner } from '../verify/runner'

/** Dependency-audit subprocess time budget so `npm audit` can't hang the gate (review MEDIUM). */
const DEP_AUDIT_TIMEOUT_MS = 60_000

export interface CyclePolicyGate {
  evaluation: PolicyEvaluation
  /** human-readable summary of the FAILED gates, '' when satisfied. */
  reason: string
}

/**
 * Evaluate the policy for the CURRENT cycle from on-disk evidence — risk-by-path, blocking
 * findings, verification, secret scan, and (only when the active gate set needs it) a dependency
 * audit. The single source of truth shared by `between policy` (display) and the merge-approval
 * LIFECYCLE gate (#5): a merge approval — which is what authorizes a push — must not be granted
 * while a required gate is failing, closing the hole where the daemon cycle (review + verify only)
 * could reach a push without policy ever running. `run` is injectable so callers/tests never spawn.
 *
 * Fail-closed on a missing bundle: if state pins a bundle_id but the bundle file is gone/unreadable,
 * the change content can't be verified, so we THROW rather than let secret_scan silently degrade to
 * advisory and risk drop to 'normal' (review HIGH: that was a fail-open). The caller (daemon
 * approve / verify-push) turns the throw into a refusal.
 */
export async function evaluateCyclePolicy(
  root: string,
  state: BetweenState,
  nowIso: string,
  run?: CommandRunner,
): Promise<CyclePolicyGate> {
  const policy = await loadPolicy(root)
  const manifest = await collectEvidence(root, nowIso, state)
  let bundle: ReviewBundle | null = null
  if (state.diff.bundle_id) {
    bundle = await readBundle(root, state.diff.bundle_id)
    if (!bundle) {
      throw new Error(
        `review bundle ${state.diff.bundle_id.slice(0, 12)}... is missing or unreadable`,
      )
    }
  }
  const changedPaths = bundle ? changedPathsFromRaw(bundle.diff.trackedRaw) : []

  // run npm audit only when the active (risk-based) gate set actually needs it.
  const activeGates =
    classifyRisk(policy, changedPaths) === 'high' ? policy.gates.high : policy.gates.normal
  let depAuditVulns: number | null = null
  if (activeGates.includes('dependency_audit')) {
    depAuditVulns = await runDepAudit(run ?? shellRunner(root, DEP_AUDIT_TIMEOUT_MS))
  }

  const evaluation = evaluatePolicy(policy, {
    changedPaths,
    blockingFindings: manifest?.findings.blocking ?? 0,
    verifyPassed: manifest?.verify ? manifest.verify.passed : null,
    secretScanHits: bundle ? scanDiffForSecrets(bundle.diff.tracked).hits : null,
    depAuditVulns,
  })
  const reason = evaluation.gates
    .filter((g) => g.status === 'fail')
    .map((g) => `${g.name} (${g.detail})`)
    .join('; ')
  return { evaluation, reason }
}
