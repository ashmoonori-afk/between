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
})
