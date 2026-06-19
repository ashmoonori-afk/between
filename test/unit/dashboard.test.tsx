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
})
