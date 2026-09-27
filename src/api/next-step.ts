import type { Phase } from '../core/types'

export interface NextStepInput {
  phase: Phase
  waiting_on: string | null
  broker_running: boolean
  queued_commands: number
  /** config agent_mode; null when config.yaml is missing or invalid */
  agent_mode: 'file' | 'oneshot' | 'pty' | null
}

/** One actionable sentence telling a human what to do next, or null when nothing is needed. */
export function nextStep(s: NextStepInput): string | null {
  if (!s.broker_running && s.queued_commands > 0) {
    return `${s.queued_commands} command(s) queued; run \`between start\` to apply them`
  }
  if (s.phase === 'error') return 'fix the error above, then run `between resume`'
  if (s.phase === 'paused') return 'run `between resume` to continue'
  if (s.phase === 'human_gate') {
    return 'review `between evidence`, then approve with `between approve merge` (or steer with `between steer "<text>"`)'
  }
  if (s.phase === 'done') return 'set the next goal with `between goal "<text>"`'
  if (s.phase === 'idle' && !s.broker_running) {
    return 'set a goal with `between goal "<text>"`, then run `between start`'
  }
  if (!s.broker_running) return 'no broker is running; run `between start` to continue'
  if (s.agent_mode === 'file' && (s.waiting_on === 'reviewer' || s.waiting_on === 'developer')) {
    return `file mode: run the ${s.waiting_on} agent yourself (see docs/AGENT-CONTRACT.md), or restart with \`between start --embed\` to host the agents`
  }
  return null
}
