import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Dashboard } from '../../src/ui/Dashboard'
import { initialState, setPhase, recordReviewedHash } from '../../src/core/state'
import { FakeClock } from '../../src/core/clock'
import type { BetweenEvent } from '../../src/core/types'

const clock = new FakeClock(Date.UTC(2026, 5, 19, 14, 8, 22))
const base = initialState(
  { project: { name: 'feat-auth', root: '/repo', obsidian_project_path: null } },
  clock,
)

describe('Dashboard', () => {
  it('renders the broker-dominant layout with brand + phase', () => {
    const { lastFrame } = render(
      <Dashboard state={setPhase(base, 'developing', 'goal_locked')} events={[]} now="14:08:22" />,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain('BETWEEN')
    expect(frame).toContain('session:feat-auth')
    expect(frame).toContain('DEVELOPING')
    expect(frame).toContain('DEVELOPER')
    expect(frame).toContain('REVIEWER')
  })

  it('expands the approval bar at a human gate', () => {
    const human = recordReviewedHash(setPhase(base, 'human_gate', 'verifying'), 'abc123def456')
    const events: BetweenEvent[] = [
      { v: 1, ts: '2026-06-19T14:08:10.000Z', cycle: 1, phase: 'reviewing', event: 'review_acked' },
      {
        v: 1,
        ts: '2026-06-19T14:08:20.000Z',
        cycle: 1,
        phase: 'human_gate',
        event: 'verify_passed',
      },
    ]
    const frame =
      render(<Dashboard state={human} events={events} now="14:08:22" />).lastFrame() ?? ''
    expect(frame).toContain('AWAITING APPROVAL')
    expect(frame).toContain('Approval needed')
    expect(frame).toContain('between approve merge')
    expect(frame).toContain('verify_passed')
  })

  it('summarizes broker, diff, and review state with ASCII-safe labels', () => {
    const reviewing = recordReviewedHash(
      setPhase(base, 'reviewing', 'review_requested'),
      'abc123def4567890',
    )
    const state = {
      ...reviewing,
      workflow: { ...reviewing.workflow, cycle: 7, cycles_this_goal: 3 },
      diff: {
        ...reviewing.diff,
        hash: 'def789abc1234560',
        changed_files: 2,
        insertions: 15,
        deletions: 3,
        snapshot_path: '.between/diff-snapshots/def789abc1234560.diff',
        bundle_id: 'bundle-1234567890',
        bundle_path: '.between/review-bundles/bundle-1234567890.md',
      },
      broker: {
        ...reviewing.broker,
        last_signal: 'reviewer:7:def789abc1234560',
        last_signal_at: '2026-06-19T14:08:18.000Z',
      },
    }
    const events: BetweenEvent[] = [
      {
        v: 1,
        ts: '2026-06-19T14:08:12.000Z',
        cycle: 7,
        phase: 'diff_detected',
        event: 'diff_stable',
        diff_hash: 'def789abc1234560',
      },
      {
        v: 1,
        ts: '2026-06-19T14:08:18.000Z',
        cycle: 7,
        phase: 'review_requested',
        event: 'signal_sent',
        target: 'reviewer',
        diff_hash: 'def789abc1234560',
      },
    ]

    const frame =
      render(<Dashboard state={state} events={events} now="14:08:22" />).lastFrame() ?? ''

    expect(frame).toContain('BROKER')
    expect(frame).toContain('WAIT reviewer')
    expect(frame).toContain('CYCLE 7')
    expect(frame).toContain('DIFF 2 files +15 -3')
    expect(frame).toContain('REVIEW abc123def456')
    expect(frame).toContain('BUNDLE bundle-123456')
    expect(frame).toContain('SIGNAL reviewer:7:def789')
    expect(frame).not.toContain(String.fromCharCode(0xc9cc))
    expect(frame).not.toContain(String.fromCharCode(0xfffd))
  })
})
