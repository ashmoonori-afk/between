import type { Command } from 'commander'
import { print } from './output'
import { fail, root } from './shared'

export function registerVerifyCommand(program: Command): void {
  program
    .command('verify')
    .description('Run the configured verification checks and emit a structured report (B3)')
    .option('--json', 'emit JSON instead of a summary')
    .action(async (opts: { json?: boolean }) => {
      try {
        const { runConfiguredVerification } = await import('../api/checks')
        const report = await runConfiguredVerification(root())

        if (opts.json) {
          print(JSON.stringify(report, null, 2))
        } else {
          print('between: verification')
          for (const c of report.checks) {
            print(
              `  [${c.status}] ${c.name} (${c.durationMs}ms)${c.summary ? ` - ${c.summary}` : ''}`,
            )
          }
          print(`  result: ${report.allPassed ? 'PASS' : 'FAIL'}`)
        }
        if (!report.allPassed) process.exitCode = 1
      } catch (e) {
        await fail(e)
      }
    })
}
