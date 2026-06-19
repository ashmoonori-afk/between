/**
 * The PWSForge linear lifecycle, made programmatic so the broker can drive it (Phase 5:
 * "skill builtin to the broker"). Order matches `.claude/skills/PWSForge` and the state schema.
 */
export const FORGE_PHASES = [
  'intake',
  'interview',
  'startup_prd',
  'ui_direction',
  'handoff_prd',
  'architecture_stack',
  'implementation_plan',
  'build',
  'qa',
  'release_prep',
  'deployment_upload',
  'retrospective',
] as const

export type ForgePhase = (typeof FORGE_PHASES)[number]

export const FORGE_PHASE_STATUSES = [
  'not_started',
  'in_progress',
  'blocked',
  'ready_for_review',
  'approved',
  'verified',
] as const

export type ForgePhaseStatus = (typeof FORGE_PHASE_STATUSES)[number]

/** Statuses that satisfy a phase gate (a phase must reach one of these to advance). */
export const GATE_PASS_STATUSES: ForgePhaseStatus[] = ['approved', 'verified']

/** Phases whose work is actual execution/coding — these MUST route through the Between CLI. */
export const EXECUTION_PHASES: ForgePhase[] = ['build', 'qa', 'deployment_upload']

const ARTIFACT: Record<ForgePhase, string> = {
  intake: '00-intake.md',
  interview: '01-interview-notes.md',
  startup_prd: '02-startup-prd.md',
  ui_direction: '03-ui-direction.md',
  handoff_prd: '05-handoff-prd.md',
  architecture_stack: '06-architecture.md',
  implementation_plan: '08-implementation-plan.md',
  build: '09-task-briefs/',
  qa: '10-qa-checklist.md',
  release_prep: '11-release-checklist.md',
  deployment_upload: '12-decision-log.md',
  retrospective: '13-phase-gate-scorecard.md',
}

export function phaseIndex(phase: ForgePhase): number {
  return FORGE_PHASES.indexOf(phase)
}

export function nextPhase(phase: ForgePhase): ForgePhase | null {
  const i = phaseIndex(phase)
  return i >= 0 && i < FORGE_PHASES.length - 1 ? (FORGE_PHASES[i + 1] ?? null) : null
}

export function isExecutionPhase(phase: ForgePhase): boolean {
  return EXECUTION_PHASES.includes(phase)
}

export function phaseArtifact(phase: ForgePhase): string {
  return ARTIFACT[phase]
}
