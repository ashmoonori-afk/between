/**
 * B6: the cockpit frame — a single cohesive, code-centric control surface rendered from on-disk
 * facts (state + evidence + policy + verification + journal integrity). Kept PURE (data in,
 * string out) and ASCII-only so it is unit-testable without a TTY and never mojibakes on Windows.
 * A thin Ink/print renderer (cli) just prints what this returns.
 */
import type { CockpitModel } from './cockpit-model'

export interface CockpitGate {
  name: string
  status: string
}

export interface CockpitData {
  project: string
  phase: string
  cycle: number
  evidenceTrust: 'simulated' | 'real'
  changedFiles: number
  insertions: number
  deletions: number
  bundleId: string | null
  blockingFindings: number
  nonBlockingFindings: number
  /** policy risk classification, or null when there is no sealed bundle to evaluate. */
  risk: 'high' | 'normal' | null
  gates: CockpitGate[]
  policySatisfied: boolean | null
  /** evidence verdict: approved | blocked | pending | simulated. */
  verdict: string
  /** verification report summary, or null when `between verify` hasn't run. */
  verification: { passed: number; total: number; allPassed: boolean; durationMs?: number } | null
  time?: { goalAgeMs: number | null; updatedAgoMs: number | null }
  journalValid: boolean
  journalEntries: number
}

function bar(label: string): string {
  const line = `-- ${label} `
  return line + '-'.repeat(Math.max(0, 60 - line.length))
}

/** Pure: render the cockpit as a plain-ASCII multi-line frame. */
export function renderCockpit(d: CockpitData): string {
  const out: string[] = []
  out.push(bar(`Between cockpit · ${d.project}`.replace(/[^\x00-\x7F]/g, '-')))
  out.push(`  phase:     ${d.phase}  (cycle ${d.cycle})`)
  out.push(`  trust:     ${d.evidenceTrust === 'simulated' ? 'SIMULATION (fake agent)' : 'real'}`)
  out.push(
    `  diff:      ${d.changedFiles} files  +${d.insertions} -${d.deletions}   bundle ${d.bundleId ? d.bundleId.slice(0, 8) : '-'}`,
  )
  out.push(`  findings:  ${d.blockingFindings} blocking  ${d.nonBlockingFindings} non-blocking`)
  out.push(
    `  risk:      ${d.risk ?? '-'}   policy ${d.policySatisfied === null ? '-' : d.policySatisfied ? 'SATISFIED' : 'BLOCKED'}`,
  )
  if (d.gates.length > 0) {
    out.push('  gates:')
    for (const g of d.gates) out.push(`    [${g.status}] ${g.name}`)
  }
  out.push(
    `  verify:    ${d.verification ? `${d.verification.passed}/${d.verification.total} checks ${d.verification.allPassed ? 'PASS' : 'FAIL'}${d.verification.durationMs !== undefined ? ` (${formatDuration(d.verification.durationMs)})` : ''}` : 'not run'}`,
  )
  if (d.time) {
    out.push(
      `  time:      goal ${formatNullableDuration(d.time.goalAgeMs)}   updated ${formatNullableDuration(d.time.updatedAgoMs)} ago`,
    )
  }
  out.push(`  verdict:   ${d.verdict}`)
  out.push(`  journal:   ${d.journalValid ? 'VERIFIED' : 'BROKEN'} (${d.journalEntries} entries)`)
  out.push('-'.repeat(60))
  return out.join('\n') + '\n'
}

export function renderCockpitModel(model: CockpitModel): string {
  const out = [renderCockpit(model.summary).trimEnd()]
  out.push(bar('Linked findings'))
  const filterLine = renderFilters(model)
  if (filterLine) out.push(`  filters: ${filterLine}`)
  if (model.findings.length === 0) {
    out.push(filterLine ? '  none (filtered)' : '  none')
  } else {
    for (const item of model.findings.slice(0, 8)) {
      const loc = item.location ? ascii(`${item.location.file}:${item.location.line}`) : '-'
      const state = item.stale ? 'stale' : item.linked ? 'linked' : 'unlinked'
      out.push(
        `  ${item.finding.id} [${item.finding.severity}] ${state} ${loc} agent ${ascii(item.agent)}`,
      )
      out.push(`    ${ascii(oneLine(item.finding.summary))}`)
    }
  }
  out.push(bar('Replay'))
  if (model.selectedReplayCycle) {
    const selected = model.selectedReplayCycle
    out.push(
      `  focus: cycle ${selected.cycle} ${ascii(selected.phase)} ${selected.diffHash ? selected.diffHash.slice(0, 8) : '-'}`,
    )
    if (selected.changedFiles !== undefined) {
      out.push(
        `  diff: ${selected.changedFiles} files +${selected.insertions ?? 0} -${selected.deletions ?? 0} bundle ${selected.bundleId ? selected.bundleId.slice(0, 8) : '-'}`,
      )
    }
  }
  if (model.replayCycles.length === 0) {
    out.push('  no replay snapshots')
  } else {
    for (const item of model.replayCycles.slice(-5)) {
      const phase = ascii(item.phase)
      const mark = model.selectedReplayCycle === item ? '*' : ' '
      out.push(
        `${mark} cycle ${item.cycle}: ${phase} ${item.diffHash ? item.diffHash.slice(0, 8) : '-'}`,
      )
    }
  }
  out.push(bar('Actions'))
  out.push('  between cockpit --action accept|dispute|waive --finding <id> [--reason "..."]')
  out.push('  between cockpit --rerun-checks [--replay-cycle <n>]')
  out.push('-'.repeat(60))
  return out.join('\n') + '\n'
}

function renderFilters(model: CockpitModel): string {
  const out: string[] = []
  if (model.filters.file) out.push(`file=${ascii(model.filters.file)}`)
  if (model.filters.severity) out.push(`severity=${model.filters.severity}`)
  if (model.filters.agent) out.push(`agent=${ascii(model.filters.agent)}`)
  return out.join(' ')
}

function formatNullableDuration(value: number | null): string {
  return value === null ? '-' : formatDuration(value)
}

function formatDuration(value: number): string {
  const ms = Math.max(0, Math.floor(value))
  if (ms < 1000) return `${ms}ms`
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m${seconds}s`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder === 0 ? `${hours}h` : `${hours}h${remainder}m`
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').slice(0, 140)
}

function ascii(value: string): string {
  return value.replace(/[^\x00-\x7F]/g, '-')
}
