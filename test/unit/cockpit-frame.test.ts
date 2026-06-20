import { describe, it, expect } from 'vitest'
import { renderCockpit, type CockpitData } from '../../src/ui/cockpit-frame'

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
})
