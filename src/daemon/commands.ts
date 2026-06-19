import { touch, isAlreadyReviewed } from '../core/state'
import { isCycleCapReached } from '../core/cycle'
import { emptyDebounce } from '../core/debounce'
import { redactSecrets } from '../core/redact'
import type { ApprovalScope } from '../core/types'
import type { Command } from '../adapters/command-bus'
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
      await approve(ctx, command.scope)
      break
    case 'stop':
      ctx.requestStop()
      break
    default:
      break
  }
}

export async function approve(ctx: DaemonContext, scope: ApprovalScope): Promise<void> {
  const next = {
    ...ctx.current(),
    approval: {
      actor: 'human' as const,
      scope,
      diff_hash: ctx.current().diff.hash,
      granted_at: ctx.deps.clock.nowIso(),
    },
  }
  await ctx.persist(touch(next, ctx.deps.clock))
  if (ctx.current().workflow.phase === 'human_gate') {
    await ctx.dispatch('human_approved')
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
  await openCycleAndSignal(ctx, input.tracked, hash)
}
