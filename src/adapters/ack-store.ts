import { readFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { z } from 'zod'
import type { Ack } from '../core/types'
import { betweenPaths, ackPath, type BetweenPaths } from './paths'

/** Ack files are written by reviewer agents; validate their shape rather than trusting a cast (H2). */
const AckSchema = z.object({
  signal_id: z.string().min(1),
  target: z.enum(['reviewer', 'developer', 'human']),
  cycle: z.number().int().nonnegative(),
  diff_hash: z.string().min(1),
  acked_at: z.string().min(1),
})

/** Parse + validate an ack from untrusted JSON; returns null on any malformed/partial file. */
export function parseAck(raw: unknown): Ack | null {
  const r = AckSchema.safeParse(raw)
  return r.success ? r.data : null
}

/**
 * Ack receipts (I7). In the real loop the reviewer (or the `between ack` command) writes
 * an ack when it has received a signal; the broker reads it to gate `reviewing`.
 */
export class AckStore {
  private readonly p: BetweenPaths

  constructor(root: string) {
    this.p = betweenPaths(root)
  }

  async write(ack: Ack): Promise<void> {
    const file = ackPath(this.p, ack.signal_id)
    await mkdir(dirname(file), { recursive: true })
    // atomic so a crash mid-write can't leave a corrupt ack that reads as "no ack" (HIGH-8)
    await writeFileAtomic(file, JSON.stringify(ack, null, 2))
  }

  async read(signalId: string): Promise<Ack | null> {
    try {
      return parseAck(JSON.parse(await readFile(ackPath(this.p, signalId), 'utf8')))
    } catch {
      return null
    }
  }
}
