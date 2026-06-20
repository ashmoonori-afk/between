import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorktreeProvider } from '../../src/adapters/worktree'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-wt-'))
  await execa('git', ['init', '-b', 'main'], { cwd: dir })
  await execa('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
  await execa('git', ['config', 'user.name', 't'], { cwd: dir })
  await writeFile(join(dir, 'a.txt'), 'committed\n')
  await execa('git', ['add', '-A'], { cwd: dir })
  await execa('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'init'], { cwd: dir })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

describe('WorktreeProvider (B1)', () => {
  it('creates an isolated checkout at a ref, then removes it', async () => {
    const wp = new WorktreeProvider(dir)
    const path = await wp.create('reviewer', 'HEAD')

    expect(existsSync(path)).toBe(true)
    // the committed content is checked out in the isolated worktree
    expect(await readFile(join(path, 'a.txt'), 'utf8')).toBe('committed\n')
    expect(await wp.list()).toContain(path.replace(/\\/g, '/'))

    await wp.remove('reviewer')
    expect(existsSync(path)).toBe(false)
    expect(await wp.list()).not.toContain(path.replace(/\\/g, '/'))
  })

  it('the reviewer worktree is isolated from edits to the main working tree', async () => {
    const wp = new WorktreeProvider(dir)
    const path = await wp.create('reviewer', 'HEAD')
    // mutate the MAIN working tree after the worktree was created
    await writeFile(join(dir, 'a.txt'), 'changed in main\n')
    // the isolated reviewer worktree still holds the committed content
    expect(await readFile(join(path, 'a.txt'), 'utf8')).toBe('committed\n')
    await wp.remove('reviewer')
  })

  it('create is idempotent (replaces an existing worktree of the same name)', async () => {
    const wp = new WorktreeProvider(dir)
    await wp.create('verifier', 'HEAD')
    const path = await wp.create('verifier', 'HEAD') // no throw on re-create
    expect(existsSync(path)).toBe(true)
    await wp.remove('verifier')
  })
})
