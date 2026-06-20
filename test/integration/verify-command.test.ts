import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { betweenPaths } from '../../src/adapters/paths'
import { runConfiguredVerification } from '../../src/cli/verify-command'

let dir = ''

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  dir = ''
})

describe('runConfiguredVerification', () => {
  it('runs configured checks and persists the structured report', async () => {
    dir = await mkdtemp(join(tmpdir(), 'between-verify-command-'))
    await mkdir(join(dir, '.between'), { recursive: true })
    await writeFile(
      betweenPaths(dir).config,
      [
        'schema_version: 1',
        'verification_checks:',
        '  - name: ok',
        '    command: node -e "process.exit(0)"',
        '',
      ].join('\n'),
      'utf8',
    )

    const report = await runConfiguredVerification(dir)
    const saved = JSON.parse(await readFile(betweenPaths(dir).verifyReport, 'utf8'))

    expect(report.allPassed).toBe(true)
    expect(report.checks.map((check) => check.name)).toEqual(['ok'])
    expect(saved).toMatchObject({ allPassed: true, checks: [{ name: 'ok', status: 'pass' }] })
  })
})
