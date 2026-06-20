import { describe, it, expect } from 'vitest'
import {
  buildCockpitActionCommand,
  buildCockpitModel,
  filterCockpitModel,
  focusReplayCycle,
  validateCockpitAction,
} from '../../src/ui/cockpit-model'
import type { CockpitData } from '../../src/ui/cockpit-frame'
import type { Finding } from '../../src/core/types'

const data: CockpitData = {
  project: 'demo',
  phase: 'human_gate',
  cycle: 2,
  evidenceTrust: 'real',
  changedFiles: 1,
  insertions: 2,
  deletions: 0,
  bundleId: 'b'.repeat(64),
  blockingFindings: 1,
  nonBlockingFindings: 1,
  risk: 'high',
  gates: [{ name: 'verification', status: 'pass' }],
  policySatisfied: false,
  verdict: 'blocked',
  verification: { passed: 2, total: 2, allPassed: true },
  journalValid: true,
  journalEntries: 3,
}

const diff = `diff --git a/app.ts b/app.ts
index 111..222 100644
--- a/app.ts
+++ b/app.ts
@@ -1,2 +1,4 @@
 const a = 1
+const b = 2
+const c = 3
`

describe('buildCockpitModel', () => {
  it('links current findings to exact diff hunks and replay cycle snapshots', () => {
    const findings: Finding[] = [
      { id: 'F1', severity: 'blocking', summary: '[app.ts:2] b needs a test', target_hash: 'h1' },
      { id: 'F2', severity: 'non-blocking', summary: '[app.ts:3] c naming', target_hash: 'h1' },
    ]

    const model = buildCockpitModel({
      data,
      diffHash: 'h1',
      trackedDiff: diff,
      findings,
      replayCycles: [{ cycle: 1, phase: 'review_requested', diffHash: 'h0' }],
    })

    expect(model.diffHunks).toHaveLength(1)
    expect(model.findings.map((finding) => finding.linked)).toEqual([true, true])
    expect(model.findings.map((finding) => finding.hunkIndex)).toEqual([0, 0])
    expect(model.replayCycles).toEqual([{ cycle: 1, phase: 'review_requested', diffHash: 'h0' }])
  })

  it('flags stale target hashes and refuses actions against stale findings', () => {
    const stale: Finding = {
      id: 'F1',
      severity: 'blocking',
      summary: '[app.ts:2] stale',
      target_hash: 'old',
    }
    const model = buildCockpitModel({
      data,
      diffHash: 'current',
      trackedDiff: diff,
      findings: [stale],
      replayCycles: [],
    })

    expect(model.findings[0]?.stale).toBe(true)
    expect(model.findings[0]?.linked).toBe(false)
    expect(validateCockpitAction(model, { kind: 'waive', findingId: 'F1' })).toEqual({
      ok: false,
      reason: 'stale_finding',
    })
  })

  it('validates accept, dispute, and waive intents before UI side effects exist', () => {
    const finding: Finding = {
      id: 'F1',
      severity: 'blocking',
      summary: '[app.ts:2] current',
      target_hash: 'h1',
    }
    const model = buildCockpitModel({
      data,
      diffHash: 'h1',
      trackedDiff: diff,
      findings: [finding],
      replayCycles: [],
    })

    expect(validateCockpitAction(model, { kind: 'accept', findingId: 'F1' })).toEqual({
      ok: true,
      intent: { kind: 'accept', findingId: 'F1' },
    })
    expect(
      buildCockpitActionCommand(model, { kind: 'waive', findingId: 'F1' }, 'accepted risk'),
    ).toEqual({
      ok: true,
      command: {
        kind: 'finding_action',
        action: 'waive',
        finding_id: 'F1',
        cycle: 2,
        diff_hash: 'h1',
        reason: 'accepted risk',
      },
    })
    expect(validateCockpitAction(model, { kind: 'dispute', findingId: 'missing' })).toEqual({
      ok: false,
      reason: 'finding_not_found',
    })
  })

  it('does not build an action command without a current diff hash', () => {
    const finding: Finding = {
      id: 'F1',
      severity: 'blocking',
      summary: '[app.ts:2] current',
      target_hash: 'h1',
    }
    const model = buildCockpitModel({
      data,
      diffHash: null,
      trackedDiff: diff,
      findings: [finding],
      replayCycles: [],
    })

    expect(buildCockpitActionCommand(model, { kind: 'accept', findingId: 'F1' })).toEqual({
      ok: false,
      reason: 'missing_diff_hash',
    })
  })

  it('selects a replay cycle for cockpit navigation', () => {
    const model = buildCockpitModel({
      data,
      diffHash: 'h1',
      trackedDiff: diff,
      findings: [],
      replayCycles: [
        { cycle: 1, phase: 'review_requested', diffHash: 'h0' },
        { cycle: 2, phase: 'human_gate', diffHash: 'h1' },
      ],
    })

    expect(focusReplayCycle(model, 2)).toEqual({
      ok: true,
      model: {
        ...model,
        selectedReplayCycle: { cycle: 2, phase: 'human_gate', diffHash: 'h1' },
      },
    })
    expect(focusReplayCycle(model, 99)).toEqual({
      ok: false,
      reason: 'replay_cycle_not_found',
    })
  })

  it('filters findings by file and severity without changing the source model', () => {
    const model = buildCockpitModel({
      data,
      diffHash: 'h1',
      trackedDiff: diff,
      findings: [
        { id: 'F1', severity: 'blocking', summary: '[app.ts:2] b needs a test', target_hash: 'h1' },
        {
          id: 'F2',
          severity: 'non-blocking',
          summary: '[other.ts:9] naming',
          target_hash: 'h1',
        },
      ],
      replayCycles: [],
    })

    const filtered = filterCockpitModel(model, { file: 'app.ts', severity: 'blocking' })

    expect(filtered.findings.map((finding) => finding.finding.id)).toEqual(['F1'])
    expect(filtered.filters).toEqual({ file: 'app.ts', severity: 'blocking' })
    expect(model.findings.map((finding) => finding.finding.id)).toEqual(['F1', 'F2'])
  })

  it('filters findings by agent, defaulting legacy findings to reviewer', () => {
    const model = buildCockpitModel({
      data,
      diffHash: 'h1',
      trackedDiff: diff,
      findings: [
        { id: 'F1', severity: 'blocking', summary: '[app.ts:2] legacy', target_hash: 'h1' },
        {
          id: 'F2',
          severity: 'non-blocking',
          summary: '[app.ts:3] security note',
          target_hash: 'h1',
          agent: 'security',
        },
      ],
      replayCycles: [],
    })

    expect(filterCockpitModel(model, { agent: 'reviewer' }).findings.map((f) => f.agent)).toEqual([
      'reviewer',
    ])
    expect(filterCockpitModel(model, { agent: 'security' }).findings.map((f) => f.agent)).toEqual([
      'security',
    ])
  })
})
