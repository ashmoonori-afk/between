import { readFile } from 'node:fs/promises'
import type { BetweenConfig } from '../core/config-schema'
import type {
  ApprovalScope,
  BetweenEvent,
  BetweenState,
  Clock,
  EventName,
  SignalTarget,
  SignalTransport,
} from '../core/types'
import { transition } from '../core/fsm'
import {
  setPhase,
  touch,
  recordReviewedHash,
  isAlreadyReviewed,
} from '../core/state'
import { openCycle, isCycleCapReached, cycleName } from '../core/cycle'
import { stepDebounce, emptyDebounce } from '../core/debounce'
import { hashDiff, isEmptyDiff } from '../core/diff-hash'
import { redactSecrets } from '../core/redact'
import {
  parseReviewRecord,
  parseVerifyRecord,
  reviewMatchesCurrent,
  reviewIsClean,
  cycleShouldEnd,
} from '../core/findings'
import type { GitAdapter } from '../adapters/git'
import type { StateRepository } from '../adapters/state-repository'
import type { EventsLog } from '../adapters/events-log'
import type { SnapshotStore } from '../adapters/snapshot-store'
import type { CommandBus, Command } from '../adapters/command-bus'
import { buildSignal, reviewerSignalBody } from '../adapters/signal-transport'
import { betweenPaths, reviewPath, verifyPath } from '../adapters/paths'
import { reconcile } from './reconcile'

export interface DaemonDeps {
  root: string
  config: BetweenConfig
  clock: Clock
  git: GitAdapter
  state: StateRepository
  events: EventsLog
  transport: SignalTransport
  snapshots: SnapshotStore
  commands: CommandBus
  log?: (msg: string) => void
}

/**
 * The broker daemon. Composes core (FSM, debounce, hashing) with adapters (git, state,
 * events, transport, snapshots) into the §8 poll loop. `tick()` performs exactly one
 * iteration and is the unit the integration tests drive with a controllable clock.
 */
export class Daemon {
  private current: BetweenState
  private stopRequested = false

  constructor(
    private readonly deps: DaemonDeps,
    initial: BetweenState,
  ) {
    this.current = initial
  }

  get state(): BetweenState {
    return this.current
  }

  get stopped(): boolean {
    return this.stopRequested
  }

  /** Load + reconcile persisted state into memory. Returns false if none existed. */
  async load(): Promise<boolean> {
    const loaded = await this.deps.state.read()
    if (!loaded) return false
    this.current = reconcile(loaded, this.deps.clock)
    await this.deps.state.write(this.current)
    return true
  }

  /** Persist the in-memory state to disk (daemon is the single writer). */
  private async persist(next: BetweenState): Promise<void> {
    this.current = next
    await this.deps.state.write(next)
  }

  private async emit(
    event: string,
    extra?: { target?: SignalTarget; diff_hash?: string; detail?: Record<string, unknown> },
  ): Promise<void> {
    const e: Omit<BetweenEvent, 'v'> = {
      ts: this.deps.clock.nowIso(),
      cycle: this.current.workflow.cycle,
      phase: this.current.workflow.phase,
      event,
      ...(extra?.target ? { target: extra.target } : {}),
      ...(extra?.diff_hash ? { diff_hash: extra.diff_hash } : {}),
      ...(extra?.detail ? { detail: extra.detail } : {}),
    }
    await this.deps.events.append(e)
  }

  /** Apply an FSM event; persist + log only when it actually changes phase. */
  private async dispatch(
    event: EventName,
    mutate?: (s: BetweenState) => BetweenState,
  ): Promise<boolean> {
    const res = transition(
      { phase: this.current.workflow.phase, previous_phase: this.current.workflow.previous_phase },
      event,
    )
    if (!res.changed) return false
    let next = setPhase(this.current, res.phase, res.previous_phase)
    if (mutate) next = mutate(next)
    next = touch(next, this.deps.clock)
    await this.persist(next)
    await this.emit(event)
    return true
  }

  // ---- one iteration -------------------------------------------------------

  async tick(): Promise<void> {
    await this.drainCommands()
    const phase = this.current.workflow.phase
    if (phase === 'paused' || phase === 'done') return

    // abnormal git state holds the loop (I21)
    const rs = await this.deps.git.repoState()
    if (rs.busy && phase !== 'repo_busy') {
      await this.dispatch('repo_busy_detected', (s) => ({
        ...s,
        workflow: {
          ...s.workflow,
          error: {
            code: 'repo_busy',
            message: rs.reason ?? 'repository busy',
            occurred_at: this.deps.clock.nowIso(),
            recoverable: true,
          },
        },
      }))
      return
    }
    if (!rs.busy && phase === 'repo_busy') {
      await this.dispatch('repo_cleared', (s) => ({
        ...s,
        workflow: { ...s.workflow, error: null },
      }))
    }

    switch (this.current.workflow.phase) {
      case 'goal_locked':
        await this.dispatch('dev_started')
        break
      case 'developing':
      case 'applying_review':
        await this.watchForNewDiff()
        break
      case 'debouncing':
        await this.runDebounce()
        break
      case 'review_requested':
        await this.awaitAck()
        break
      case 'reviewing':
        await this.awaitReview()
        break
      case 'review_written':
        await this.handleReviewWritten()
        break
      default:
        break // idle, human_gate, error, verifying: driven by commands / external records
    }
  }

  /** Run ticks on the configured interval until stop is requested. */
  async run(maxTicks = Infinity): Promise<void> {
    let n = 0
    while (!this.stopRequested && n < maxTicks) {
      await this.tick()
      n += 1
      if (this.stopRequested || n >= maxTicks) break
      await sleep(this.deps.config.watch_interval_seconds * 1000)
    }
  }

  requestStop(): void {
    this.stopRequested = true
  }

  // ---- phase handlers ------------------------------------------------------

  private async currentDiff() {
    const input = await this.deps.git.diffInput({
      reviewUntracked: this.deps.config.review_untracked,
      untrackedGlobs: this.deps.config.untracked_file_globs,
    })
    return { input, hash: isEmptyDiff(input) ? null : hashDiff(input) }
  }

  private async watchForNewDiff(): Promise<void> {
    const { hash } = await this.currentDiff()
    if (hash === null) return
    if (hash === this.current.diff.hash) return // unchanged since last stable
    if (isAlreadyReviewed(this.current, hash)) return // developer hasn't changed since review
    const c = this.deps.clock
    const step = stepDebounce(
      emptyDebounce(),
      hash,
      c.nowIso(),
      c.now(),
      this.deps.config.diff_debounce_seconds,
    )
    await this.dispatch('diff_detected', (s) => ({
      ...s,
      debounce: step.state,
      diff: { ...s.diff, previous_hash: s.diff.hash },
    }))
  }

  private async runDebounce(): Promise<void> {
    const { input, hash } = await this.currentDiff()
    if (hash === null) {
      await this.dispatch('diff_reverted', (s) => ({ ...s, debounce: emptyDebounce() }))
      return
    }
    const c = this.deps.clock
    const step = stepDebounce(
      this.current.debounce,
      hash,
      c.nowIso(),
      c.now(),
      this.deps.config.diff_debounce_seconds,
    )

    if (step.decision === 'restarted') {
      await this.dispatch('diff_changed', (s) => ({ ...s, debounce: step.state }))
      return
    }
    if (step.decision === 'started' || step.decision === 'pending') {
      await this.persist(touch({ ...this.current, debounce: step.state }, c))
      return
    }

    // stable
    if (isAlreadyReviewed(this.current, hash)) {
      await this.dispatch('diff_reverted', (s) => ({ ...s, debounce: emptyDebounce() }))
      return
    }
    if (isCycleCapReached(this.current.workflow.cycles_this_goal, this.deps.config.max_cycles_per_goal)) {
      await this.dispatch('max_cycles_reached', (s) => ({ ...s, debounce: emptyDebounce() }))
      return
    }
    await this.openCycleAndSignal(input.tracked, hash)
  }

  private async openCycleAndSignal(trackedDiff: string, hash: string): Promise<void> {
    const counters = openCycle({
      cycle: this.current.workflow.cycle,
      cycles_this_goal: this.current.workflow.cycles_this_goal,
    })
    const summary = await this.deps.git.summary()
    const redacted = redactSecrets(trackedDiff)
    await this.deps.snapshots.write(
      counters.cycle,
      redacted.text,
      this.deps.config.snapshot_retention_cycles,
      this.deps.config.snapshot_max_total_mb,
    )
    const snapRel = `.between/snapshots/${cycleName(counters.cycle)}.diff.gz`

    // persist the new cycle + diff state BEFORE sending any signal (I11)
    await this.dispatch('diff_stable', (s) => ({
      ...s,
      workflow: {
        ...s.workflow,
        cycle: counters.cycle,
        cycles_this_goal: counters.cycles_this_goal,
      },
      diff: {
        hash,
        previous_hash: this.current.diff.hash,
        changed_files: summary.changed_files,
        insertions: summary.insertions,
        deletions: summary.deletions,
        snapshot_path: snapRel,
      },
      debounce: emptyDebounce(),
    }))

    const sig = buildSignal('reviewer', counters.cycle, hash, reviewerSignalBody(), this.deps.clock.nowIso())
    await this.deps.transport.send(sig)
    await this.persist(
      touch(
        {
          ...this.current,
          broker: {
            status: 'stable',
            last_signal: 'review_requested',
            last_signal_at: this.deps.clock.nowIso(),
          },
        },
        this.deps.clock,
      ),
    )
    await this.emit('signal_sent', { target: 'reviewer', diff_hash: hash })
    if (redacted.redactedCount > 0) {
      await this.emit('snapshot_redacted', { detail: { count: redacted.redactedCount } })
    }
  }

  private expectedSignalId(): string | null {
    const hash = this.current.diff.hash
    if (!hash) return null
    return buildSignal('reviewer', this.current.workflow.cycle, hash, '', '').id
  }

  private async awaitAck(): Promise<void> {
    const id = this.expectedSignalId()
    if (id) {
      const ack = await this.deps.transport.pollAck(id)
      if (ack) {
        await this.dispatch('review_acked')
        return
      }
    }
    if (this.signalTimedOut(this.deps.config.review_timeout_seconds)) {
      await this.dispatch('review_timeout', (s) => ({
        ...s,
        workflow: { ...s.workflow, error: this.timeoutError('reviewer did not acknowledge') },
      }))
    }
  }

  private async awaitReview(): Promise<void> {
    const record = await this.readReview()
    const hash = this.current.diff.hash
    if (record && hash && reviewMatchesCurrent(record, hash)) {
      await this.dispatch('review_written', (s) => recordReviewedHash(s, hash))
      return
    }
    if (this.signalTimedOut(this.deps.config.review_timeout_seconds)) {
      await this.dispatch('review_timeout', (s) => ({
        ...s,
        workflow: { ...s.workflow, error: this.timeoutError('reviewer did not write a review') },
      }))
    }
  }

  private async handleReviewWritten(): Promise<void> {
    const record = await this.readReview()
    if (!record) return
    if (reviewIsClean(record)) {
      const verify = await this.readVerify()
      if (cycleShouldEnd(record, verify)) {
        await this.dispatch('verify_passed')
      }
      return // clean but no passing verify yet: wait
    }
    // blocking findings -> developer applies
    await this.dispatch('review_applied')
  }

  private signalTimedOut(timeoutSeconds: number): boolean {
    const at = this.current.broker.last_signal_at
    if (!at) return false
    return this.deps.clock.now() - Date.parse(at) > timeoutSeconds * 1000
  }

  private timeoutError(message: string) {
    return {
      code: 'timeout',
      message,
      occurred_at: this.deps.clock.nowIso(),
      recoverable: true,
    }
  }

  private async readReview() {
    return readJson(
      reviewPath(betweenPaths(this.deps.root), this.current.workflow.cycle),
      parseReviewRecord,
    )
  }

  private async readVerify() {
    return readJson(
      verifyPath(betweenPaths(this.deps.root), this.current.workflow.cycle),
      parseVerifyRecord,
    )
  }

  // ---- commands ------------------------------------------------------------

  private async drainCommands(): Promise<void> {
    const pending = await this.deps.commands.drain()
    for (const { file, command } of pending) {
      await this.applyCommand(command)
      await this.deps.commands.ack(file)
    }
  }

  private async applyCommand(command: Command): Promise<void> {
    switch (command.kind) {
      case 'goal':
        if (this.current.workflow.phase === 'idle' || this.current.workflow.phase === 'done') {
          await this.dispatch('goal_locked', (s) => ({
            ...s,
            workflow: {
              ...s.workflow,
              cycles_this_goal: 0,
              started_at: this.deps.clock.nowIso(),
              error: null,
            },
          }))
          await this.emit('goal_set', { detail: { goal: command.goal } })
        }
        break
      case 'pause':
        await this.dispatch('pause')
        break
      case 'resume':
        await this.dispatch('resume')
        break
      case 'review_now':
        await this.forceReview()
        break
      case 'approve':
        await this.approve(command.scope)
        break
      case 'stop':
        this.requestStop()
        break
      default:
        break
    }
  }

  private async approve(scope: ApprovalScope): Promise<void> {
    const next = {
      ...this.current,
      approval: {
        actor: 'human' as const,
        scope,
        diff_hash: this.current.diff.hash,
        granted_at: this.deps.clock.nowIso(),
      },
    }
    await this.persist(touch(next, this.deps.clock))
    if (this.current.workflow.phase === 'human_gate') {
      await this.dispatch('human_approved')
    }
  }

  private async forceReview(): Promise<void> {
    const phase = this.current.workflow.phase
    if (phase !== 'developing' && phase !== 'applying_review' && phase !== 'debouncing') return
    const { input, hash } = await this.currentDiff()
    if (hash === null) return
    if (this.deps.config.same_hash_review_policy === 'skip' && isAlreadyReviewed(this.current, hash)) {
      return
    }
    // move into debouncing if needed, then force a cycle immediately
    if (phase !== 'debouncing') {
      await this.dispatch('diff_detected', (s) => ({
        ...s,
        debounce: { candidate_hash: hash, candidate_first_seen_at: this.deps.clock.nowIso(), debounce_restarts: 0 },
      }))
    }
    await this.openCycleAndSignal(input.tracked, hash)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readJson<T>(path: string, parse: (raw: unknown) => T): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf8')
    return parse(JSON.parse(raw))
  } catch {
    return null
  }
}
