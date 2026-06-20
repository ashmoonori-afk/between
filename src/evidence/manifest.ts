import type { ApprovalToken, ProjectRef, ReviewRecord, VerifyRecord } from '../core/types'
import type { ReviewBundle } from '../review/bundle'

/**
 * B4: a portable, exporter-agnostic Evidence Manifest for one review cycle. It binds the immutable
 * bundle (A1), the reviewer findings, the verification result, and the (signed, freshness-checked)
 * approval into a single auditable record. Markdown / Obsidian / GitHub Checks / SARIF / JSON /
 * OpenTelemetry are all just exporters of THIS object -- Obsidian is one port among several, not a
 * core dependency.
 */
export const EVIDENCE_SCHEMA_VERSION = 1

export type EvidenceVerdict = 'approved' | 'blocked' | 'pending' | 'simulated'

export interface EvidenceManifestInput {
  project: ProjectRef
  cycle: number
  phase: string
  evidenceTrust: 'simulated' | 'real'
  developer: string
  reviewer: string
  /** stamped by the caller (CLI clock) -- keeps this builder pure. */
  generatedAt: string
  bundle: ReviewBundle | null
  review: ReviewRecord | null
  verify: VerifyRecord | null
  approval: ApprovalToken | null
}

export interface EvidenceManifest {
  schema_version: number
  generated_at: string
  project: string
  cycle: number
  phase: string
  evidence_trust: 'simulated' | 'real'
  verdict: EvidenceVerdict
  agents: { developer: string; reviewer: string }
  bundle: {
    bundle_id: string
    diff_hash: string
    head_sha: string | null
    branch: string | null
  } | null
  findings: { blocking: number; non_blocking: number; items: ReviewRecord['findings'] }
  verify: { passed: boolean; summary: string } | null
  approval: {
    scope: string
    granted_at: string
    bundle_id: string | null
    expires_at: string
    signed: boolean
  } | null
}

export function deriveVerdict(input: EvidenceManifestInput): EvidenceVerdict {
  if (input.evidenceTrust === 'simulated') return 'simulated'
  if (input.approval && input.approval.scope === 'merge') return 'approved'
  const blocking = (input.review?.findings ?? []).filter((f) => f.severity === 'blocking').length
  if (blocking > 0) return 'blocked'
  return 'pending'
}

/** Pure: assemble the manifest. Unit-tested. */
export function buildEvidenceManifest(input: EvidenceManifestInput): EvidenceManifest {
  const findings = input.review?.findings ?? []
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    generated_at: input.generatedAt,
    project: input.project.name,
    cycle: input.cycle,
    phase: input.phase,
    evidence_trust: input.evidenceTrust,
    verdict: deriveVerdict(input),
    agents: { developer: input.developer, reviewer: input.reviewer },
    bundle: input.bundle
      ? {
          bundle_id: input.bundle.bundle_id,
          diff_hash: input.bundle.diff_hash,
          head_sha: input.bundle.repository.head_sha,
          branch: input.bundle.repository.branch,
        }
      : null,
    findings: {
      blocking: findings.filter((f) => f.severity === 'blocking').length,
      non_blocking: findings.filter((f) => f.severity === 'non-blocking').length,
      items: findings,
    },
    verify: input.verify ? { passed: input.verify.passed, summary: input.verify.summary } : null,
    approval: input.approval
      ? {
          scope: input.approval.scope,
          granted_at: input.approval.granted_at,
          bundle_id: input.approval.bundle_id,
          expires_at: input.approval.expires_at,
          signed: Boolean(input.approval.sig),
        }
      : null,
  }
}

/** Pure: render a human-readable Markdown evidence report. */
export function toMarkdown(m: EvidenceManifest): string {
  const lines: string[] = []
  lines.push(`# Evidence - ${m.project} | cycle ${m.cycle}`)
  lines.push('')
  lines.push(
    `- **Verdict:** ${m.verdict}${m.evidence_trust === 'simulated' ? ' (SIMULATION)' : ''}`,
  )
  lines.push(`- **Phase:** ${m.phase}`)
  lines.push(`- **Agents:** developer ${m.agents.developer} | reviewer ${m.agents.reviewer}`)
  lines.push(`- **Generated:** ${m.generated_at}`)
  lines.push('')
  lines.push('## Review object (immutable bundle)')
  if (m.bundle) {
    lines.push(`- bundle_id: \`${m.bundle.bundle_id}\``)
    lines.push(`- diff_hash: \`${m.bundle.diff_hash}\``)
    lines.push(`- head: \`${m.bundle.head_sha ?? '-'}\` on \`${m.bundle.branch ?? '-'}\``)
  } else {
    lines.push('- _no bundle sealed yet_')
  }
  lines.push('')
  lines.push(
    `## Findings (${m.findings.blocking} blocking, ${m.findings.non_blocking} non-blocking)`,
  )
  if (m.findings.items.length === 0) lines.push('- _none_')
  for (const f of m.findings.items) lines.push(`- [${f.severity}] ${f.summary}`)
  lines.push('')
  lines.push('## Verification')
  lines.push(
    m.verify ? `- ${m.verify.passed ? 'PASSED' : 'FAILED'} - ${m.verify.summary}` : '- _none_',
  )
  lines.push('')
  lines.push('## Approval')
  if (m.approval) {
    lines.push(
      `- ${m.approval.scope} | signed=${m.approval.signed} | expires ${m.approval.expires_at}`,
    )
    lines.push(`- bound to bundle: \`${m.approval.bundle_id ?? '-'}\``)
  } else {
    lines.push('- _not approved_')
  }
  return lines.join('\n') + '\n'
}
