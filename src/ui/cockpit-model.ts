import type { Finding } from '../core/types'
import type { CockpitData } from './cockpit-frame'

export interface DiffHunk {
  file: string
  header: string
  newStart: number
  newEnd: number
  lines: string[]
}

export interface ReplayCycleSnapshot {
  cycle: number
  phase: string
  diffHash: string | null
}

export interface CockpitFindingModel {
  finding: Finding
  location: { file: string; line: number } | null
  stale: boolean
  linked: boolean
  hunkIndex: number | null
}

export interface CockpitModel {
  summary: CockpitData
  diffHunks: DiffHunk[]
  findings: CockpitFindingModel[]
  replayCycles: ReplayCycleSnapshot[]
  policy: { risk: CockpitData['risk']; satisfied: boolean | null; gates: CockpitData['gates'] }
  verification: CockpitData['verification']
}

export type CockpitActionIntent =
  | { kind: 'accept'; findingId: string }
  | { kind: 'dispute'; findingId: string }
  | { kind: 'waive'; findingId: string }

export type CockpitActionValidation =
  | { ok: true; intent: CockpitActionIntent }
  | { ok: false; reason: 'finding_not_found' | 'stale_finding' }

export interface BuildCockpitModelInput {
  data: CockpitData
  diffHash: string | null
  trackedDiff: string
  findings: readonly Finding[]
  replayCycles: readonly ReplayCycleSnapshot[]
}

export function buildCockpitModel(input: BuildCockpitModelInput): CockpitModel {
  const diffHunks = parseDiffHunks(input.trackedDiff)
  return {
    summary: input.data,
    diffHunks,
    findings: input.findings.map((finding) => linkFinding(finding, input.diffHash, diffHunks)),
    replayCycles: [...input.replayCycles],
    policy: {
      risk: input.data.risk,
      satisfied: input.data.policySatisfied,
      gates: input.data.gates,
    },
    verification: input.data.verification,
  }
}

export function validateCockpitAction(
  model: CockpitModel,
  intent: CockpitActionIntent,
): CockpitActionValidation {
  const finding = model.findings.find((item) => item.finding.id === intent.findingId)
  if (!finding) return { ok: false, reason: 'finding_not_found' }
  if (finding.stale) return { ok: false, reason: 'stale_finding' }
  return { ok: true, intent }
}

export function parseDiffHunks(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let file = ''
  let current: DiffHunk | null = null
  for (const line of diff.split(/\r?\n/)) {
    const fileMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
    if (fileMatch) {
      file = fileMatch[2] ?? fileMatch[1] ?? ''
      current = null
      continue
    }
    const hunkMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (hunkMatch) {
      const start = Number(hunkMatch[1])
      const count = Number(hunkMatch[2] ?? '1')
      current = {
        file,
        header: line,
        newStart: start,
        newEnd: Math.max(start, start + count - 1),
        lines: [],
      }
      hunks.push(current)
      continue
    }
    current?.lines.push(line)
  }
  return hunks
}

function linkFinding(
  finding: Finding,
  currentHash: string | null,
  hunks: readonly DiffHunk[],
): CockpitFindingModel {
  const location = parseFindingLocation(finding.summary)
  const stale = currentHash !== null && finding.target_hash !== currentHash
  const hunkIndex =
    location && !stale
      ? hunks.findIndex(
          (hunk) =>
            hunk.file === location.file &&
            location.line >= hunk.newStart &&
            location.line <= hunk.newEnd,
        )
      : -1
  return {
    finding,
    location,
    stale,
    linked: hunkIndex >= 0,
    hunkIndex: hunkIndex >= 0 ? hunkIndex : null,
  }
}

function parseFindingLocation(summary: string): { file: string; line: number } | null {
  const match = /^\[?([^:\]\s]+):(\d+)\]?/.exec(summary.trim())
  if (!match) return null
  return { file: match[1]!, line: Number(match[2]) }
}
