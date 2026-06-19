import type { EventName, Phase } from './types'
import { TERMINAL_PHASES } from './types'

/**
 * Explicit phase transition table (I6). The blueprint listed 14 phase NAMES with no
 * transitions; this encodes the actual machine: every edge is a (from, event) -> to.
 *
 * The FSM is pure and total: it only decides the next phase. SIDE EFFECTS
 * (snapshot, cycle++, signal send, event log) are performed by the daemon based on
 * the (from, event, to) it observes — keeping this module trivially testable.
 *
 * GUARDS live with the caller: instead of branching inside the FSM, the daemon emits
 * the already-decided event (e.g. it emits `diff_reverted` rather than `diff_stable`
 * when the stable hash equals last_reviewed, and `max_cycles_reached` instead of
 * `diff_stable` when the cap is hit).
 */
export const TRANSITIONS: Readonly<Partial<Record<Phase, Partial<Record<EventName, Phase>>>>> = {
  idle: {
    goal_locked: 'goal_locked',
  },
  goal_locked: {
    dev_started: 'developing',
  },
  developing: {
    diff_detected: 'debouncing',
  },
  debouncing: {
    diff_changed: 'debouncing', // self-loop: candidate changed, restart timer
    diff_stable: 'review_requested',
    diff_reverted: 'developing', // stable hash == last_reviewed -> abort, no cycle
  },
  review_requested: {
    review_acked: 'reviewing', // gate `reviewing` on a real ack (I7)
  },
  reviewing: {
    review_written: 'review_written',
  },
  review_written: {
    review_applied: 'applying_review', // blocking findings -> developer applies
    verify_passed: 'human_gate', // no blocking findings + verification ok -> gate
    verify_failed: 'developing',
  },
  applying_review: {
    review_applied: 'developing', // applying produces a new diff -> next cycle
    verify_failed: 'developing',
  },
  verifying: {
    verify_passed: 'human_gate',
    verify_failed: 'developing',
  },
  human_gate: {
    human_approved: 'done',
    dev_started: 'developing', // human requests another cycle
    cancel: 'done',
  },
  repo_busy: {
    // repo_cleared handled by resume-style restore below
  },
  paused: {
    // resume handled below
  },
  error: {
    // resume (if recoverable) handled below
  },
  done: {
    dev_started: 'developing', // new goal on a finished project
  },
}

/**
 * Universal events that apply from (almost) any phase. Order matters: these are
 * checked before the table. They snapshot the current phase into `previous_phase`
 * so a later resume/clear can restore it.
 */
const PAUSE_LIKE: Partial<Record<EventName, Phase>> = {
  pause: 'paused',
  repo_busy_detected: 'repo_busy',
  fail: 'error',
  agent_died: 'error',
  max_cycles_reached: 'human_gate',
  review_timeout: 'human_gate',
  developer_timeout: 'human_gate',
}

export interface PhaseState {
  phase: Phase
  previous_phase: Phase | null
}

export interface TransitionResult extends PhaseState {
  /** false when the event was not legal from the current phase (no-op) */
  changed: boolean
}

export function isTerminal(phase: Phase): boolean {
  return TERMINAL_PHASES.has(phase)
}

/**
 * Compute the next phase for `event`. Returns the unchanged state with
 * `changed: false` when the event is not legal from the current phase.
 */
export function transition(state: PhaseState, event: EventName): TransitionResult {
  const { phase, previous_phase } = state

  // resume / clear: restore the phase captured before pause/busy/error
  if (event === 'resume' || event === 'repo_cleared') {
    if (phase === 'paused' || phase === 'repo_busy' || phase === 'error') {
      const restored = previous_phase ?? 'developing'
      return { phase: restored, previous_phase: phase, changed: true }
    }
    return { ...state, changed: false }
  }

  // universal interrupts (don't re-enter the same holding phase)
  const interrupt = PAUSE_LIKE[event]
  if (interrupt !== undefined) {
    if (phase === interrupt) return { ...state, changed: false }
    // don't interrupt a finished run
    if (isTerminal(phase)) return { ...state, changed: false }
    return { phase: interrupt, previous_phase: phase, changed: true }
  }

  const next = TRANSITIONS[phase]?.[event]
  if (next === undefined) {
    return { ...state, changed: false }
  }
  return { phase: next, previous_phase: phase, changed: true }
}

/** True when `event` is legal from `phase` (including universal interrupts). */
export function canTransition(phase: Phase, event: EventName): boolean {
  const probe = transition({ phase, previous_phase: null }, event)
  return probe.changed
}
