import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readVerifyReport } from '../../src/verify/report'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'between-vr-'))
  await mkdir(join(root, '.between'), { recursive: true })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const write = (body: string) => writeFile(join(root, '.between', 'verify-report.json'), body)

describe('readVerifyReport (B3 -> B4 fold)', () => {
  it('returns null when the report is absent', async () => {
    expect(await readVerifyReport(root)).toBeNull()
  })

  it('reads and validates a well-formed report', async () => {
    await write(
      JSON.stringify({
        checks: [{ name: 'tests', status: 'pass', exitCode: 0, summary: 'ok', durationMs: 5 }],
        allPassed: true,
      }),
    )
    const r = await readVerifyReport(root)
    expect(r?.allPassed).toBe(true)
    expect(r?.checks[0]?.name).toBe('tests')
  })

  it('returns null for malformed JSON', async () => {
    await write('{not json')
    expect(await readVerifyReport(root)).toBeNull()
  })

  it('returns null for a valid-JSON body of the wrong shape (boundary validation)', async () => {
    await write(JSON.stringify({ checks: 'nope', allPassed: 'yes' }))
    expect(await readVerifyReport(root)).toBeNull()
  })

  it('rejects an unknown status enum value', async () => {
    await write(
      JSON.stringify({
        checks: [{ name: 'x', status: 'skipped', exitCode: 0, summary: '', durationMs: 1 }],
        allPassed: false,
      }),
    )
    expect(await readVerifyReport(root)).toBeNull()
  })
})
