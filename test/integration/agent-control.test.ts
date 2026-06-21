import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '../../src/core/clock'
import { initProject } from '../../src/adapters/init-project'
import { buildDaemon } from '../../src/runtime'
import { CommandBus } from '../../src/adapters/command-bus'
import { StateRepository } from '../../src/adapters/state-repository'
import { EventsLog } from '../../src/adapters/events-log'
import { approvalExpiry } from '../../src/core/approval'

let dir: string

async function git(args: string[]): Promise<void> {
  await execa('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-agent-control-'))
  await git(['init', '-b', 'main'])
  await git(['config', 'user.email', 't@example.com'])
  await git(['config', 'user.name', 'Tester'])
  await writeFile(join(dir, 'app.txt'), 'v1\n')
  await git(['add', '-A'])
  await git(['commit', '-m', 'init'])
})

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe('agent control commands', () => {
  it('aborts active hosted agents when interrupt is submitted', async () => {
    const fc = new FakeClock(Date.UTC(2026, 5, 21, 0, 0, 0))
    await initProject(dir, { developer: 'claude', reviewer: 'codex' }, fc)
    const aborts: string[] = []
    const agentControl = {
      async abortActive(reason: string) {
        aborts.push(reason)
      },
      async steerActive() {},
    }
    const daemon = await buildDaemon(dir, fc, undefined, agentControl)
    await daemon.load()
    const bus = new CommandBus(dir)

    await bus.submit({ kind: 'goal', goal: 'build the UX' })
    await daemon.tick()
    expect(daemon.state.workflow.phase).toBe('developing')

    await bus.submit({ kind: 'interrupt' })
    await daemon.tick()

    expect(aborts).toEqual(['user_requested'])
    expect(daemon.state.workflow.phase).toBe('paused')
    expect(daemon.state.workflow.previous_phase).toBe('developing')
    const pauseEvent = (await new EventsLog(dir).read()).find((e) => e.event === 'pause')
    expect(pauseEvent?.detail?.reason).toBe('user_requested')
  })

  it('steers active hosted agents with redacted goal text', async () => {
    const fc = new FakeClock(Date.UTC(2026, 5, 21, 0, 0, 0))
    await initProject(dir, { developer: 'claude', reviewer: 'codex' }, fc)
    const steers: string[] = []
    const agentControl = {
      async abortActive() {},
      async steerActive(goal: string) {
        steers.push(goal)
      },
    }
    const daemon = await buildDaemon(dir, fc, undefined, agentControl)
    await daemon.load()
    const bus = new CommandBus(dir)

    await bus.submit({ kind: 'goal', goal: 'first goal' })
    await daemon.tick()
    expect(daemon.state.workflow.phase).toBe('developing')

    await new StateRepository(dir).write({
      ...daemon.state,
      approval: {
        actor: 'human',
        scope: 'merge',
        diff_hash: 'old',
        cycle: 99,
        granted_at: fc.nowIso(),
        sig: 'stale',
        bundle_id: 'old-bundle',
        expires_at: approvalExpiry(fc.now()),
      },
      debounce: {
        candidate_hash: 'old-hash',
        candidate_first_seen_at: fc.nowIso(),
        debounce_restarts: 3,
      },
    })

    const steered = await buildDaemon(dir, fc, undefined, agentControl)
    await steered.load()
    await bus.submit({ kind: 'steer_goal', goal: 'ship safer chat UX SECRET_KEY=123456' })
    await steered.tick()

    expect(steers).toEqual(['ship safer chat UX SECRET_KEY=[REDACTED]'])
    expect(steered.state.workflow.phase).toBe('developing')
    expect(steered.state.approval).toBeNull()
    expect(steered.state.debounce.candidate_hash).toBeNull()
    const detail = (await new EventsLog(dir).read()).find((e) => e.event === 'goal_steered')?.detail
    expect(detail?.goal).toBe('ship safer chat UX SECRET_KEY=[REDACTED]')
  })
})
