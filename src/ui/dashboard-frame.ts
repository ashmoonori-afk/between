import type { BetweenEvent, BetweenState } from '../core/types'
import { buildDashboardCommandItems } from './command-palette'
import { diffSummary, eventTrail, short, truncate } from './DashboardParts'
import { phaseStyle } from './theme'

export const DASHBOARD_FRAME_WIDTH = 92

function ascii(value: string): string {
  return value
    .replace(/\t/g, ' ')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
}

function fit(value: string, width: number): string {
  const clean = ascii(value)
  if (clean.length <= width) return clean.padEnd(width, ' ')
  if (width <= 3) return clean.slice(0, width)
  return `${clean.slice(0, width - 3)}...`
}

function border(): string {
  return `+${'-'.repeat(DASHBOARD_FRAME_WIDTH - 2)}+`
}

function row(value: string): string {
  return `| ${fit(value, DASHBOARD_FRAME_WIDTH - 4)} |`
}

function agentLine(label: string, state: BetweenState, reviewer: boolean): string {
  const agent = reviewer ? state.reviewer : state.developer
  if (reviewer) {
    return `${label} ${agent.name} status ${agent.status} | review ${short(
      state.workflow.last_reviewed_hash,
    )} | trust ${state.evidence_trust}`
  }
  return `${label} ${agent.name} status ${agent.status} | snap ${truncate(
    state.diff.snapshot_path,
    34,
  )}`
}

export function renderDashboardFrame(
  state: BetweenState,
  events: readonly BetweenEvent[],
  now: string,
): string {
  const phase = phaseStyle(state.workflow.phase)
  const wf = state.workflow
  const diff = state.diff
  const bundle = diff.bundle_id ?? diff.bundle_path
  const recent = events.slice(-5)
  const commands = buildDashboardCommandItems(state)
    .map((item) => `${item.key} ${item.label}${item.enabled ? '' : ' (off)'}`)
    .join(' | ')

  const lines = [
    border(),
    row(`B BETWEEN session:${state.project.name} | ${now}`),
    row(
      `PHASE ${phase.label} | WAIT ${wf.waiting_on ?? '-'} | CYCLE ${wf.cycle} | GOAL ${
        wf.cycles_this_goal
      } | TRUST ${state.evidence_trust}`,
    ),
    border(),
    row(
      `BROKER ${state.broker.status} | DIFF ${diffSummary(state)} | HASH ${short(
        diff.hash,
      )} | BUNDLE ${short(bundle, 13)}`,
    ),
    row(
      `REVIEW ${short(wf.last_reviewed_hash)} | SIGNAL ${truncate(state.broker.last_signal, 36)}`,
    ),
    border(),
    row(agentLine('DEVELOPER', state, false)),
    row(agentLine('REVIEWER ', state, true)),
    border(),
    row('RECENT EVENTS'),
    ...(recent.length === 0
      ? [row('no events yet')]
      : recent.map((event) => row(eventTrail(event)))),
  ]

  if (wf.error) {
    lines.push(row(`ERROR ${wf.error.code}: ${wf.error.message}`))
  }

  if (wf.phase === 'human_gate') {
    lines.push(row('APPROVAL needed | between approve merge | next: between goal "<next>"'))
  }

  lines.push(row(`COMMANDS ${commands} | q quit | : palette`), border())
  return `${lines.join('\n')}\n`
}
