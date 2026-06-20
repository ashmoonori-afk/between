import { describe, it, expect } from 'vitest'
import { runChecks, type CheckSpec, type CommandRunner } from '../../src/verify/runner'

const specs: CheckSpec[] = [
  { name: 'typecheck', command: 'tsc' },
  { name: 'lint', command: 'prettier' },
  { name: 'tests', command: 'vitest' },
]

describe('runChecks (B3)', () => {
  it('produces a structured pass/fail result per check and an overall verdict', async () => {
    const fake: CommandRunner = async (command) =>
      command === 'prettier'
        ? { exitCode: 2, stdout: '', stderr: 'line1\n  prettier found problems' }
        : { exitCode: 0, stdout: 'ok\nall good', stderr: '' }
    let t = 1000
    const report = await runChecks(specs, fake, () => (t += 5))

    expect(report.allPassed).toBe(false)
    const lint = report.checks.find((c) => c.name === 'lint')!
    expect(lint.status).toBe('fail')
    expect(lint.exitCode).toBe(2)
    expect(lint.summary).toBe('prettier found problems') // last non-empty line of stderr
    expect(lint.durationMs).toBe(5)
    expect(report.checks.find((c) => c.name === 'tests')?.status).toBe('pass')
  })

  it('allPassed is true only when every check exits 0', async () => {
    const allOk: CommandRunner = async () => ({ exitCode: 0, stdout: 'fine', stderr: '' })
    const report = await runChecks(specs, allOk)
    expect(report.allPassed).toBe(true)
    expect(report.checks).toHaveLength(3)
    expect(report.checks.every((c) => c.status === 'pass')).toBe(true)
  })

  it('a spawn-level throw fails just THAT check; the rest still run (review #6)', async () => {
    const flaky: CommandRunner = async (command) => {
      if (command === 'prettier') throw new Error('spawn ENOENT')
      return { exitCode: 0, stdout: 'ok', stderr: '' }
    }
    const report = await runChecks(specs, flaky)
    expect(report.checks).toHaveLength(3) // none skipped
    const lint = report.checks.find((c) => c.name === 'lint')!
    expect(lint.status).toBe('fail')
    expect(lint.exitCode).toBe(-1)
    expect(lint.summary).toMatch(/ENOENT/)
    expect(report.checks.find((c) => c.name === 'tests')?.status).toBe('pass') // ran after the throw
  })

  it('empty check list is NOT a vacuous pass (review #4)', async () => {
    const report = await runChecks([], async () => ({ exitCode: 0, stdout: '', stderr: '' }))
    expect(report.allPassed).toBe(false)
  })
})
