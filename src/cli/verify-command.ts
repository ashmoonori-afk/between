import type { Command } from 'commander'
import { join } from 'node:path'
import { loadConfig } from '../runtime'
import { print } from './output'
import { fail, root } from './shared'

export function registerVerifyCommand(program: Command): void {
  program
    .command('verify')
    .description('Run the configured verification checks and emit a structured report (B3)')
    .option('--json', 'emit JSON instead of a summary')
    .action(async (opts: { json?: boolean }) => {
      try {
        const config = await loadConfig(root())
        const { runChecks, shellRunner } = await import('../verify/runner')
        const report = await runChecks(config.verification_checks, shellRunner(root()))

        // persist (atomically) so the evidence collector / dashboard can fold it in (next slice)
        const { mkdir } = await import('node:fs/promises')
        const writeFileAtomic = (await import('write-file-atomic')).default
        const dir = join(root(), '.between')
        await mkdir(dir, { recursive: true })
        await writeFileAtomic(
          join(dir, 'verify-report.json'),
          `${JSON.stringify(report, null, 2)}\n`,
        )

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
