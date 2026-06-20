import { touch, isAlreadyReviewed } from '../core/state'
import { isCycleCapReached } from '../core/cycle'
import { emptyDebounce } from '../core/debounce'
import { redactSecrets } from '../core/redact'
import { verifyApproval, approvalExpiry } from '../core/approval'
import type { ApprovalScope } from '../core/types'
import type { Command } from '../adapters/command-bus'
import { resolveApprovalSecret } from '../adapters/approval-secret'
import { evaluateCyclePolicy } from '../policy/gate'
import type { DaemonContext } from './context'
import { currentDiff, openCycleAndSignal } from './phases'

export async function drainCommands(ctx: DaemonContext): Promise<void> {
  const pending = await ctx.deps.commands.drain()
  for (const { file, command } of pending) {
    await applyCommand(ctx, command)
    await ctx.deps.commands.ack(file)
  }
}

export async function applyCommand(ctx: DaemonContext, command: Command): Promise<void> {
  switch (command.kind) {
    case 'goal': {
      const phase = ctx.current().workflow.phase
      if (phase === 'idle' || phase === 'done') {
        await ctx.dispatch('goal_locked', (s) => ({
          ...s,
          workflow: {
            ...s.workflow,
            cycles_this_goal: 0,
            started_at: ctx.deps.clock.nowIso(),
            error: null,
          },
          approval: null, // A2: a new goal invalidates any prior approval
        }))
        // redact before the goal text reaches the durable event log (C2)
        await ctx.emit('goal_set', { detail: { goal: redactSecrets(command.goal).text } })
      }
      break
    }
    case 'pause':
      await ctx.dispatch('pause')
      break
    case 'resume':
      await ctx.dispatch('resume')
      break
    case 'review_now':
      await forceReview(ctx)
      break
    case 'approve':
      await approve(ctx, command.scope, command.sig, command.bundle_id ?? null, command.expires_at)
      break
    case 'stop':
      ctx.requestStop()
      break
    default:
      break
  }
}

export async function approve(
  ctx: DaemonContext,
  scope: ApprovalScope,
  sig?: string,
  bundleId?: string | null,
  expiresAt?: string,
): Promise<void> {
  const cur = ctx.current()
  // F1: bundle_id + expires_at are part of the SIGNED claim — use the approver's values (what was
  // signed) so the daemon verifies and stores exactly what the human authorized; fall back only on
  // the unsigned path. A state writer without the secret can't forge a sig over a tampered binding.
  const bundle_id = bundleId ?? cur.diff.bundle_id
  const expires_at = expiresAt ?? approvalExpiry(ctx.deps.clock.now())
  const claim = {
    scope,
    diff_hash: cur.diff.hash,
    cycle: cur.workflow.cycle,
    bundle_id,
    expires_at,
  }
  const secret = resolveApprovalSecret(ctx.deps.root)
  if (secret) {
    // a secret is provisioned -> a valid signature is REQUIRED; a forged/unsigned approve
    // file (e.g. written by an agent without the secret) cannot pass the human gate (P1-5).
    if (!verifyApproval(secret, sig ?? '', claim)) {
      await ctx.emit('approval_rejected', {
        detail: { scope, reason: sig ? 'invalid signature' : 'unsigned' },
      })
      return
    }
  }
  // #5: policy is a LIFECYCLE gate for MERGE (the scope that authorizes a push). The daemon cycle
  // only enforces review + verify; secret_scan / dependency_audit (and any policy.yaml gate) are
  // NOT enforced by the flow, so a policy-failing change could reach a push. Refuse to grant a
  // merge approval while a required gate fails (fail-closed) -> no approval -> the pre-push hook
  // keeps blocking. deploy / promote_rule are distinct downstream gates and are not policy-gated here.
  if (scope === 'merge') {
    let satisfied = false
    let reason = ''
    try {
      const gate = await evaluateCyclePolicy(ctx.deps.root, cur, ctx.deps.clock.nowIso())
      satisfied = gate.evaluation.satisfied
      reason = gate.reason
    } catch (e) {
      // a policy-evaluation failure (e.g. a tampered bundle that readBundle refuses) must REJECT
      // the approval, never crash the daemon — otherwise a malformed bundle is a DoS. Fail-closed.
      reason = `evaluation error: ${e instanceof Error ? e.message : String(e)}`
    }
    if (!satisfied) {
      await ctx.emit('approval_rejected', {
        detail: { scope, reason: `policy not satisfied: ${reason}` },
      })
      return
    }
  }
  const next = {
    ...cur,
    approval: {
      actor: 'human' as const,
      scope,
      diff_hash: cur.diff.hash,
      cycle: cur.workflow.cycle,
      granted_at: ctx.deps.clock.nowIso(),
      sig: sig ?? null,
      bundle_id,
      expires_at,
    },
  }
  await ctx.persist(touch(next, ctx.deps.clock))
  // A3 (P0-3): only a MERGE approval completes the dev cycle. deploy / promote_rule are distinct
  // downstream gates — they are recorded (and verify-push-checkable) but must NOT end the cycle as
  // `done`. Previously any scope's approval at human_gate transitioned to done.
  if (ctx.current().workflow.phase === 'human_gate') {
    if (scope === 'merge') {
      await ctx.dispatch('human_approved')
    } else {
      await ctx.emit('approval_recorded', { detail: { scope } })
    }
  }
}

export async function forceReview(ctx: DaemonContext): Promise<void> {
  const phase = ctx.current().workflow.phase
  if (phase !== 'developing' && phase !== 'applying_review' && phase !== 'debouncing') return
  const { input, hash } = await currentDiff(ctx)
  if (hash === null) return
  if (
    ctx.deps.config.same_hash_review_policy === 'skip' &&
    isAlreadyReviewed(ctx.current(), hash)
  ) {
    return
  }
  // review-now must honor the per-goal cycle cap, just like the debounce path (P2-10)
  if (
    isCycleCapReached(ctx.current().workflow.cycles_this_goal, ctx.deps.config.max_cycles_per_goal)
  ) {
    await ctx.dispatch('max_cycles_reached', (s) => ({ ...s, debounce: emptyDebounce() }))
    return
  }
  // move into debouncing if needed, then force a cycle immediately
  if (phase !== 'debouncing') {
    await ctx.dispatch('diff_detected', (s) => ({
      ...s,
      debounce: {
        candidate_hash: hash,
        candidate_first_seen_at: ctx.deps.clock.nowIso(),
        debounce_restarts: 0,
      },
    }))
  }
  await openCycleAndSignal(ctx, input, hash)
}
