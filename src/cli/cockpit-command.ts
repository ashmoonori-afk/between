import type { Command } from 'commander'
import { SystemClock } from '../core/clock'
import { print, printErr } from './output'
import { fail, root } from './shared'

export function registerCockpitCommand(program: Command): void {
  program
    .command('cockpit')
    .description(
      'Render a single code-centric cockpit frame (state+evidence+policy+verify+journal, B6)',
    )
    .option('--once', 'render one frame and exit (default; interactive mode is future)')
    .action(async () => {
      try {
        const { collectCockpitData } = await import('../ui/cockpit')
        const { renderCockpit } = await import('../ui/cockpit-frame')
        const data = await collectCockpitData(root(), new SystemClock().nowIso())
        if (!data) {
          printErr('between: no state found - run `between init`')
          process.exitCode = 1
          return
        }
        print(renderCockpit(data))
      } catch (e) {
        await fail(e)
      }
    })
}
