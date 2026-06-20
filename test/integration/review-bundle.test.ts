import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { GitAdapter } from '../../src/adapters/git'
import { hashDiff } from '../../src/core/diff-hash'
import { captureBundle, writeBundle, readBundle } from '../../src/review/store'

let dir: string
const OPTS = { reviewUntracked: false, untrackedGlobs: [] as string[] }

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-bundle-'))
  await execa('git', ['init', '-q'], { cwd: dir })
  await execa('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
  await execa('git', ['config', 'user.name', 't'], { cwd: dir })
  await writeFile(join(dir, 'a.txt'), 'one\n')
  await execa('git', ['add', '-A'], { cwd: dir })
  await execa('git', ['commit', '-qm', 'init'], { cwd: dir })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('review bundle capture + store (A1)', () => {
  it('captured bundle.diff_hash == the canonical diff hash (approved == stored == reviewed)', async () => {
    await writeFile(join(dir, 'a.txt'), 'one\ntwo\n') // make a change
    const git = new GitAdapter(dir)

    const liveDiff = await git.diffInput(OPTS)
    const bundle = await captureBundle(git, OPTS, '0.1.0')

    // the bundle's hash must equal the hash of the live diff content it captured
    expect(bundle.diff_hash).toBe(hashDiff(liveDiff))
    expect(bundle.diff.tracked).toBe(liveDiff.tracked)
    expect(bundle.repository.head_sha).toMatch(/^[a-f0-9]{40}$/)
    expect(bundle.repository.branch).toBeTruthy()
    expect(bundle.environment.git_version).toMatch(/git/i)
  })

  it('persists immutably and round-trips by content address', async () => {
    await writeFile(join(dir, 'a.txt'), 'one\ntwo\n')
    const git = new GitAdapter(dir)
    const bundle = await captureBundle(git, OPTS, '0.1.0')

    const path = await writeBundle(dir, bundle)
    expect(path).toContain(bundle.bundle_id)

    const loaded = await readBundle(dir, bundle.bundle_id)
    expect(loaded?.bundle_id).toBe(bundle.bundle_id)
    expect(loaded?.diff_hash).toBe(bundle.diff_hash)
    expect(loaded?.diff.tracked).toBe(bundle.diff.tracked)
  })

  it('a reviewer reading the stored bundle sees the same hash that was approved', async () => {
    await writeFile(join(dir, 'a.txt'), 'one\ntwo\n')
    const git = new GitAdapter(dir)
    const bundle = await captureBundle(git, OPTS, '0.1.0')
    await writeBundle(dir, bundle)

    // simulate the developer mutating the worktree AFTER the bundle was sealed
    await writeFile(join(dir, 'a.txt'), 'one\ntwo\nthree\nfour\n')

    // the reviewer reads the BUNDLE, not the live tree -> still the approved content/hash
    const fromBundle = await readBundle(dir, bundle.bundle_id)
    expect(hashDiff(fromBundle!.diff)).toBe(bundle.diff_hash)
    // and the live tree has genuinely diverged (proving the bundle is immutable)
    expect(hashDiff(await git.diffInput(OPTS))).not.toBe(bundle.diff_hash)
  })
})
