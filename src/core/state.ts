import type { BetweenState, Clock, Phase, ProjectRef } from './types'
import { STATE_SCHEMA_VERSION } from './types'
import { projectPhase } from './phase-projection'
import { emptyDebounce } from './debounce'

/** Maximum size of the bounded reviewed-hashes ring (I4). */
export const REVIEWED_HASHES_MAX = 50

export interface InitialStateOptions {
  project: ProjectRef
  developerName?: string
  reviewerName?: string
}

/** Build a fresh idle state for a new project. */
export function initialState(opts: InitialStateOptions, clock: Clock): BetweenState {
  const now = clock.nowIso()
  const base: BetweenState = {
    schema_version: STATE_SCHEMA_VERSION,
    project: opts.project,
    workflow: {
      phase: 'idle',
      previous_phase: null,
      cycle: 0,
      cycles_this_goal: 0,
      waiting_on: null,
      last_reviewed_hash: null,
      reviewed_hashes: [],
      started_at: null,
      updated_at: now,
      error: null,
    },
    diff: {
      hash: null,
      previous_hash: null,
      changed_files: 0,
      insertions: 0,
      deletions: 0,
      snapshot_path: null,
    },
    debounce: emptyDebounce(),
    developer: { name: opts.developerName ?? 'claude', terminal_id: 'developer', status: 'idle' },
    reviewer: { name: opts.reviewerName ?? 'codex', terminal_id: 'reviewer', status: 'idle' },
    broker: { status: 'stable', last_signal: null, last_signal_at: null },
    approval: null,
  }
  return withProjection(base)
}

/**
 * Recompute the derived fields (`waiting_on`, agent statuses, broker status) from
 * `phase` — the single source of truth (I12). Pure: returns a new state.
 */
export function withProjection(state: BetweenState): BetweenState {
  const p = projectPhase(state.workflow.phase)
  return {
    ...state,
    workflow: { ...state.workflow, waiting_on: p.waiting_on },
    developer: { ...state.developer, status: p.developer },
    reviewer: { ...state.reviewer, status: p.reviewer },
    broker: { ...state.broker, status: p.broker },
  }
}

/** Stamp `updated_at`. Pure. */
export function touch(state: BetweenState, clock: Clock): BetweenState {
  return { ...state, workflow: { ...state.workflow, updated_at: clock.nowIso() } }
}

/** Record a reviewed hash into the bounded ring + set last_reviewed_hash (I4). */
export function recordReviewedHash(state: BetweenState, hash: string): BetweenState {
  const ring = [hash, ...state.workflow.reviewed_hashes.filter((h) => h !== hash)].slice(
    0,
    REVIEWED_HASHES_MAX,
  )
  return {
    ...state,
    workflow: { ...state.workflow, last_reviewed_hash: hash, reviewed_hashes: ring },
  }
}

/** True when `hash` has already been reviewed (dedup guard, I4). */
export function isAlreadyReviewed(state: BetweenState, hash: string): boolean {
  return state.workflow.last_reviewed_hash === hash || state.workflow.reviewed_hashes.includes(hash)
}

/** Set the phase + previous_phase and reproject derived fields. Pure. */
export function setPhase(state: BetweenState, phase: Phase, previous: Phase | null): BetweenState {
  return withProjection({
    ...state,
    workflow: { ...state.workflow, phase, previous_phase: previous },
  })
}
