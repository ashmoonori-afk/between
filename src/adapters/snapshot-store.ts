import { gzipSync } from 'node:zlib'
import { writeFile, readdir, stat, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { betweenPaths, snapshotPath, type BetweenPaths } from './paths'

/**
 * Bounded, gzipped snapshot store (I18). Diff snapshots are the audit/analytics record,
 * but unbounded growth fills disk (and a full disk breaks atomic state writes, I2).
 * Retention is enforced by BOTH a cycle-count window and a total-size cap on every write.
 *
 * The caller must pass ALREADY-REDACTED content (I17) — this store never sees raw secrets
 * it failed to scrub, because scrubbing happens upstream before the snapshot is created.
 */
export class SnapshotStore {
  private readonly p: BetweenPaths

  constructor(root: string) {
    this.p = betweenPaths(root)
  }

  /** Write a gzipped snapshot for `cycle` and prune to the retention budget. */
  async write(
    cycle: number,
    redactedContent: string,
    retentionCycles: number,
    maxTotalMb: number,
  ): Promise<string> {
    await mkdir(this.p.snapshots, { recursive: true })
    const file = snapshotPath(this.p, cycle)
    await writeFile(file, gzipSync(Buffer.from(redactedContent, 'utf8')))
    await this.prune(retentionCycles, maxTotalMb)
    return file
  }

  /** Keep the newest `retentionCycles` snapshots and stay within the size cap. */
  async prune(retentionCycles: number, maxTotalMb: number): Promise<void> {
    let entries: string[]
    try {
      entries = (await readdir(this.p.snapshots)).filter((f) => f.endsWith('.diff.gz'))
    } catch {
      return
    }
    // newest first by cycle number embedded in the name
    const sorted = entries.sort((a, b) => cycleOf(b) - cycleOf(a))

    const keep = new Set(sorted.slice(0, retentionCycles))
    const maxBytes = maxTotalMb * 1024 * 1024
    let total = 0
    for (const name of sorted) {
      if (!keep.has(name)) continue
      try {
        const s = await stat(join(this.p.snapshots, name))
        if (total + s.size > maxBytes) {
          keep.delete(name) // size cap wins over count window
        } else {
          total += s.size
        }
      } catch {
        // can't stat (transient/locked) — KEEP the file rather than deleting a maybe-valid
        // snapshot (HIGH-5). Leaving it in `keep` excludes it from the deletion pass below.
      }
    }
    for (const name of sorted) {
      if (keep.has(name)) continue
      await rm(join(this.p.snapshots, name), { force: true })
    }
  }
}

function cycleOf(filename: string): number {
  const m = /cycle-(\d+)\.diff\.gz$/.exec(filename)
  return m && m[1] ? Number(m[1]) : 0
}
