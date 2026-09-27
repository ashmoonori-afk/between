import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { FakeClock } from '../../src/core/clock'
import { initProject } from '../../src/adapters/init-project'
import { installPrePushHookDetailed } from '../../src/adapters/git-hooks'

let base = ''

afterEach(async () => {
  if (base) await rm(base, { recursive: true, force: true })
  base = ''
})

async function git(cwd: string, ...args: string[]): Promise<string> {
  const r = await execa('git', ['-c', 'commit.gpgsign=false', ...args], { cwd })
  return r.stdout.trim()
}

/** A repo with one commit, a bare remote, and a linked worktree on branch `wt`. */
async function repoWithWorktree() {
  base = realpathSync.native(await mkdtemp(join(tmpdir(), 'between-hooks-')))
  const main = join(base, 'main')
  const remote = join(base, 'remote.git')
  const wt = join(base, 'wt')
  await git(base, 'init', '-q', '--bare', remote)
  await git(base, 'init', '-q', '-b', 'main', main)
  await git(main, 'config', 'user.email', 't@t.t')
  await git(main, 'config', 'user.name', 't')
  await writeFile(join(main, 'a.txt'), 'a\n')
  await git(main, 'add', '-A')
  await git(main, 'commit', '-q', '-m', 'init')
  await git(main, 'remote', 'add', 'origin', remote)
  await git(main, 'worktree', 'add', '-q', '-b', 'wt', wt)
  return { main, remote, wt }
}

describe('pre-push gate installation (C1)', () => {
  it('installs into the shared hooks dir from a linked worktree, and a real push runs it', async () => {
    const { main, wt } = await repoWithWorktree()
    // a real (non-simulated) project so the gate's approval rule applies
    await initProject(wt, { developer: 'claude', reviewer: 'codex' }, new FakeClock(0))
    expect(installPrePushHookDetailed(wt).kind).toBe('already_installed')
    expect(existsSync(join(main, '.git', 'hooks', 'pre-push'))).toBe(true)
    expect(existsSync(join(main, '.git', 'between-verify-push.mjs'))).toBe(true)

    // feature branches stay open; a push to protected main is refused by the installed hook
    const feature = await execa('git', ['push', '-q', 'origin', 'HEAD:refs/heads/feature/x'], {
      cwd: wt,
      reject: false,
    })
    expect(feature.exitCode).toBe(0)
    const toMain = await execa('git', ['push', '-q', 'origin', 'HEAD:refs/heads/main'], {
      cwd: wt,
      reject: false,
    })
    expect(toMain.exitCode).not.toBe(0)
    expect(toMain.stderr).toMatch(/needs a merge approval/)
  })

  it('honors core.hooksPath and keeps an existing third-party hook', async () => {
    const { main } = await repoWithWorktree()
    await git(main, 'config', 'core.hooksPath', '.githooks')
    const first = installPrePushHookDetailed(main)
    expect(first.kind).toBe('installed')
    expect(await readFile(join(main, '.githooks', 'pre-push'), 'utf8')).toContain(
      'between-verify-push',
    )

    await writeFile(join(main, '.githooks', 'pre-push'), '#!/bin/sh\necho mine\n')
    expect(installPrePushHookDetailed(main).kind).toBe('conflict')
    expect(await readFile(join(main, '.githooks', 'pre-push'), 'utf8')).toContain('echo mine')
  })

  it('reports not_git_repo for a directory that is not the top of a work tree', async () => {
    const { main } = await repoWithWorktree()
    expect(installPrePushHookDetailed(join(base)).kind).toBe('not_git_repo')
    const sub = join(main, 'sub')
    await mkdir(sub, { recursive: true })
    expect(installPrePushHookDetailed(sub).kind).toBe('not_git_repo')
  })
})
