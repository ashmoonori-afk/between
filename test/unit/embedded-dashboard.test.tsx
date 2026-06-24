import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'ink-testing-library'
import { EmbeddedDashboard } from '../../src/ui/EmbeddedDashboard'
import { StateRepository } from '../../src/adapters/state-repository'
import { initialState, setPhase } from '../../src/core/state'
import { FakeClock } from '../../src/core/clock'

describe('EmbeddedDashboard', () => {
  let dir: string | null = null

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = null
  })

  it('renders responsive tmux-like fields and a visible prompt surface', async () => {
    dir = await mkdtemp(join(tmpdir(), 'between-embedded-dashboard-'))
    await mkdir(join(dir, '.between'), { recursive: true })
    const clock = new FakeClock(Date.UTC(2026, 5, 22, 9, 30, 0))
    const base = initialState(
      { project: { name: 'demo', root: dir, obsidian_project_path: null } },
      clock,
    )
    await new StateRepository(dir).write(setPhase(base, 'developing', 'goal_locked'))

    const { lastFrame } = render(
      <EmbeddedDashboard root={dir} hosts={null} intervalMs={60} paneRows={6} />,
    )
    await new Promise((resolve) => setTimeout(resolve, 120))

    const frame = lastFrame() ?? ''
    expect(frame).toContain('BETWEEN BROKER')
    expect(frame).toContain('DEVELOPER FIELD')
    expect(frame).toContain('REVIEWER FIELD')
    expect(frame).toContain('STEER > _')
    expect(frame).not.toContain('INPUT LIVE')
    for (const line of frame.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(100)
    }
  })
})
