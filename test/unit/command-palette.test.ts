import { describe, it, expect } from 'vitest'
import {
  buildDashboardCommandItems,
  commandItemForKey,
  selectEnabledCommand,
} from '../../src/ui/command-palette'
import { initialState, setPhase } from '../../src/core/state'
import { FakeClock } from '../../src/core/clock'

const clock = new FakeClock(Date.UTC(2026, 5, 20, 10, 0, 0))
const base = initialState(
  { project: { name: 'palette-demo', root: '/repo', obsidian_project_path: null } },
  clock,
)

describe('dashboard command palette', () => {
  it('builds phase-aware broker commands', () => {
    const paused = setPhase(base, 'paused', 'developing')
    const items = buildDashboardCommandItems(paused)

    expect(items.map((item) => `${item.key}:${item.label}`)).toEqual([
      'r:review now',
      'p:resume',
      's:stop broker',
    ])
    expect(items[1]?.command).toEqual({ kind: 'resume' })
  })

  it('disables review-now without a current diff and skips it during selection', () => {
    const developing = setPhase(base, 'developing', 'goal_locked')
    const items = buildDashboardCommandItems(developing)

    expect(items[0]?.enabled).toBe(false)
    expect(commandItemForKey(items, 'r')).toBeNull()
    expect(selectEnabledCommand(items, 0, 1)).toBe(1)
  })

  it('enables direct review-now selection when a diff is present', () => {
    const developing = {
      ...setPhase(base, 'developing', 'goal_locked'),
      diff: { ...base.diff, hash: 'abc123', changed_files: 1, insertions: 2, deletions: 0 },
    }
    const items = buildDashboardCommandItems(developing)

    expect(items[0]?.enabled).toBe(true)
    expect(commandItemForKey(items, 'r')?.command).toEqual({ kind: 'review_now' })
  })
})
