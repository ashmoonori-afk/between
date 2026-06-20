import type { Policy } from './schema'

export type RiskLevel = 'high' | 'normal'
export type GateStatus = 'pass' | 'fail' | 'not_enforced'

export interface GateResult {
  name: string
  status: GateStatus
  detail: string
}

export interface PolicyInput {
  changedPaths: string[]
  blockingFindings: number
  /** true/false from the verification record, or null when none exists. */
  verifyPassed: boolean | null
  /** secret-shaped hits in the added diff lines (B3); null/undefined = scan not run. */
  secretScanHits?: number | null
  /** total npm-audit vulnerabilities (B3); null/undefined = audit not run. */
  depAuditVulns?: number | null
}

export interface PolicyEvaluation {
  risk: RiskLevel
  gates: GateResult[]
  /** true when no required gate FAILED (not_enforced gates are advisory, never block). */
  satisfied: boolean
  requiredApprovals: { reviewers: number; local_human_required: boolean }
}

/** Normalize a glob/path to the forward-slash, no-leading-`./` form git reports (review: bypass). */
function normalizeSlashes(s: string): string {
  return s.replace(/\\/g, '/').replace(/^\.\//, '')
}

/**
 * Convert a glob to an anchored RegExp. `**` matches any run including `/`, and a leading `**​/`
 * matches ZERO or more path segments so `**​/*.key` matches a ROOT-level `secret.key`; `*` matches
 * within a single segment. Globs + paths are slash-normalized first so a backslash- or
 * `./`-prefixed glob can't silently dodge a high-risk classification (review). Guarded against
 * ReDoS via length + wildcard caps — policy.yaml is repo-controlled, but a malicious glob must not
 * hang evaluation.
 */
export function globToRegExp(glob: string): RegExp {
  if (glob.length > 256) throw new Error(`policy glob too long (>256): ${glob.slice(0, 40)}...`)
  if ((glob.match(/\*/g)?.length ?? 0) > 12) {
    throw new Error(`policy glob has too many wildcards: ${glob}`)
  }
  const g = normalizeSlashes(glob)
  let re = ''
  let i = 0
  while (i < g.length) {
    if (g.startsWith('**/', i)) {
      re += '(?:.*/)?' // zero or more leading path segments (including none)
      i += 3
    } else if (g.startsWith('**', i)) {
      re += '.*'
      i += 2
    } else if (g[i] === '*') {
      re += '[^/]*'
      i += 1
    } else {
      re += g[i]!.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      i += 1
    }
  }
  return new RegExp(`^${re}$`)
}

export function globMatch(glob: string, path: string): boolean {
  return globToRegExp(glob).test(normalizeSlashes(path))
}

/**
 * Extract changed file paths from a `git diff --raw` body (one path after the tab per line).
 * Depends on `--no-renames` + `core.quotepath=false` upstream (GitAdapter pins both), so each line
 * carries exactly one unquoted path after the tab.
 */
export function changedPathsFromRaw(trackedRaw: string): string[] {
  return trackedRaw
    .split('\n')
    .map((l) => {
      const tab = l.indexOf('\t')
      return tab >= 0 ? l.slice(tab + 1).trim() : ''
    })
    .filter((p) => p.length > 0)
}

/** A change is high-risk if ANY changed path matches a high_risk_paths glob. */
export function classifyRisk(policy: Policy, changedPaths: string[]): RiskLevel {
  const high = changedPaths.some((p) => policy.high_risk_paths.some((g) => globMatch(g, p)))
  return high ? 'high' : 'normal'
}

function evaluateGate(name: string, input: PolicyInput): GateResult {
  switch (name) {
    case 'no_blocking_findings':
      return {
        name,
        status: input.blockingFindings === 0 ? 'pass' : 'fail',
        detail: `${input.blockingFindings} blocking finding(s)`,
      }
    case 'verification':
      return {
        name,
        status: input.verifyPassed === true ? 'pass' : 'fail',
        detail:
          input.verifyPassed === null
            ? 'no verification record'
            : `verification ${input.verifyPassed ? 'passed' : 'failed'}`,
      }
    case 'secret_scan': {
      // B3: enforced when a scan result is supplied; otherwise advisory (scan not run).
      const hits = input.secretScanHits
      if (hits === null || hits === undefined) {
        return { name, status: 'not_enforced', detail: 'secret scan not run' }
      }
      return {
        name,
        status: hits === 0 ? 'pass' : 'fail',
        detail: `${hits} secret-shaped hit(s) in the added diff`,
      }
    }
    case 'dependency_audit': {
      const vulns = input.depAuditVulns
      if (vulns === null || vulns === undefined) {
        return { name, status: 'not_enforced', detail: 'dependency audit not run' }
      }
      return {
        name,
        status: vulns === 0 ? 'pass' : 'fail',
        detail: `${vulns} dependency vulnerabilit${vulns === 1 ? 'y' : 'ies'}`,
      }
    }
    default:
      // unknown gate (the schema enum prevents this in practice) -> advisory, never blocking.
      return { name, status: 'not_enforced', detail: 'gate not yet enforced' }
  }
}

/** Pure: classify risk, evaluate each required gate, and resolve the approval rule. Unit-tested. */
export function evaluatePolicy(policy: Policy, input: PolicyInput): PolicyEvaluation {
  const risk = classifyRisk(policy, input.changedPaths)
  const gateNames = risk === 'high' ? policy.gates.high : policy.gates.normal
  const gates = gateNames.map((n) => evaluateGate(n, input))
  const satisfied = gates.every((g) => g.status !== 'fail')
  const requiredApprovals = risk === 'high' ? policy.approvals.high : policy.approvals.normal
  return { risk, gates, satisfied, requiredApprovals }
}
