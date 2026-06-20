import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { mkdir, mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitAdapter } from '../../src/adapters/git'
import { WorktreeProvider } from '../../src/adapters/worktree'
import { captureBundle } from '../../src/review/store'
import { materializeBundle, REVIEWER_WORKTREE } from '../../src/review/materialize'

let dir: string
const OPTS = { reviewUntracked: false, untrackedGlobs: [] as string[] }

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-mat-'))
  await execa('git', ['init', '-b', 'main'], { cwd: dir })
  await execa('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
  await execa('git', ['config', 'user.name', 't'], { cwd: dir })
  await writeFile(join(dir, 'a.txt'), 'one\n')
  await execa('git', ['add', '-A'], { cwd: dir })
  await execa('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'init'], { cwd: dir })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

describe('materializeBundle (B1)', () => {
  it('reproduces the EXACT sealed diff in an isolated reviewer worktree', async () => {
    // seal a bundle for an uncommitted change
    await writeFile(join(dir, 'a.txt'), 'one\ntwo\n')
    const git = new GitAdapter(dir)
    const bundle = await captureBundle(git, OPTS, '0.1.0')

    // now mutate the MAIN tree further — the reviewer worktree must NOT see this
    await writeFile(join(dir, 'a.txt'), 'one\ntwo\nthree\nDRIFT\n')

    const wp = new WorktreeProvider(dir)
    const path = await materializeBundle(bundle, wp)
    try {
      // base (one\n) + bundle patch (adds two\n) == the sealed state, not the drifted main tree
      expect(await readFile(join(path, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
    } finally {
      await wp.remove(REVIEWER_WORKTREE)
    }
  })

  it('handles an empty diff (no patch to apply) by checking out the base', async () => {
    const git = new GitAdapter(dir)
    // commit a second change so HEAD has content, then capture with a clean tree (no diff)
    const bundle = await captureBundle(git, OPTS, '0.1.0')
    const wp = new WorktreeProvider(dir)
    const path = await materializeBundle(bundle, wp)
    try {
      expect(await readFile(join(path, 'a.txt'), 'utf8')).toBe('one\n')
    } finally {
      await wp.remove(REVIEWER_WORKTREE)
    }
  })

  it('materializes configured untracked and binary payloads', async () => {
    await writeFile(join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 3]))
    await execa('git', ['add', '-A'], { cwd: dir })
    await execa('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'add binary'], {
      cwd: dir,
    })

    const sealedBinary = Buffer.from([0, 1, 2, 3, 255])
    const sealedUntracked = Buffer.from([9, 8, 7, 6])
    await writeFile(join(dir, 'bin.dat'), sealedBinary)
    await mkdir(join(dir, 'notes'), { recursive: true })
    await writeFile(join(dir, 'notes', 'payload.bin'), sealedUntracked)

    const git = new GitAdapter(dir)
    const bundle = await captureBundle(
      git,
      { reviewUntracked: true, untrackedGlobs: ['notes/*'], payloadMaxBytes: 1024 },
      '0.1.0',
    )

    await writeFile(join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 3, 4, 5]))
    await rm(join(dir, 'notes', 'payload.bin'))

    const wp = new WorktreeProvider(dir)
    const path = await materializeBundle(bundle, wp)
    try {
      expect(await readFile(join(path, 'bin.dat'))).toEqual(sealedBinary)
      expect(await readFile(join(path, 'notes', 'payload.bin'))).toEqual(sealedUntracked)
    } finally {
      await wp.remove(REVIEWER_WORKTREE)
    }
  })

  it('excludes env-like untracked files even when globbed', async () => {
    await writeFile(join(dir, '.env'), 'SECRET=do-not-review\n')
    await writeFile(join(dir, 'visible.txt'), 'review me\n')

    const git = new GitAdapter(dir)
    const bundle = await captureBundle(
      git,
      { reviewUntracked: true, untrackedGlobs: ['*'], payloadMaxBytes: 1024 },
      '0.1.0',
    )

    expect(bundle.diff.untracked.map((f) => f.path)).toEqual(['visible.txt'])
    expect(bundle.payloads.map((f) => f.path)).toEqual(['visible.txt'])
  })

  it('refuses secret-like untracked payload content', async () => {
    await mkdir(join(dir, 'notes'), { recursive: true })
    await writeFile(join(dir, 'notes', 'secret.txt'), 'API_KEY=abcdef1234567890\n')

    const git = new GitAdapter(dir)
    await expect(
      captureBundle(
        git,
        { reviewUntracked: true, untrackedGlobs: ['notes/*'], payloadMaxBytes: 1024 },
        '0.1.0',
      ),
    ).rejects.toThrow(/secret-like/)
  })
})
