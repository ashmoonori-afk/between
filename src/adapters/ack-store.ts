import { writeFile, readFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Ack } from '../core/types'
import { betweenPaths, ackPath, type BetweenPaths } from './paths'

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
    await writeFile(file, JSON.stringify(ack, null, 2), 'utf8')
  }

  async read(signalId: string): Promise<Ack | null> {
    try {
      return JSON.parse(await readFile(ackPath(this.p, signalId), 'utf8')) as Ack
    } catch {
      return null
    }
  }
}
