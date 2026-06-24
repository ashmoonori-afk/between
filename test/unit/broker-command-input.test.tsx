import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'ink-testing-library'
import { BrokerCommandInput } from '../../src/ui/BrokerCommandInput'
import { initialState, setPhase } from '../../src/core/state'
import { FakeClock } from '../../src/core/clock'
import { CommandBus } from '../../src/adapters/command-bus'

describe('BrokerCommandInput', () => {
  let dir: string | null = null

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = null
  })

  it('renders the broker as the only human input surface', async () => {
    dir = await mkdtemp(join(tmpdir(), 'between-broker-input-'))
    await mkdir(join(dir, '.between'), { recursive: true })
    const clock = new FakeClock(Date.UTC(2026, 5, 22, 12, 0, 0))
    const state = setPhase(
      initialState(
        { project: { name: 'broker-input', root: dir, obsidian_project_path: null } },
        clock,
      ),
      'developing',
      'goal_locked',
    )

    const { lastFrame } = render(
      <BrokerCommandInput root={dir} state={state} width={80} onQuit={() => {}} />,
    )

    const frame = lastFrame() ?? ''
    expect(frame).toContain('BETWEEN BROKER')
    expect(frame).toContain('STEER > _')
  })

  it('submits typed broker text as a steer command while active', async () => {
    dir = await mkdtemp(join(tmpdir(), 'between-broker-input-'))
    await mkdir(join(dir, '.between'), { recursive: true })
    const clock = new FakeClock(Date.UTC(2026, 5, 22, 12, 0, 0))
    const state = setPhase(
      initialState(
        { project: { name: 'broker-input', root: dir, obsidian_project_path: null } },
        clock,
      ),
      'developing',
      'goal_locked',
    )
    const { stdin } = render(
      <BrokerCommandInput root={dir} state={state} width={80} onQuit={() => {}} />,
    )

    await new Promise((resolve) => setImmediate(resolve))
    stdin.write('keep broker only')
    stdin.write('\r')

    await expect
      .poll(async () => (await new CommandBus(dir ?? '').drain()).map((entry) => entry.command), {
        timeout: 1000,
      })
      .toEqual([{ kind: 'steer_goal', goal: 'keep broker only' }])
  })
})
