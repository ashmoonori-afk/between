import type { Actor, AgentStatus, BrokerStatus, Phase } from './types'

/**
 * Derive `waiting_on` and per-agent statuses from `phase` (I12).
 *
 * `phase` is the SINGLE SOURCE OF TRUTH. `waiting_on` and agent statuses are never an
 * independent third copy — they are projected here on every write and reconciled on
 * load, so they cannot desync.
 */
export interface PhaseProjection {
  waiting_on: Actor
  developer: AgentStatus
  reviewer: AgentStatus
  broker: BrokerStatus
}

export function projectPhase(phase: Phase): PhaseProjection {
  switch (phase) {
    case 'idle':
      return { waiting_on: null, developer: 'idle', reviewer: 'idle', broker: 'stable' }
    case 'goal_locked':
      return { waiting_on: 'developer', developer: 'idle', reviewer: 'idle', broker: 'stable' }
    case 'developing':
      return { waiting_on: 'developer', developer: 'working', reviewer: 'idle', broker: 'stable' }
    case 'diff_detected':
    case 'debouncing':
      return { waiting_on: 'developer', developer: 'working', reviewer: 'idle', broker: 'busy' }
    case 'review_requested':
      return {
        waiting_on: 'reviewer',
        developer: 'waiting_for_review',
        reviewer: 'idle',
        broker: 'stable',
      }
    case 'reviewing':
      return {
        waiting_on: 'reviewer',
        developer: 'waiting_for_review',
        reviewer: 'reviewing_diff',
        broker: 'stable',
      }
    case 'review_written':
      return {
        waiting_on: 'developer',
        developer: 'applying_review',
        reviewer: 'idle',
        broker: 'stable',
      }
    case 'applying_review':
      return {
        waiting_on: 'developer',
        developer: 'applying_review',
        reviewer: 'idle',
        broker: 'stable',
      }
    case 'verifying':
      return { waiting_on: 'developer', developer: 'working', reviewer: 'idle', broker: 'stable' }
    case 'human_gate':
      return { waiting_on: 'human', developer: 'idle', reviewer: 'idle', broker: 'stable' }
    case 'repo_busy':
      return { waiting_on: null, developer: 'unknown', reviewer: 'unknown', broker: 'busy' }
    case 'paused':
      return { waiting_on: null, developer: 'idle', reviewer: 'idle', broker: 'paused' }
    case 'error':
      return { waiting_on: 'human', developer: 'unknown', reviewer: 'unknown', broker: 'error' }
    case 'done':
      return { waiting_on: null, developer: 'idle', reviewer: 'idle', broker: 'stable' }
    default: {
      // exhaustiveness guard — a new Phase must be handled here
      const _never: never = phase
      return _never
    }
  }
}
