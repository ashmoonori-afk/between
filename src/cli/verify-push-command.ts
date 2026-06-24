import { SystemClock } from '../core/clock'
import type { BetweenState } from '../core/types'
import { approvalFreshness, verifyApproval } from '../core/approval'
import { usesSimulatedEvidence } from '../core/evidence-trust'
import { StateRepository } from '../adapters/state-repository'
import { resolveApprovalSecret } from '../adapters/approval-secret'
import { loadConfig } from '../runtime'
import { print, printErr } from './output'

export async function runVerifyPushCommand(root: string): Promise<void> {
  const state = await new StateRepository(root).read()
  if (!state) return
  const cfg = await loadConfig(root).catch(() => null)
  if (!cfg || usesSimulatedEvidence(state.evidence_trust, cfg)) {
    printErr(
      'between: refusing push - SIMULATION project (fake agent); reviews are not real verification. Run: between init --agent claude|codex.',
    )
    process.exitCode = 1
    return
  }
  const secret = resolveApprovalSecret(root)
  const ap = state.approval
  if (!ap) {
    if (state.workflow.phase === 'human_gate') {
      printErr('between: human approval is pending (run `between approve merge`)')
      process.exitCode = 1
      return
    }
    print('between: no approval gate pending')
    return
  }
  if (ap.scope !== 'merge') {
    printErr(`between: refusing push - only a merge approval authorizes a push (got ${ap.scope})`)
    process.exitCode = 1
    return
  }
  const ok = verifyApproval(secret, ap.sig ?? '', {
    scope: ap.scope,
    diff_hash: ap.diff_hash,
    cycle: ap.cycle,
    bundle_id: ap.bundle_id,
    expires_at: ap.expires_at,
  })
  if (!ok) {
    printErr('between: recorded approval failed signature verification')
    process.exitCode = 1
    return
  }
  const stale = approvalFreshness(ap, currentApprovalBinding(state))
  if (stale) {
    printErr(`between: approval is no longer valid - ${stale} (re-approve the current diff)`)
    process.exitCode = 1
    return
  }
  const { evaluateCyclePolicy } = await import('../policy/gate')
  const gate = await evaluateCyclePolicy(root, state, new SystemClock().nowIso())
  if (!gate.evaluation.satisfied) {
    printErr(`between: refusing push - policy gate failed: ${gate.reason}`)
    process.exitCode = 1
    return
  }
  print('between: approval verified')
}

function currentApprovalBinding(state: BetweenState) {
  return {
    diff_hash: state.diff.hash,
    cycle: state.workflow.cycle,
    bundle_id: state.diff.bundle_id,
    nowMs: Date.now(),
  }
}
