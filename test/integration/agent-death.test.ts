import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '../../src/core/clock'
import { initProject } from '../../src/adapters/init-project'
import { buildDaemon } from '../../src/runtime'
import { CommandBus } from '../../src/adapters/command-bus'
import { EventsLog } from '../../src/adapters/events-log'

let dir: string

async function git(args: string[]): Promise<void> {
  await execa('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-agent-death-'))
  await git(['init', '-b', 'main'])
  await git(['config', 'user.email', 't@example.com'])
  await git(['config', 'user.name', 'Tester'])
  await writeFile(join(dir, 'app.txt'), 'v1\n')
  await git(['add', '-A'])
  await git(['commit', '-m', 'init'])
})

afterEach(async () => {
  try {
    await rm(dir, { recursive: true, force: true })
  } catch {}
})

describe('hosted agent death propagation', () => {
  it('moves daemon state to a recoverable error and marks the role dead', async () => {
    const fc = new FakeClock(Date.UTC(2026, 5, 19, 0, 0, 0))
    await initProject(dir, {}, fc)
    const daemon = await buildDaemon(dir, fc)
    await daemon.load()
    await new CommandBus(dir).submit({ kind: 'goal', goal: 'g' })
    await daemon.tick()

    await daemon.reportAgentDied('developer', 17)

    expect(daemon.state.workflow.phase).toBe('error')
    expect(daemon.state.workflow.previous_phase).toBe('developing')
    expect(daemon.state.workflow.error).toMatchObject({
      code: 'agent_died',
      message: 'developer agent exited with code 17',
      recoverable: true,
    })
    expect(daemon.state.developer.status).toBe('dead')
    expect(daemon.state.reviewer.status).not.toBe('dead')
    expect(daemon.state.broker.status).toBe('error')

    const events = await new EventsLog(dir).read()
    const deathEvent = events.find((event) => event.event === 'agent_died')
    expect(deathEvent?.detail).toMatchObject({ role: 'developer', exit_code: 17 })
  })
})
