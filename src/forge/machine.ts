import { GATE_PASS_STATUSES, nextPhase, type ForgePhase, type ForgePhaseStatus } from './phases'
import type { ForgeBlocker, ForgeDecision, ForgeState } from './state'

/**
 * Why a phase gate is closed, or null if the phase may advance. A gate closes on (a) any open P0
 * blocker, or (b) a phase_status that hasn't reached approved/verified. Pure + unit-tested.
 */
export function gateBlock(state: ForgeState): string | null {
  const p0 = state.open_blockers.filter((b) => b.severity === 'P0')
  if (p0.length > 0) {
    return `${p0.length} open P0 blocker(s): ${p0.map((b) => b.description).join('; ')}`
  }
  if (!GATE_PASS_STATUSES.includes(state.phase_status)) {
    return `phase_status is "${state.phase_status}" — must be one of ${GATE_PASS_STATUSES.join('/')}`
  }
  return null
}

export function canAdvance(state: ForgeState): boolean {
  return gateBlock(state) === null && nextPhase(state.current_phase) !== null
}

/**
 * Advance to the next phase (immutable). Throws if the gate is closed or already at the last
 * phase — callers should check `gateBlock`/`nextPhase` first for a friendly message.
 */
export function advance(state: ForgeState): ForgeState {
  const blocked = gateBlock(state)
  if (blocked) throw new Error(`forge gate closed: ${blocked}`)
  const next = nextPhase(state.current_phase)
  if (!next) throw new Error('forge is already at the final phase (retrospective)')
  return {
    ...state,
    current_phase: next,
    phase_status: 'in_progress',
    next_recommended_action: `Work the "${next}" phase, then set status approved.`,
  }
}

export function setStatus(state: ForgeState, status: ForgePhaseStatus): ForgeState {
  return { ...state, phase_status: status }
}

export function addBlocker(state: ForgeState, blocker: ForgeBlocker): ForgeState {
  return {
    ...state,
    open_blockers: [...state.open_blockers, blocker],
    phase_status: blocker.severity === 'P0' ? 'blocked' : state.phase_status,
  }
}

/** Remove the blocker at `index` (immutable); out-of-range index returns state unchanged. */
export function removeBlocker(state: ForgeState, index: number): ForgeState {
  if (index < 0 || index >= state.open_blockers.length) return state
  const open_blockers = state.open_blockers.filter((_, i) => i !== index)
  const status = open_blockers.some((b) => b.severity === 'P0') ? 'blocked' : state.phase_status
  return { ...state, open_blockers, phase_status: status }
}

export function addDecision(state: ForgeState, decision: ForgeDecision): ForgeState {
  return { ...state, decisions: [...state.decisions, decision] }
}

export function setPhase(state: ForgeState, phase: ForgePhase): ForgeState {
  return { ...state, current_phase: phase, phase_status: 'in_progress' }
}
