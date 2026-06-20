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
  changedFiles?: number
  insertions?: number
  deletions?: number
  bundleId?: string | null
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
  diffHash: string | null
  diffHunks: DiffHunk[]
  findings: CockpitFindingModel[]
  replayCycles: ReplayCycleSnapshot[]
  selectedReplayCycle: ReplayCycleSnapshot | null
  policy: { risk: CockpitData['risk']; satisfied: boolean | null; gates: CockpitData['gates'] }
  verification: CockpitData['verification']
}

export type CockpitActionIntent =
  | { kind: 'accept'; findingId: string }
  | { kind: 'dispute'; findingId: string }
  | { kind: 'waive'; findingId: string }

export type CockpitActionValidationReason =
  | 'finding_not_found'
  | 'stale_finding'
  | 'missing_diff_hash'

export type CockpitActionValidation =
  | { ok: true; intent: CockpitActionIntent }
  | { ok: false; reason: CockpitActionValidationReason }

export type CockpitReplayNavigation =
  | { ok: true; model: CockpitModel }
  | { ok: false; reason: 'replay_cycle_not_found' }

export interface CockpitFindingActionCommand {
  kind: 'finding_action'
  action: CockpitActionIntent['kind']
  finding_id: string
  cycle: number
  diff_hash: string
  reason?: string
}

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
    diffHash: input.diffHash,
    diffHunks,
    findings: input.findings.map((finding) => linkFinding(finding, input.diffHash, diffHunks)),
    replayCycles: [...input.replayCycles],
    selectedReplayCycle: null,
    policy: {
      risk: input.data.risk,
      satisfied: input.data.policySatisfied,
      gates: input.data.gates,
    },
    verification: input.data.verification,
  }
}

export function focusReplayCycle(model: CockpitModel, cycle: number): CockpitReplayNavigation {
  const selected = model.replayCycles.findLast((item) => item.cycle === cycle)
  if (!selected) return { ok: false, reason: 'replay_cycle_not_found' }
  return { ok: true, model: { ...model, selectedReplayCycle: selected } }
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

export function buildCockpitActionCommand(
  model: CockpitModel,
  intent: CockpitActionIntent,
  reason?: string,
):
  | { ok: true; command: CockpitFindingActionCommand }
  | { ok: false; reason: CockpitActionValidationReason } {
  const validation = validateCockpitAction(model, intent)
  if (!validation.ok) return validation
  if (!model.diffHash) return { ok: false, reason: 'missing_diff_hash' }
  return {
    ok: true,
    command: {
      kind: 'finding_action',
      action: intent.kind,
      finding_id: intent.findingId,
      cycle: model.summary.cycle,
      diff_hash: model.diffHash,
      ...(reason ? { reason } : {}),
    },
  }
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
