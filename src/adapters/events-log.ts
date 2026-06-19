import { open, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { BetweenEvent } from '../core/types'
import { EVENT_SCHEMA_VERSION } from '../core/types'
import { betweenPaths } from './paths'

/**
 * Append-only event log (I2, I23). Writes go through a single in-process promise queue
 * so concurrent appends can never interleave a partial line. Each line is a complete
 * `\n`-terminated JSON object, fsync'd. The reader repairs (skips) a trailing partial
 * line rather than treating it as fatal.
 */
export class EventsLog {
  private readonly path: string
  private queue: Promise<void> = Promise.resolve()

  constructor(root: string) {
    this.path = betweenPaths(root).events
  }

  append(event: Omit<BetweenEvent, 'v'>): Promise<void> {
    const line = JSON.stringify({ v: EVENT_SCHEMA_VERSION, ...event }) + '\n'
    // Serialize writes onto the queue. The RETURNED promise rejects to the caller if this
    // write fails (never silently swallowed); the queue is advanced with a swallowed copy
    // so one failed write doesn't poison every future append (CRITICAL-5 fix).
    const write = this.queue.then(() => this.writeLine(line))
    this.queue = write.catch(() => {})
    return write
  }

  private async writeLine(line: string): Promise<void> {
    const fh = await open(this.path, 'a')
    try {
      await fh.write(line)
      await fh.sync()
    } finally {
      await fh.close()
    }
  }

  /** Read all well-formed events, repairing a trailing partial/garbage line. */
  async read(): Promise<BetweenEvent[]> {
    if (!existsSync(this.path)) return []
    const raw = await readFile(this.path, 'utf8')
    const out: BetweenEvent[] = []
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue
      try {
        out.push(JSON.parse(line) as BetweenEvent)
      } catch {
        // partial/corrupt line (e.g. crash mid-write) — skip, don't fail
      }
    }
    return out
  }
}
