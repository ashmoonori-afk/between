import { describe, it, expect } from 'vitest'
import { renderCockpit, renderCockpitModel, type CockpitData } from '../../src/ui/cockpit-frame'
import { buildCockpitModel, filterCockpitModel, focusReplayCycle } from '../../src/ui/cockpit-model'

const data: CockpitData = {
  project: 'demo',
  phase: 'human_gate',
  cycle: 3,
  evidenceTrust: 'real',
  changedFiles: 5,
  insertions: 120,
  deletions: 30,
  bundleId: 'a1b2c3d4e5f6',
  blockingFindings: 1,
  nonBlockingFindings: 2,
  risk: 'high',
  gates: [
    { name: 'verification', status: 'pass' },
    { name: 'secret_scan', status: 'fail' },
  ],
  policySatisfied: false,
  verdict: 'blocked',
  verification: { passed: 2, total: 3, allPassed: false },
  journalValid: true,
  journalEntries: 42,
}

describe('renderCockpit (B6)', () => {
  it('renders the key cockpit sections', () => {
    const frame = renderCockpit(data)
    expect(frame).toMatch(/Between cockpit/)
    expect(frame).toMatch(/phase:\s+human_gate\s+\(cycle 3\)/)
    expect(frame).toMatch(/diff:\s+5 files\s+\+120 -30\s+bundle a1b2c3d4/)
    expect(frame).toMatch(/findings:\s+1 blocking\s+2 non-blocking/)
    expect(frame).toMatch(/risk:\s+high\s+policy BLOCKED/)
    expect(frame).toMatch(/\[fail\] secret_scan/)
    expect(frame).toMatch(/verify:\s+2\/3 checks FAIL/)
    expect(frame).toMatch(/verdict:\s+blocked/)
    expect(frame).toMatch(/journal:\s+VERIFIED \(42 entries\)/)
  })

  it('is ASCII-only (Windows-safe, no mojibake)', () => {
    expect(renderCockpit(data)).toMatch(/^[\x00-\x7F]*$/)
  })

  it('degrades gracefully with no bundle / no verification', () => {
    const frame = renderCockpit({
      ...data,
      bundleId: null,
      risk: null,
      gates: [],
      policySatisfied: null,
      verification: null,
    })
    expect(frame).toMatch(/bundle -/)
    expect(frame).toMatch(/risk:\s+-\s+policy -/)
    expect(frame).toMatch(/verify:\s+not run/)
  })

  it('renders linked findings, replay snapshots, and action hints', () => {
    const frame = renderCockpitModel(
      buildCockpitModel({
        data,
        diffHash: 'h1',
        trackedDiff: 'diff --git a/app.ts b/app.ts\n@@ -1,1 +1,2 @@\n const a = 1\n+const b = 2\n',
        findings: [
          {
            id: 'F1',
            severity: 'blocking',
            summary: '[app.ts:2] add a regression test - 한글',
            target_hash: 'h1',
          },
        ],
        replayCycles: [{ cycle: 2, phase: 'reviewing', diffHash: 'h0' }],
      }),
    )

    expect(frame).toMatch(/Linked findings/)
    expect(frame).toMatch(/F1 \[blocking\] linked app\.ts:2/)
    expect(frame).toMatch(/cycle 2: reviewing h0/)
    expect(frame).toMatch(/between cockpit --action accept\|dispute\|waive/)
    expect(frame).toMatch(/between cockpit --rerun-checks/)
    expect(frame).toMatch(/^[\x00-\x7F]*$/)
  })

  it('marks the selected replay cycle', () => {
    const selected = focusReplayCycle(
      buildCockpitModel({
        data,
        diffHash: 'h1',
        trackedDiff: '',
        findings: [],
        replayCycles: [
          { cycle: 3, phase: 'review_requested', diffHash: 'h0' },
          {
            cycle: 3,
            phase: 'human_gate',
            diffHash: 'h1',
            changedFiles: 2,
            insertions: 10,
            deletions: 1,
            bundleId: 'b'.repeat(64),
          },
        ],
      }),
      3,
    )

    expect(selected.ok).toBe(true)
    if (!selected.ok) return
    const frame = renderCockpitModel(selected.model)

    expect(frame).toMatch(/focus: cycle 3 human_gate h1/)
    expect(frame).toMatch(/diff: 2 files \+10 -1 bundle bbbbbbbb/)
    expect(frame).toMatch(/  cycle 3: review_requested h0/)
    expect(frame).toMatch(/\* cycle 3: human_gate h1/)
    expect(frame).toMatch(/^[\x00-\x7F]*$/)
  })

  it('renders active finding filters and a filtered-empty state', () => {
    const frame = renderCockpitModel(
      filterCockpitModel(
        buildCockpitModel({
          data,
          diffHash: 'h1',
          trackedDiff:
            'diff --git a/app.ts b/app.ts\n@@ -1,1 +1,2 @@\n const a = 1\n+const b = 2\n',
          findings: [
            {
              id: 'F1',
              severity: 'blocking',
              summary: '[app.ts:2] add a regression test',
              target_hash: 'h1',
            },
          ],
          replayCycles: [],
        }),
        { file: 'missing.ts', severity: 'non-blocking' },
      ),
    )

    expect(frame).toMatch(/filters: file=missing\.ts severity=non-blocking/)
    expect(frame).toMatch(/none \(filtered\)/)
    expect(frame).toMatch(/^[\x00-\x7F]*$/)
  })
})
