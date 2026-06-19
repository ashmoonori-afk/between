import type { AgentRole } from '../adapters/agent-host'
import type { BetweenEvent, BetweenState, EventName } from '../core/types'
import { transition } from '../core/fsm'
import { setPhase, touch } from '../core/state'
import { reconcile } from './reconcile'
import type { DaemonContext, DaemonDeps, EmitExtra } from './context'
import { watchForNewDiff, runDebounce, awaitAck, awaitReview, handleReviewWritten } from './phases'
import { drainCommands } from './commands'

export type { DaemonDeps } from './context'

/**
 * The broker daemon. Owns the single-writer state (`persist`/`emit`/`dispatch`) and the §8
 * poll loop; the phase/command handlers live in phases.ts / commands.ts and reach state
 * through a `DaemonContext`. `tick()` performs exactly one iteration and is the unit the
 * integration tests drive with a controllable clock.
 */
export class Daemon {
  private current: BetweenState
  private stopRequested = false
  private readonly ctx: DaemonContext

  constructor(
    private readonly deps: DaemonDeps,
    initial: BetweenState,
  ) {
    this.current = initial
    this.ctx = {
      deps: this.deps,
      current: () => this.current,
      persist: (next) => this.persist(next),
      emit: (event, extra) => this.emit(event, extra),
      dispatch: (event, mutate) => this.dispatch(event, mutate),
      requestStop: () => this.requestStop(),
    }
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

  private async emit(event: string, extra?: EmitExtra): Promise<void> {
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
    extra?: EmitExtra,
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
    await this.emit(event, extra)
    return true
  }

  async reportAgentDied(role: AgentRole, exitCode: number | null): Promise<void> {
    if (this.stopRequested) return
    const exitText = exitCode === null ? 'unknown code' : `code ${exitCode}`
    await this.dispatch(
      'agent_died',
      (s) => ({
        ...s,
        [role]: { ...s[role], status: 'dead' },
        workflow: {
          ...s.workflow,
          error: {
            code: 'agent_died',
            message: `${role} agent exited with ${exitText}`,
            occurred_at: this.deps.clock.nowIso(),
            recoverable: true,
            detail: { role, exit_code: exitCode },
          },
        },
      }),
      { detail: { role, exit_code: exitCode } },
    )
  }

  // ---- one iteration -------------------------------------------------------

  async tick(): Promise<void> {
    await drainCommands(this.ctx)
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
        await watchForNewDiff(this.ctx)
        break
      case 'debouncing':
        await runDebounce(this.ctx)
        break
      case 'review_requested':
        await awaitAck(this.ctx)
        break
      case 'reviewing':
        await awaitReview(this.ctx)
        break
      case 'review_written':
        await handleReviewWritten(this.ctx)
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
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
