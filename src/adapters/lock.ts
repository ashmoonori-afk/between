import lockfile from 'proper-lockfile'
import { writeFile, readFile } from 'node:fs/promises'
import { existsSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import type { Clock } from '../core/types'
import { betweenPaths, type BetweenPaths } from './paths'

export interface OwnerInfo {
  pid: number
  host: string
  acquired_at: string
}

/**
 * Single-writer lock (I3). The `between start` daemon is the only process allowed to
 * mutate state; a second daemon is refused, naming the owning pid. Stale locks from a
 * dead pid are reclaimed automatically.
 */
export class BrokerLock {
  private readonly p: BetweenPaths
  private release: (() => Promise<void>) | null = null

  constructor(root: string) {
    this.p = betweenPaths(root)
  }

  async acquire(clock: Clock): Promise<void> {
    // proper-lockfile needs the target to exist; the sentinel lives inside .between/
    if (!existsSync(this.p.lock)) writeFileSync(this.p.lock, '')
    try {
      this.release = await lockfile.lock(this.p.lock, {
        stale: 30_000,
        retries: 0,
        realpath: false,
      })
    } catch {
      const owner = await this.readOwner()
      const who = owner ? ` (held by pid ${owner.pid} on ${owner.host})` : ''
      throw new Error(`Another Between broker is already running for this repo${who}.`)
    }
    const owner: OwnerInfo = { pid: process.pid, host: hostname(), acquired_at: clock.nowIso() }
    await writeFile(this.p.owner, JSON.stringify(owner, null, 2))
  }

  async readOwner(): Promise<OwnerInfo | null> {
    try {
      return JSON.parse(await readFile(this.p.owner, 'utf8')) as OwnerInfo
    } catch {
      return null
    }
  }

  async releaseLock(): Promise<void> {
    if (this.release) {
      await this.release()
      this.release = null
    }
  }
}
