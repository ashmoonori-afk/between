import type { Command } from 'commander'
import { SystemClock } from '../core/clock'
import { print, printErr } from './output'
import { fail, root } from './shared'
import type { CockpitActionIntent, CockpitModel } from '../ui/cockpit-model'

export function registerCockpitCommand(program: Command): void {
  program
    .command('cockpit')
    .description(
      'Render a single code-centric cockpit frame (state+evidence+policy+verify+journal, B6)',
    )
    .option('--once', 'render one frame and exit (default; interactive mode is future)')
    .option('--action <action>', 'submit finding action: accept | dispute | waive')
    .option('--finding <id>', 'finding id for --action')
    .option('--reason <text>', 'optional action reason')
    .option('--replay-cycle <cycle>', 'focus replay history on a specific cycle number')
    .option('--rerun-checks', 'run configured verification checks before rendering the cockpit')
    .action(
      async (opts: {
        action?: string
        finding?: string
        reason?: string
        replayCycle?: string
        rerunChecks?: boolean
      }) => {
        try {
          const rootDir = root()
          const action = opts.action
          const replayCycle = opts.replayCycle ? parseReplayCycle(opts.replayCycle) : null
          if (opts.replayCycle && replayCycle === null) {
            printErr('between: --replay-cycle must be a non-negative integer')
            process.exitCode = 1
            return
          }
          if (action && opts.replayCycle) {
            printErr('between: --replay-cycle is display-only and cannot be combined with --action')
            process.exitCode = 1
            return
          }
          if (action && opts.rerunChecks) {
            printErr('between: --rerun-checks cannot be combined with --action')
            process.exitCode = 1
            return
          }
          const rerunReport = opts.rerunChecks ? await rerunConfiguredVerification(rootDir) : null
          const { collectCockpitModel } = await import('../ui/cockpit')
          const { renderCockpitModel } = await import('../ui/cockpit-frame')
          let model = await collectCockpitModel(rootDir, new SystemClock().nowIso())
          if (!model) {
            printErr('between: no state found - run `between init`')
            process.exitCode = 1
            return
          }
          if (replayCycle !== null) {
            const { focusReplayCycle } = await import('../ui/cockpit-model')
            const result = focusReplayCycle(model, replayCycle)
            if (!result.ok) {
              printErr(`between: replay cycle ${replayCycle} was not found in the journal`)
              process.exitCode = 1
              return
            }
            model = result.model
          }
          if (action) {
            await submitFindingAction(action, opts.finding, opts.reason, model)
            return
          }
          if (rerunReport) {
            print(`between: verification re-run ${rerunReport.allPassed ? 'PASS' : 'FAIL'}`)
          }
          print(renderCockpitModel(model))
          if (rerunReport && !rerunReport.allPassed) process.exitCode = 1
        } catch (e) {
          await fail(e)
        }
      },
    )
}

function parseReplayCycle(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const cycle = Number(value)
  return Number.isSafeInteger(cycle) ? cycle : null
}

async function rerunConfiguredVerification(rootDir: string) {
  const { runConfiguredVerification } = await import('./verify-command')
  return runConfiguredVerification(rootDir)
}

async function submitFindingAction(
  action: string,
  findingId: string | undefined,
  reason: string | undefined,
  model: CockpitModel,
): Promise<void> {
  if (action !== 'accept' && action !== 'dispute' && action !== 'waive') {
    printErr('between: --action must be accept, dispute, or waive')
    process.exitCode = 1
    return
  }
  if (!findingId) {
    printErr('between: --finding is required with --action')
    process.exitCode = 1
    return
  }
  const { buildCockpitActionCommand } = await import('../ui/cockpit-model')
  const { CommandBus } = await import('../adapters/command-bus')
  const intent: CockpitActionIntent = { kind: action, findingId }
  const result = buildCockpitActionCommand(model, intent, reason)
  if (!result.ok) {
    printErr(`between: cannot queue finding action - ${result.reason}`)
    process.exitCode = 1
    return
  }
  await new CommandBus(root()).submit(result.command)
  print(`between: queued ${action} for finding ${findingId}`)
}
