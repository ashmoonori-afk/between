/**
 * B6: the cockpit frame — a single cohesive, code-centric control surface rendered from on-disk
 * facts (state + evidence + policy + verification + journal integrity). Kept PURE (data in,
 * string out) and ASCII-only so it is unit-testable without a TTY and never mojibakes on Windows.
 * A thin Ink/print renderer (cli) just prints what this returns.
 */
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
  verification: { passed: number; total: number; allPassed: boolean } | null
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
    `  verify:    ${d.verification ? `${d.verification.passed}/${d.verification.total} checks ${d.verification.allPassed ? 'PASS' : 'FAIL'}` : 'not run'}`,
  )
  out.push(`  verdict:   ${d.verdict}`)
  out.push(`  journal:   ${d.journalValid ? 'VERIFIED' : 'BROKEN'} (${d.journalEntries} entries)`)
  out.push('-'.repeat(60))
  return out.join('\n') + '\n'
}
