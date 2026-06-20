import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventsLog } from '../../src/adapters/events-log'
import { betweenPaths } from '../../src/adapters/paths'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-journal-'))
  await mkdir(join(dir, '.between'), { recursive: true })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

async function append(log: EventsLog, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await log.append({ ts: `t${i}`, cycle: 0, phase: 'idle', event: `e${i}` })
  }
}

describe('EventsLog hash chain (B5)', () => {
  it('a freshly written journal verifies, and resumes the chain across instances', async () => {
    const a = new EventsLog(dir)
    await append(a, 3)
    expect((await a.verify()).valid).toBe(true)

    // a NEW instance seeds the chain head from disk and keeps it valid
    const b = new EventsLog(dir)
    await append(b, 2)
    const v = await b.verify()
    expect(v.valid).toBe(true)
  })

  it('detects a tampered entry', async () => {
    const log = new EventsLog(dir)
    await append(log, 3)
    const path = betweenPaths(dir).events
    const lines = (await readFile(path, 'utf8')).trim().split('\n')
    const mid = JSON.parse(lines[1]!)
    mid.event = 'TAMPERED' // edit content, keep the old hash
    lines[1] = JSON.stringify(mid)
    await writeFile(path, lines.join('\n') + '\n')

    const r = await new EventsLog(dir).verify()
    expect(r.valid).toBe(false)
    expect(r.brokenAt).toBe(1)
  })

  it('detects a dropped (middle) entry', async () => {
    const log = new EventsLog(dir)
    await append(log, 3)
    const path = betweenPaths(dir).events
    const lines = (await readFile(path, 'utf8')).trim().split('\n')
    await writeFile(path, [lines[0], lines[2]].join('\n') + '\n') // drop the middle

    expect((await new EventsLog(dir).verify()).valid).toBe(false)
  })

  it('a failed write does NOT advance the chain head (append fail-safe, finding #2)', async () => {
    // a subclass that fails the next physical write exactly once
    class FlakyLog extends EventsLog {
      failNext = false
      protected override async writeLine(line: string): Promise<void> {
        if (this.failNext) {
          this.failNext = false
          throw new Error('disk full')
        }
        return super.writeLine(line)
      }
    }
    const log = new FlakyLog(dir)
    await log.append({ ts: 't0', cycle: 0, phase: 'idle', event: 'e0' }) // ok
    log.failNext = true
    await expect(log.append({ ts: 't1', cycle: 0, phase: 'idle', event: 'e1' })).rejects.toThrow(
      /disk full/,
    )
    // the failed append must not have advanced lastHash -> the next entry chains off e0, not e1
    await log.append({ ts: 't2', cycle: 0, phase: 'idle', event: 'e2' })

    const fresh = new EventsLog(dir)
    expect((await fresh.read()).length).toBe(2) // only e0 + e2 hit disk
    expect((await fresh.verify()).valid).toBe(true) // chain intact: no dangling prev_hash
  })

  it('head() is null before the first append (nothing to pin yet)', () => {
    expect(new EventsLog(dir).head()).toBeNull()
  })

  it('head() exposes the pinnable chain head; verifyAll catches tail-truncation', async () => {
    const log = new EventsLog(dir)
    await append(log, 4)
    const pin = log.head() // what the daemon would pin into state.json
    expect(pin).toEqual({ hash: expect.stringMatching(/^[a-f0-9]{64}$/), count: 4 })

    // chain alone still verifies (no pin) and even after dropping the tail
    expect((await log.verifyAll(null)).valid).toBe(true)

    const path = betweenPaths(dir).events
    const lines = (await readFile(path, 'utf8')).trim().split('\n')
    await writeFile(path, lines.slice(0, 2).join('\n') + '\n') // drop the newest 2 (tail)

    const fresh = new EventsLog(dir)
    expect((await fresh.verify()).valid).toBe(true) // verifyChain is fooled by a shorter chain
    const all = await fresh.verifyAll(pin) // the pin is NOT fooled
    expect(all.chain.valid).toBe(true)
    expect(all.head.ok).toBe(false)
    expect(all.valid).toBe(false)
    expect(all.head.reason).toMatch(/truncation/)
  })
})
