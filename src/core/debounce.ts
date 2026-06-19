import type { DebounceState } from './types'

/**
 * Debounce model (I11, I24). The broker must not review a diff that is still changing.
 *
 * This is a PURE function of (persisted debounce state, current hash, now). It is
 * time-based rather than count-based: the candidate must remain unchanged for at least
 * `diff_debounce_seconds`. That makes recovery deterministic after a mid-debounce
 * crash — the persisted `candidate_first_seen_at` is reloaded and re-evaluated against
 * the live hash, with no dependency on how many polls happened to fire (I11).
 */
export type DebounceDecision =
  | 'started' // first time we see a candidate
  | 'restarted' // candidate changed -> timer resets
  | 'pending' // candidate stable but window not yet elapsed
  | 'stable' // candidate stable for >= window -> ready to open a cycle

export interface DebounceStep {
  decision: DebounceDecision
  state: DebounceState
}

export function emptyDebounce(): DebounceState {
  return { candidate_hash: null, candidate_first_seen_at: null, debounce_restarts: 0 }
}

/**
 * Feed the current hash + time into the debounce model and get the decision plus the
 * next persisted debounce state.
 *
 * @param prev    persisted debounce state
 * @param currentHash  the just-computed diff hash (non-empty)
 * @param nowIso  ISO timestamp for "now"
 * @param nowMs   epoch ms for "now"
 * @param windowSeconds  diff_debounce_seconds
 */
export function stepDebounce(
  prev: Readonly<DebounceState>,
  currentHash: string,
  nowIso: string,
  nowMs: number,
  windowSeconds: number,
): DebounceStep {
  if (prev.candidate_hash === null) {
    return {
      decision: 'started',
      state: { candidate_hash: currentHash, candidate_first_seen_at: nowIso, debounce_restarts: 0 },
    }
  }

  if (prev.candidate_hash !== currentHash) {
    return {
      decision: 'restarted',
      state: {
        candidate_hash: currentHash,
        candidate_first_seen_at: nowIso,
        debounce_restarts: prev.debounce_restarts + 1,
      },
    }
  }

  // candidate unchanged — has it been stable long enough?
  const firstSeenMs = prev.candidate_first_seen_at ? Date.parse(prev.candidate_first_seen_at) : nowMs
  const elapsedMs = nowMs - firstSeenMs
  if (elapsedMs >= windowSeconds * 1000) {
    return { decision: 'stable', state: { ...prev } }
  }
  return { decision: 'pending', state: { ...prev } }
}
