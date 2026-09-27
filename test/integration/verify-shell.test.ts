import { describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { runChecks, shellRunner, summarize } from '../../src/verify/runner'

const ok = 'node -e "process.exit(0)"'
const nine = 'node -e "process.exit(9)"'

describe('verification commands run through the platform shell (C2)', () => {
  it('fails a check when a later command in an && chain fails', async () => {
    const run = shellRunner(tmpdir())
    expect((await run(`${ok} && ${nine}`)).exitCode).toBe(9)
    const report = await runChecks([{ name: 'chain', command: `${ok} && ${nine}` }], run)
    expect(report.allPassed).toBe(false)
    expect(report.checks[0]).toMatchObject({ status: 'fail', exitCode: 9 })
  })

  it('honors || and passes a clean chain', async () => {
    const run = shellRunner(tmpdir())
    expect((await run(`${nine} || ${ok}`)).exitCode).toBe(0)
    expect((await run(`${ok} && ${ok}`)).exitCode).toBe(0)
  })
})

describe('summarize (U6)', () => {
  it("skips npm's trailing log-file boilerplate and shows the cause", () => {
    const stderr = [
      'npm error Missing script: "typecheck"',
      'npm error',
      'npm error To see a list of scripts, run:',
      'npm error   npm run',
      'npm error A complete log of this run can be found in: /x/_logs/debug-0.log',
    ].join('\n')
    expect(summarize('', stderr)).toBe('npm error Missing script: "typecheck"')
    expect(summarize('', 'x\n Tests  1 failed | 3 passed\n')).toBe('Tests  1 failed | 3 passed')
    expect(summarize('', 'npm error A complete log of this run can be found in: /x')).toMatch(
      /A complete log/,
    )
  })
})
