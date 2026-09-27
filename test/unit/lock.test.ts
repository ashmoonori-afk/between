import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '../../src/core/clock'
import { BrokerLock } from '../../src/adapters/lock'
import { betweenPaths } from '../../src/adapters/paths'

let dir = ''

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = ''
})

async function workspace(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'between-lock-'))
  await mkdir(join(dir, '.between'), { recursive: true })
  return dir
}

describe('BrokerLock', () => {
  it('refuses a second broker while the first holds the lock', async () => {
    await workspace()
    const first = new BrokerLock(dir)
    await first.acquire(new FakeClock(0))
    try {
      await expect(new BrokerLock(dir).acquire(new FakeClock(0))).rejects.toThrow(/already running/)
    } finally {
      await first.releaseLock()
    }
    const again = new BrokerLock(dir)
    await again.acquire(new FakeClock(0))
    await again.releaseLock()
  })

  it('releases the lock when writing owner metadata fails', async () => {
    await workspace()
    // a directory where the owner file should go makes the owner write fail (EISDIR)
    await mkdir(betweenPaths(dir).owner)
    const lock = new BrokerLock(dir)
    await expect(lock.acquire(new FakeClock(0))).rejects.toThrow()
    await rm(betweenPaths(dir).owner, { recursive: true })

    // before the fix this failed with "Another Between broker is already running"
    const next = new BrokerLock(dir)
    await next.acquire(new FakeClock(0))
    await next.releaseLock()
  })
})
