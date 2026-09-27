import type { Ack, ApprovalScope, Clock } from '../core/types'
import { SystemClock } from '../core/clock'
import { signApproval, approvalExpiry } from '../core/approval'
import { APPROVAL_SCOPES } from '../core/constants'
import { StateRepository } from '../adapters/state-repository'
import { CommandBus } from '../adapters/command-bus'
import { AckStore } from '../adapters/ack-store'
import { buildSignal } from '../adapters/signal-transport'
import { resolveApprovalSecret } from '../adapters/approval-secret'
import { loadConfig } from '../runtime'
import { BetweenApiError } from './errors'

export type BrokerControl =
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'interrupt' }
  | { kind: 'review_now' }
  | { kind: 'stop' }
  | { kind: 'goal'; goal: string }
  | { kind: 'steer_goal'; goal: string }

/**
 * Enqueue a control command for the running broker (it drains the bus on its next tick).
 * `approve` is deliberately not a BrokerControl: human approval goes through `approve()`.
 */
export async function submitBrokerCommand(root: string, command: BrokerControl): Promise<void> {
  await loadConfig(root)
  await new CommandBus(root).submit(command)
}

export function parseApprovalScope(scope: string): ApprovalScope {
  if (!APPROVAL_SCOPES.includes(scope as ApprovalScope)) {
    throw new BetweenApiError(
      'invalid_argument',
      `scope must be one of: ${APPROVAL_SCOPES.join(', ')}`,
    )
  }
  return scope as ApprovalScope
}

export interface ApprovalResult {
  scope: ApprovalScope
  /** false when BETWEEN_APPROVAL_SECRET is unset, so the approval boundary is not enforced. */
  signed: boolean
}

/** Submit a signed human approval bound to the current diff, cycle, bundle, and expiry. */
export async function approve(
  root: string,
  scope: ApprovalScope,
  nowMs: number = Date.now(),
): Promise<ApprovalResult> {
  await loadConfig(root)
  const state = await new StateRepository(root).read()
  const secret = resolveApprovalSecret(root)
  const bundleId = state?.diff.bundle_id ?? null
  const expiresAt = approvalExpiry(nowMs)
  const claim = {
    scope,
    diff_hash: state?.diff.hash ?? null,
    cycle: state?.workflow.cycle ?? 0,
    bundle_id: bundleId,
    expires_at: expiresAt,
  }
  const sig = secret ? signApproval(secret, claim) : undefined
  await new CommandBus(root).submit({
    kind: 'approve',
    scope,
    sig,
    bundle_id: bundleId,
    expires_at: expiresAt,
  })
  return { scope, signed: Boolean(secret) }
}

/** Reviewer helper: acknowledge the outstanding review signal for the current cycle. */
export async function ackReview(
  root: string,
  clock: Clock = new SystemClock(),
): Promise<{ signal_id: string }> {
  const state = await new StateRepository(root).read()
  if (!state || !state.diff.hash) {
    throw new BetweenApiError('not_found', 'no outstanding review to acknowledge')
  }
  const id = buildSignal('reviewer', state.workflow.cycle, state.diff.hash, '', '').id
  const ack: Ack = {
    signal_id: id,
    target: 'reviewer',
    cycle: state.workflow.cycle,
    diff_hash: state.diff.hash,
    acked_at: clock.nowIso(),
  }
  await new AckStore(root).write(ack)
  return { signal_id: id }
}
