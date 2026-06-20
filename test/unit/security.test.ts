import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CommandBus } from '../../src/adapters/command-bus'
import { parseAck } from '../../src/adapters/ack-store'
import { redactSecrets } from '../../src/core/redact'

let dir: string
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe('command-bus validation (C1/M5)', () => {
  it('drops commands that fail schema validation and keeps valid ones', async () => {
    dir = await mkdtemp(join(tmpdir(), 'between-sec-'))
    const cmds = join(dir, '.between', 'commands')
    await mkdir(cmds, { recursive: true })
    // valid
    await writeFile(
      join(cmds, '0000000000000001-x.json'),
      JSON.stringify({ kind: 'approve', scope: 'merge' }),
    )
    await writeFile(
      join(cmds, '0000000000000001-y.json'),
      JSON.stringify({
        kind: 'finding_action',
        action: 'accept',
        finding_id: 'F1',
        cycle: 1,
        diff_hash: 'd'.repeat(64),
      }),
    )
    // invalid scope (would bypass the human gate if trusted)
    await writeFile(
      join(cmds, '0000000000000002-x.json'),
      JSON.stringify({ kind: 'approve', scope: 'hack' }),
    )
    // unknown kind
    await writeFile(join(cmds, '0000000000000003-x.json'), JSON.stringify({ kind: 'rm-rf' }))
    // not even JSON
    await writeFile(join(cmds, '0000000000000004-x.json'), 'not json')

    const drained = await new CommandBus(dir).drain()
    expect(drained).toHaveLength(2)
    expect(drained[0]?.command).toEqual({ kind: 'approve', scope: 'merge' })
    expect(drained[1]?.command).toMatchObject({ kind: 'finding_action', action: 'accept' })
    // invalid files were removed
    const remaining = (await readdir(cmds)).filter((f) => f.endsWith('.json'))
    expect(remaining).toEqual(['0000000000000001-x.json', '0000000000000001-y.json'])
  })
})

describe('ack validation (H2)', () => {
  it('rejects a malformed ack', () => {
    expect(
      parseAck({ signal_id: 'x', target: 'reviewer', cycle: 1, diff_hash: 'h', acked_at: 't' }),
    ).not.toBeNull()
    expect(
      parseAck({ signal_id: 'x', target: 'attacker', cycle: 1, diff_hash: 'h', acked_at: 't' }),
    ).toBeNull()
    expect(parseAck({ signal_id: 'x' })).toBeNull()
    expect(parseAck('nope')).toBeNull()
  })
})

describe('redact additions (C2/M2/M3)', () => {
  it('redacts connection-string passwords and *_KEY assignments', () => {
    const r = redactSecrets('DATABASE_URL=postgres://user:supersecretpw@host/db')
    expect(r.text).not.toContain('supersecretpw')
    expect(redactSecrets('ENCRYPTION_KEY=abcdef123456').text).toContain('[REDACTED]')
    expect(redactSecrets('STRIPE=sk_live_' + 'a'.repeat(24)).text).not.toContain('a'.repeat(24))
  })

  it('redacts every occurrence of a repeated secret value', () => {
    // value equals the key fragment; ensure all occurrences are scrubbed (M3)
    const r = redactSecrets('TOKEN=tokentoken')
    expect(r.text).not.toContain('tokentoken')
  })

  it('leaves ordinary code untouched', () => {
    expect(redactSecrets('const sum = a + b // add two numbers').redactedCount).toBe(0)
  })
})
