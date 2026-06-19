import { z } from 'zod'
import { FORGE_PHASES, FORGE_PHASE_STATUSES, type ForgePhase } from './phases'

/**
 * Typed mirror of `.claude/skills/PWSForge/templates/state.schema.json`. The forge state is the
 * resume-safe project truth (docs/pwsforge/state.json); validated at the boundary like config.
 */
export const ForgeBlockerSchema = z.object({
  severity: z.enum(['P0', 'P1', 'P2', 'P3']),
  description: z.string(),
  evidence: z.string().optional(),
  owner: z.string().optional(),
  next_action: z.string().optional(),
})
export type ForgeBlocker = z.infer<typeof ForgeBlockerSchema>

export const ForgeDecisionSchema = z.object({
  decision: z.string(),
  reason: z.string(),
  alternatives_considered: z.array(z.string()).optional(),
  date: z.string().optional(),
})
export type ForgeDecision = z.infer<typeof ForgeDecisionSchema>

export const ForgeStateSchema = z.object({
  project_name: z.string(),
  current_phase: z.enum(FORGE_PHASES),
  phase_status: z.enum(FORGE_PHASE_STATUSES),
  platform_priority: z.array(z.string()).default([]),
  desired_output_depth: z.string().optional(),
  approved_assumptions: z.array(z.string()).default([]),
  open_questions: z.array(z.string()).default([]),
  open_blockers: z.array(ForgeBlockerSchema).default([]),
  selected_stack: z.record(z.string(), z.unknown()).optional(),
  decisions: z.array(ForgeDecisionSchema).default([]),
  phase_scores: z
    .record(
      z.string(),
      z.object({
        average: z.number().optional(),
        p0_blockers: z.number().int().optional(),
        notes: z.string().optional(),
      }),
    )
    .optional(),
  last_verified_command: z.string().default(''),
  last_verified_result: z.string().default(''),
  last_verified_artifact: z.string().optional(),
  next_recommended_action: z.string().default(''),
})
export type ForgeState = z.infer<typeof ForgeStateSchema>

export interface InitialForgeOptions {
  platformPriority?: string[]
  idea?: string
}

/** A fresh forge state parked at intake/in_progress. */
export function initialForgeState(projectName: string, opts: InitialForgeOptions = {}): ForgeState {
  const phase: ForgePhase = 'intake'
  return ForgeStateSchema.parse({
    project_name: projectName,
    current_phase: phase,
    phase_status: 'in_progress',
    platform_priority: opts.platformPriority ?? [],
    approved_assumptions: [],
    open_questions: opts.idea ? [] : ['What app is being built? (run `between forge intake`)'],
    open_blockers: [],
    decisions: [],
    last_verified_command: '',
    last_verified_result: '',
    next_recommended_action: 'Capture intake: idea, platforms, output depth.',
  })
}

/** Validate raw (parsed-from-JSON) forge state, failing fast with precise key paths. */
export function parseForgeState(raw: unknown): ForgeState {
  const result = ForgeStateSchema.safeParse(raw)
  if (!result.success) {
    const lines = result.error.issues.map((i) => {
      const path = i.path.length > 0 ? i.path.join('.') : '(root)'
      return `  - ${path}: ${i.message}`
    })
    throw new Error(`Invalid forge state.json:\n${lines.join('\n')}`)
  }
  return result.data
}
