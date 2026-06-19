import type { BetweenError, DiffInput } from '../core/types'
import { touch, recordReviewedHash, isAlreadyReviewed } from '../core/state'
import { openCycle, isCycleCapReached, cycleName } from '../core/cycle'
import { stepDebounce, emptyDebounce } from '../core/debounce'
import { hashDiff, isEmptyDiff } from '../core/diff-hash'
import { redactSecrets } from '../core/redact'
import { reviewMatchesCurrent, reviewIsClean, cycleShouldEnd } from '../core/findings'
import { buildSignal, developerSignalBody } from '../adapters/signal-transport'
import type { DaemonContext } from './context'
import { ensureReviewerSignal, expectedSignalId, sendReviewerSignal } from './reviewer-signal'
import { readReview, readVerify } from './records'

export async function currentDiff(
  ctx: DaemonContext,
): Promise<{ input: DiffInput; hash: string | null }> {
  const input = await ctx.deps.git.diffInput({
    reviewUntracked: ctx.deps.config.review_untracked,
    untrackedGlobs: ctx.deps.config.untracked_file_globs,
  })
  return { input, hash: isEmptyDiff(input) ? null : hashDiff(input) }
}

export async function watchForNewDiff(ctx: DaemonContext): Promise<void> {
  const cur = ctx.current()
  const { hash } = await currentDiff(ctx)
  if (hash !== null && hash !== cur.diff.hash && !isAlreadyReviewed(cur, hash)) {
    const c = ctx.deps.clock
    const step = stepDebounce(
      emptyDebounce(),
      hash,
      c.nowIso(),
      c.now(),
      ctx.deps.config.diff_debounce_seconds,
    )
    await ctx.dispatch('diff_detected', (s) => ({
      ...s,
      debounce: step.state,
      diff: { ...s.diff, previous_hash: s.diff.hash },
    }))
    return
  }
  // no new diff: time out applying_review if the developer never produced a fix (P3-13)
  if (
    ctx.current().workflow.phase === 'applying_review' &&
    signalTimedOut(ctx, ctx.deps.config.developer_timeout_seconds)
  ) {
    await ctx.dispatch('developer_timeout', (s) => ({
      ...s,
      workflow: { ...s.workflow, error: timeoutError(ctx, 'developer did not produce a fix') },
    }))
  }
}

export async function runDebounce(ctx: DaemonContext): Promise<void> {
  const { input, hash } = await currentDiff(ctx)
  if (hash === null) {
    await ctx.dispatch('diff_reverted', (s) => ({ ...s, debounce: emptyDebounce() }))
    return
  }
  const c = ctx.deps.clock
  const step = stepDebounce(
    ctx.current().debounce,
    hash,
    c.nowIso(),
    c.now(),
    ctx.deps.config.diff_debounce_seconds,
  )

  if (step.decision === 'restarted') {
    await ctx.dispatch('diff_changed', (s) => ({ ...s, debounce: step.state }))
    return
  }
  if (step.decision === 'started' || step.decision === 'pending') {
    await ctx.persist(touch({ ...ctx.current(), debounce: step.state }, c))
    return
  }

  // stable
  if (isAlreadyReviewed(ctx.current(), hash)) {
    await ctx.dispatch('diff_reverted', (s) => ({ ...s, debounce: emptyDebounce() }))
    return
  }
  if (
    isCycleCapReached(ctx.current().workflow.cycles_this_goal, ctx.deps.config.max_cycles_per_goal)
  ) {
    await ctx.dispatch('max_cycles_reached', (s) => ({ ...s, debounce: emptyDebounce() }))
    return
  }
  await openCycleAndSignal(ctx, input.tracked, hash)
}

export async function openCycleAndSignal(
  ctx: DaemonContext,
  trackedDiff: string,
  hash: string,
): Promise<void> {
  const wf = ctx.current().workflow
  const counters = openCycle({ cycle: wf.cycle, cycles_this_goal: wf.cycles_this_goal })
  const summary = await ctx.deps.git.summary()
  const redacted = redactSecrets(trackedDiff)
  await ctx.deps.snapshots.write(
    counters.cycle,
    redacted.text,
    ctx.deps.config.snapshot_retention_cycles,
    ctx.deps.config.snapshot_max_total_mb,
  )
  const snapRel = `.between/snapshots/${cycleName(counters.cycle)}.diff.gz`

  // persist the new cycle + diff state BEFORE sending any signal (I11)
  await ctx.dispatch('diff_stable', (s) => ({
    ...s,
    workflow: { ...s.workflow, cycle: counters.cycle, cycles_this_goal: counters.cycles_this_goal },
    diff: {
      hash,
      previous_hash: ctx.current().diff.hash,
      changed_files: summary.changed_files,
      insertions: summary.insertions,
      deletions: summary.deletions,
      snapshot_path: snapRel,
    },
    debounce: emptyDebounce(),
  }))

  await sendReviewerSignal(ctx, counters.cycle, hash)
  if (redacted.redactedCount > 0) {
    await ctx.emit('snapshot_redacted', { detail: { count: redacted.redactedCount } })
  }
}

export async function awaitAck(ctx: DaemonContext): Promise<void> {
  if (await superseded(ctx)) return // live diff changed -> abandon (P1-3)
  await ensureReviewerSignal(ctx)
  const id = expectedSignalId(ctx)
  if (id) {
    const ack = await ctx.deps.transport.pollAck(id)
    if (ack) {
      await ctx.dispatch('review_acked')
      return
    }
  }
  if (signalTimedOut(ctx, ctx.deps.config.review_timeout_seconds)) {
    await ctx.dispatch('review_timeout', (s) => ({
      ...s,
      workflow: { ...s.workflow, error: timeoutError(ctx, 'reviewer did not acknowledge') },
    }))
  }
}

export async function awaitReview(ctx: DaemonContext): Promise<void> {
  if (await superseded(ctx)) return // live diff changed -> abandon (P1-3)
  const record = await readReview(ctx)
  const hash = ctx.current().diff.hash
  if (record && hash && reviewMatchesCurrent(record, hash)) {
    await ctx.dispatch('review_written')
    return
  }
  if (signalTimedOut(ctx, ctx.deps.config.review_timeout_seconds)) {
    await ctx.dispatch('review_timeout', (s) => ({
      ...s,
      workflow: { ...s.workflow, error: timeoutError(ctx, 'reviewer did not write a review') },
    }))
  }
}

export async function handleReviewWritten(ctx: DaemonContext): Promise<void> {
  if (await superseded(ctx)) return // live diff changed under us -> abandon (P1-3)
  const record = await readReview(ctx)
  if (!record) {
    await maybeReviewTimeout(ctx, 'reviewer did not write a review')
    return
  }
  // ignore a review file replaced with one for a different cycle/hash (TOCTOU, I14, HIGH-2)
  if (record.diff_hash !== ctx.current().diff.hash) return
  if (reviewIsClean(record)) {
    const verify = await readVerify(ctx)
    if (cycleShouldEnd(record, verify)) {
      // commit the hash as reviewed ONLY when the cycle actually completes (I4, HIGH-3)
      const reviewed = ctx.current().diff.hash
      await ctx.dispatch('verify_passed', (s) => (reviewed ? recordReviewedHash(s, reviewed) : s))
      return
    }
    // verify present but failed / hash-mismatched -> back to developing, not a stall (P1-4)
    if (verify && (!verify.passed || verify.diff_hash !== record.diff_hash)) {
      await ctx.dispatch('verify_failed', (s) => ({
        ...s,
        workflow: { ...s.workflow, error: timeoutError(ctx, 'verification did not pass') },
      }))
      return
    }
    // clean review, verify still missing -> wait, but don't stall forever (P1-4)
    await maybeReviewTimeout(ctx, 'verification did not arrive')
    return
  }
  // blocking findings -> signal the developer, THEN move to applying_review (P1-1)
  await sendDeveloperSignal(ctx, record.diff_hash)
  await ctx.dispatch('review_applied')
}

/** Route to human_gate (via the universal review_timeout interrupt) once the wait runs out. */
export async function maybeReviewTimeout(ctx: DaemonContext, message: string): Promise<void> {
  if (signalTimedOut(ctx, ctx.deps.config.review_timeout_seconds)) {
    await ctx.dispatch('review_timeout', (s) => ({
      ...s,
      workflow: { ...s.workflow, error: timeoutError(ctx, message) },
    }))
  }
}

/** Notify the developer that blocking review feedback is ready (P1-1, §9 To Developer). */
export async function sendDeveloperSignal(ctx: DaemonContext, hash: string): Promise<void> {
  const sig = buildSignal(
    'developer',
    ctx.current().workflow.cycle,
    hash,
    developerSignalBody(),
    ctx.deps.clock.nowIso(),
  )
  await ctx.deps.transport.send(sig)
  await ctx.persist(
    touch(
      {
        ...ctx.current(),
        broker: {
          ...ctx.current().broker,
          last_signal: 'developer_review_available',
          last_signal_at: ctx.deps.clock.nowIso(),
        },
      },
      ctx.deps.clock,
    ),
  )
  await ctx.emit('signal_sent', { target: 'developer', diff_hash: hash })
}

/**
 * Abandon an outstanding review when the live worktree diff changed out from under it
 * (a developer edit during review_requested/reviewing/review_written), so a stale review
 * can't be approved (P1-3 / I14). Returns true after dispatching the supersede.
 */
export async function superseded(ctx: DaemonContext): Promise<boolean> {
  const { hash } = await currentDiff(ctx)
  if (hash === null || hash === ctx.current().diff.hash) return false
  await ctx.dispatch('diff_superseded', (s) => ({ ...s, debounce: emptyDebounce() }))
  return true
}

export function signalTimedOut(ctx: DaemonContext, timeoutSeconds: number): boolean {
  const at = ctx.current().broker.last_signal_at
  if (!at) return false
  return ctx.deps.clock.now() - Date.parse(at) > timeoutSeconds * 1000
}

export function timeoutError(ctx: DaemonContext, message: string): BetweenError {
  return { code: 'timeout', message, occurred_at: ctx.deps.clock.nowIso(), recoverable: true }
}
