import type { Phase } from '../core/types'

/**
 * Visual system for the broker dashboard, from docs/ui-design-spec.md.
 * Palette = Kiro's coherent single-violet dark system (sourced from the Kiro dark theme);
 * the cmux influence is the *pattern* layer: functional color = status, opacity-tier text
 * hierarchy, and a colored left-edge attention bar (▎) instead of heavy boxes.
 */
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
  // phase-status colors
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

/** Map every Between phase to a color + glyph + display label (spec §5). */
export function phaseStyle(phase: Phase): PhaseStyle {
  switch (phase) {
    case 'idle':
      return { color: COLORS.phaseIdle, glyph: '●', label: 'IDLE', dim: true }
    case 'goal_locked':
      return { color: COLORS.phaseRouting, glyph: '⊙', label: 'GOAL LOCKED' }
    case 'developing':
      return { color: COLORS.phaseDeveloping, glyph: '⚒', label: 'DEVELOPING' }
    case 'diff_detected':
    case 'debouncing':
      return { color: COLORS.phaseDeveloping, glyph: '◐', label: 'SETTLING DIFF' }
    case 'review_requested':
      return { color: COLORS.phaseReviewing, glyph: '◎', label: 'REVIEW REQUESTED' }
    case 'reviewing':
      return { color: COLORS.phaseReviewing, glyph: '◎', label: 'REVIEWING' }
    case 'review_written':
      return { color: COLORS.phaseReviewing, glyph: '◎', label: 'REVIEW WRITTEN' }
    case 'applying_review':
      return { color: COLORS.phaseDeveloping, glyph: '⚒', label: 'APPLYING REVIEW' }
    case 'verifying':
      return { color: COLORS.phaseDeveloping, glyph: '◐', label: 'VERIFYING' }
    case 'human_gate':
      return { color: COLORS.phaseApproval, glyph: '⏸', label: 'AWAITING APPROVAL' }
    case 'repo_busy':
      return { color: COLORS.warning, glyph: '⚑', label: 'REPO BUSY' }
    case 'done':
      return { color: COLORS.phaseDone, glyph: '✓', label: 'DONE' }
    case 'paused':
      return { color: COLORS.phaseIdle, glyph: '⏸', label: 'PAUSED', dim: true }
    case 'error':
      return { color: COLORS.phaseBlocked, glyph: '✗', label: 'ERROR' }
    default: {
      const _never: never = phase
      return _never
    }
  }
}

/** Glyphs reused across the dashboard (spec §3/§5). */
export const GLYPH = {
  brand: '⊙',
  live: '●',
  spinner: '◐',
  ok: '✓',
  fail: '✗',
  pause: '⏸',
  bar: '▎',
  dev: '⚒',
  reviewer: '◎',
  flag: '⚑',
} as const

/** True when color output should be suppressed (honors NO_COLOR, spec §2). */
export function noColor(): boolean {
  return Boolean(process.env.NO_COLOR)
}
