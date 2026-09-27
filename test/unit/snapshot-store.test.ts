import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SnapshotStore } from '../../src/adapters/snapshot-store'
import { betweenPaths } from '../../src/adapters/paths'

let dir = ''

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = ''
})

// random hex barely compresses, so the gzipped snapshot stays around 10 KB
const big = () => randomBytes(10_000).toString('hex')

describe('SnapshotStore retention', () => {
  it('keeps the snapshot it just wrote even when it alone exceeds the size cap (C5)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'between-snap-'))
    const store = new SnapshotStore(dir)
    const capMb = 0.001 // ~1 KB, smaller than any single snapshot below
    const first = await store.write(1, big(), 10, capMb)
    const second = await store.write(2, big(), 10, capMb)

    expect(existsSync(second)).toBe(true) // before the fix this was pruned right after writing
    expect(existsSync(first)).toBe(false) // older snapshots still obey the cap
  })

  it('keeps only the newest retentionCycles snapshots', async () => {
    dir = await mkdtemp(join(tmpdir(), 'between-snap-'))
    const store = new SnapshotStore(dir)
    for (const cycle of [1, 2, 3]) await store.write(cycle, 'small diff', 2, 100)
    const names = (await readdir(betweenPaths(dir).snapshots)).sort()
    expect(names).toEqual(['cycle-0002.diff.gz', 'cycle-0003.diff.gz'])
  })
})
