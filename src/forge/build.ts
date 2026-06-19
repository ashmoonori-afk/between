import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { isExecutionPhase } from './phases'
import { forgeDir, writeForgeState } from './repository'
import type { ForgeState } from './state'

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'task'
  )
}

export interface BuildBrief {
  slug: string
  goal: string
  brief: string
}

/**
 * Pure: turn an execution-phase task into a broker goal + a task-brief document (PWSForge task
 * brief contract). Throws when the forge isn't at an execution phase — forge refuses to "code"
 * outside build/qa/deployment, and even there it routes the work to the broker (CLI-forced).
 */
export function buildTaskBrief(state: ForgeState, task: string): BuildBrief {
  if (!task.trim()) throw new Error('a task description is required')
  if (!isExecutionPhase(state.current_phase)) {
    throw new Error(
      `forge is at "${state.current_phase}" — advance to the build phase before delegating execution`,
    )
  }
  const slug = slugify(task)
  const goal = `[forge:${state.current_phase}] ${task.trim()}`
  const brief = `# Task brief — ${task.trim()}

- **Phase:** ${state.current_phase}
- **Project:** ${state.project_name}
- **Routed to:** Between broker (developer + reviewer loop) via \`between goal\`

## Scope
${task.trim()}

## Non-goals
- Anything outside the MVP boundary recorded in the handoff PRD.

## Acceptance criteria
- Implements the scope above; tests/build pass; reviewer approves the diff.

## Verification
- \`between status\` shows the cycle reaching human_gate / done with a clean review.

## Constraints
- Security, privacy, and approval boundaries per CLAUDE.md; no secrets in source.

## Return format
- Changed files, commands run, test output, and the review verdict.
`
  return { slug, goal, brief }
}

export interface DelegateResult {
  goal: string
  briefPath: string
  state: ForgeState
}

/**
 * CLI-forced execution: write the task brief under docs/pwsforge/09-task-briefs/ and submit the
 * goal to the Between broker's command bus (injected `submit`). Forge never writes app code
 * itself — all coding flows through the broker. Persists the updated forge state.
 */
export async function delegateBuild(
  root: string,
  state: ForgeState,
  task: string,
  submit: (goal: string) => Promise<void>,
): Promise<DelegateResult> {
  const { slug, goal, brief } = buildTaskBrief(state, task)

  const briefsDir = join(forgeDir(root), '09-task-briefs')
  await mkdir(briefsDir, { recursive: true })
  const seq = existsSync(briefsDir)
    ? (await readdir(briefsDir)).filter((f) => f.endsWith('.md')).length + 1
    : 1
  const briefPath = join(briefsDir, `${String(seq).padStart(2, '0')}-${slug}.md`)
  await writeFile(briefPath, brief, 'utf8')

  await submit(goal)

  const next: ForgeState = {
    ...state,
    last_verified_command: `between goal "${goal}"`,
    last_verified_artifact: briefPath,
    next_recommended_action: 'Run `between start` so the broker develops + reviews this goal.',
  }
  await writeForgeState(root, next)
  return { goal, briefPath, state: next }
}
