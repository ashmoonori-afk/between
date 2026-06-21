import { describe, expect, it } from 'vitest'
import { renderDashboardFrame, DASHBOARD_FRAME_WIDTH } from '../../src/ui/dashboard-frame'
import { initialState, recordReviewedHash, setPhase } from '../../src/core/state'
import { FakeClock } from '../../src/core/clock'
import type { BetweenEvent } from '../../src/core/types'

const clock = new FakeClock(Date.UTC(2026, 5, 19, 14, 8, 22))
const base = initialState(
  { project: { name: 'feat-auth', root: '/repo', obsidian_project_path: null } },
  clock,
)

describe('renderDashboardFrame', () => {
  it('renders a width-stable ASCII-only snapshot for dash --once', () => {
    const humanGate = recordReviewedHash(setPhase(base, 'human_gate', 'verifying'), 'abc123def456')
    const state = {
      ...humanGate,
      workflow: { ...humanGate.workflow, cycle: 3, cycles_this_goal: 2 },
      diff: {
        ...humanGate.diff,
        hash: 'def789abc1234560',
        changed_files: 2,
        insertions: 15,
        deletions: 3,
        snapshot_path: '.between/diff-snapshots/def789abc1234560.diff',
        bundle_id: 'bundle-1234567890',
        bundle_path: '.between/review-bundles/bundle-1234567890.md',
      },
      broker: { ...humanGate.broker, last_signal: 'reviewer:3:def789abc1234560' },
    }
    const events: BetweenEvent[] = [
      {
        v: 1,
        ts: '2026-06-19T14:08:20.000Z',
        cycle: 3,
        phase: 'human_gate',
        event: 'verify_passed',
      },
    ]

    const frame = renderDashboardFrame(state, events, '14:08:22')
    const lines = frame.trimEnd().split('\n')

    expect(frame).toContain('B BETWEEN')
    expect(frame).toContain('AWAITING APPROVAL')
    expect(frame).toContain('APPROVAL needed')
    expect(frame).toContain('COMMANDS r review now (off) | esc abort agents | p pause')
    expect(frame).not.toMatch(/[^\x0A\x20-\x7E]/)
    expect(Math.max(...lines.map((line) => line.length))).toBe(DASHBOARD_FRAME_WIDTH)
    expect(new Set(lines.map((line) => line.length))).toEqual(new Set([DASHBOARD_FRAME_WIDTH]))
  })
})
