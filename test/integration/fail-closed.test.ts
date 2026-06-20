import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '../../src/core/clock'
import { initProject } from '../../src/adapters/init-project'
import { buildDaemon } from '../../src/runtime'
import { CommandBus } from '../../src/adapters/command-bus'
import { GitAdapter, GitError } from '../../src/adapters/git'

let dir: string
const OPTS = { reviewUntracked: false, untrackedGlobs: [] as string[] }

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-failclosed-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

describe('A4 — fail-closed git', () => {
  it('GitAdapter.diffInput throws GitError outside a git repo (never an empty diff)', async () => {
    await expect(new GitAdapter(dir).diffInput(OPTS)).rejects.toBeInstanceOf(GitError)
  })

  it('the daemon routes a mid-loop git failure to `error`, not "no change"', async () => {
    const fc = new FakeClock(Date.UTC(2026, 5, 19, 0, 0, 0))
    await execa('git', ['init', '-b', 'main'], { cwd: dir })
    await execa('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
    await execa('git', ['config', 'user.name', 't'], { cwd: dir })
    await writeFile(join(dir, 'app.txt'), 'v1\n')
    await execa('git', ['add', '-A'], { cwd: dir })
    await execa('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'init'], { cwd: dir })

    await initProject(dir, {}, fc)
    const d = await buildDaemon(dir, fc)
    await d.load()
    await new CommandBus(dir).submit({ kind: 'goal', goal: 'g' })
    await d.tick()
    expect(d.state.workflow.phase).toBe('developing')

    // corrupt the repo: remove .git so `git diff` fails fatally on the next tick
    await rm(join(dir, '.git'), { recursive: true, force: true })
    await d.tick()

    expect(d.state.workflow.phase).toBe('error')
    expect(d.state.workflow.error?.code).toBe('git_error')
  })
})
