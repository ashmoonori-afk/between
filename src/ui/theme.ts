import type { Phase } from '../core/types'

export const COLORS = {
  bg: '#0F1117',
  bgChrome: '#151A23',
  surface: '#1A202C',
  surfaceAlt: '#253042',
  elevated: '#2F3B4F',
  border: '#5A6576',
  divider: '#394557',
  textPrimary: '#FFFFFF',
  textMuted: '#A7B0BE',
  textFaint: '#7D8794',
  icon: '#D8DEE9',
  accent: '#40C4FF',
  accentFill: '#0EA5C6',
  focusRing: '#FFD166',
  accentAlt: '#FF6B9E',
  roleBroker: '#40C4FF',
  roleDeveloper: '#FFC857',
  roleReviewer: '#50FA7B',
  brokerRail: '#243044',
  brokerPrompt: '#FFD166',
  brokerInputBg: '#141B26',
  permission: '#C084FC',
  inputActive: '#4ADE80',
  inputReady: '#FFD166',
  inputOff: '#374151',
  inputText: '#F8FAFC',
  inputDisabledText: '#E5E7EB',
  success: '#4ADE80',
  warning: '#FFD166',
  error: '#FF6B7A',
  phaseIntake: '#40C4FF',
  phaseRouting: '#A78BFA',
  phaseDeveloping: '#FFC857',
  phaseReviewing: '#50FA7B',
  phaseApproval: '#FF6B9E',
  phaseDone: '#4ADE80',
  phaseBlocked: '#FF6B7A',
  phaseIdle: '#7D8794',
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
