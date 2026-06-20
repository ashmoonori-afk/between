import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '../../src/core/clock'
import { initialState, pinJournal } from '../../src/core/state'
import { replaySnapshot } from '../../src/core/replay'
import { initProject } from '../../src/adapters/init-project'
import { StateRepository } from '../../src/adapters/state-repository'
import { EventsLog } from '../../src/adapters/events-log'

let dir: string
const repoRoot = process.cwd()
const now = '2026-06-20T00:00:00.000Z'

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-replay-cli-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

describe('between replay', () => {
  it('verifies the journal and writes reconstructed state JSON', async () => {
    await seedReplayableState()
    const outPath = join(dir, 'replayed-state.json')

    const cli = await execa(
      'node',
      [
        join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
        join(repoRoot, 'src', 'cli.ts'),
        'replay',
        '--verify',
        '--out',
        outPath,
      ],
      { cwd: dir, reject: false },
    )

    expect(cli.exitCode).toBe(0)
    expect(cli.stdout).toContain('between: replay reconstructed state')
    const replayed = JSON.parse(await readFile(outPath, 'utf8')) as {
      workflow: { phase: string }
    }
    expect(replayed.workflow.phase).toBe('human_gate')
  })
})

async function seedReplayableState(): Promise<void> {
  const clock = new FakeClock(Date.parse(now))
  await initProject(dir, {}, clock)
  const log = new EventsLog(dir)
  const base = initialState(
    { project: { name: 'demo', root: dir, obsidian_project_path: null }, evidenceTrust: 'real' },
    clock,
  )
  const state = {
    ...base,
    workflow: { ...base.workflow, phase: 'human_gate' as const, cycle: 1, cycles_this_goal: 1 },
  }
  await log.append({
    ts: now,
    cycle: 1,
    phase: 'human_gate',
    event: 'fixture_state',
    replay_state: replaySnapshot(state),
  })
  await new StateRepository(dir).write(pinJournal(state, log.head()))
}
