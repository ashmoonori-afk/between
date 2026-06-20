import type { Phase } from '../core/types'

export const COLORS = {
  bg: '#19161D',
  bgChrome: '#18161C',
  surface: '#211D25',
  surfaceAlt: '#28242E',
  elevated: '#352F3D',
  border: '#4A464F',
  divider: '#3A363F',
  textPrimary: '#FFFFFF',
  textMuted: '#938F9B',
  textFaint: '#A6A5A7',
  icon: '#C1BEC6',
  accent: '#B080FF',
  accentFill: '#8141E6',
  focusRing: '#9E61FF',
  accentAlt: '#8DC8FB',
  success: '#80FFB5',
  warning: '#FFCF99',
  error: '#FF8080',
  phaseIntake: '#8DC8FB',
  phaseRouting: '#C3A0FD',
  phaseDeveloping: '#FFCF99',
  phaseReviewing: '#80F4FF',
  phaseApproval: '#B080FF',
  phaseDone: '#80FFB5',
  phaseBlocked: '#FF8080',
  phaseIdle: '#565F89',
} as const

export interface PhaseStyle {
  color: string
  glyph: string
  label: string
  dim?: boolean
}

export function phaseStyle(phase: Phase): PhaseStyle {
  switch (phase) {
    case 'idle':
      return { color: COLORS.phaseIdle, glyph: '-', label: 'IDLE', dim: true }
    case 'goal_locked':
      return { color: COLORS.phaseRouting, glyph: '>', label: 'GOAL LOCKED' }
    case 'developing':
      return { color: COLORS.phaseDeveloping, glyph: 'D', label: 'DEVELOPING' }
    case 'diff_detected':
    case 'debouncing':
      return { color: COLORS.phaseDeveloping, glyph: '~', label: 'SETTLING DIFF' }
    case 'review_requested':
      return { color: COLORS.phaseReviewing, glyph: 'R', label: 'REVIEW REQUESTED' }
    case 'reviewing':
      return { color: COLORS.phaseReviewing, glyph: 'R', label: 'REVIEWING' }
    case 'review_written':
      return { color: COLORS.phaseReviewing, glyph: 'R', label: 'REVIEW WRITTEN' }
    case 'applying_review':
      return { color: COLORS.phaseDeveloping, glyph: 'A', label: 'APPLYING REVIEW' }
    case 'verifying':
      return { color: COLORS.phaseDeveloping, glyph: 'V', label: 'VERIFYING' }
    case 'human_gate':
      return { color: COLORS.phaseApproval, glyph: 'H', label: 'AWAITING APPROVAL' }
    case 'repo_busy':
      return { color: COLORS.warning, glyph: '!', label: 'REPO BUSY' }
    case 'done':
      return { color: COLORS.phaseDone, glyph: '+', label: 'DONE' }
    case 'paused':
      return { color: COLORS.phaseIdle, glyph: 'P', label: 'PAUSED', dim: true }
    case 'error':
      return { color: COLORS.phaseBlocked, glyph: '!', label: 'ERROR' }
    default: {
      const _never: never = phase
      return _never
    }
  }
}

export const GLYPH = {
  brand: 'B',
  live: '*',
  spinner: '~',
  ok: '+',
  fail: 'x',
  pause: '!',
  bar: '|',
  divider: '-',
  dev: 'D',
  reviewer: 'R',
  flag: '!',
} as const

export function noColor(): boolean {
  return Boolean(process.env.NO_COLOR)
}
