import type { Command } from 'commander'
import { SystemClock } from '../core/clock'
import { StateRepository } from '../adapters/state-repository'
import { EventsLog } from '../adapters/events-log'
import { CommandBus } from '../adapters/command-bus'
import { AckStore } from '../adapters/ack-store'
import { buildSignal } from '../adapters/signal-transport'
import type { Ack, ApprovalScope } from '../core/types'
import { signApproval, approvalExpiry } from '../core/approval'
import { APPROVAL_SCOPES } from '../core/constants'
import { resolveApprovalSecret, APPROVAL_SECRET_ENV } from '../adapters/approval-secret'
import { loadConfig } from '../runtime'
import { print, printErr, printJson } from './output'
import { parseInterval } from './args'
import { fail, root } from './shared'
import { runStartCommand } from './start-command'
import { runVerifyPushCommand } from './verify-push-command'

function enqueue(label: string, makeCmd: () => Parameters<CommandBus['submit']>[0]) {
  return async () => {
    try {
      await loadConfig(root())
      await new CommandBus(root()).submit(makeCmd())
      print(`between: ${label} requested`)
    } catch (e) {
      await fail(e)
    }
  }
}

export function registerBrokerCommands(program: Command): void {
  program
    .command('status')
    .description('Print the current phase, cycle, waiting actor, diff hash, and latest event')
    .option('--json', 'output machine-readable JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        const state = await new StateRepository(root()).read()
        if (!state) {
          printErr('between: no state found - run `between init`')
          process.exitCode = 1
          return
        }
        const events = await new EventsLog(root()).read()
        const last = events.at(-1) ?? null
        const cfg = await loadConfig(root()).catch(() => null)
        if (opts.json) {
          printJson({
            workflow: state.workflow,
            diff: state.diff,
            broker: state.broker,
            last_event: last,
          })
          return
        }
        const wf = state.workflow
        print(`Between - ${state.project.name}`)
        if (state.evidence_trust === 'simulated') print('  [SIMULATION] fake agent — push blocked')
        print(`  phase:      ${wf.phase}`)
        print(
          `  cycle:      ${wf.cycle} (this goal: ${wf.cycles_this_goal}/${cfg?.max_cycles_per_goal ?? '?'})`,
        )
        print(`  waiting on: ${wf.waiting_on ?? '-'}`)
        print(
          `  diff:       ${state.diff.hash ? state.diff.hash.slice(0, 12) : '-'} - ${state.diff.changed_files} files +${state.diff.insertions} -${state.diff.deletions}`,
        )
        print(`  developer:  ${state.developer.name} (${state.developer.status})`)
        print(`  reviewer:   ${state.reviewer.name} (${state.reviewer.status})`)
        if (wf.error) print(`  error:      ${wf.error.code} - ${wf.error.message}`)
        print(`  last event: ${last ? `${last.event} @ ${last.ts}` : '-'}`)
      } catch (e) {
        await fail(e)
      }
    })

  program
    .command('start')
    .description('Start the broker watcher loop (headless, or --embed for the live agent window)')
    .option('--embed', 'open the broker-owned window embedding live developer/reviewer agent panes')
    .option('--headless', 'run the loop without the Ink UI (no TTY needed)')
    .option('--max-ticks <n>', 'run a bounded number of poll iterations then exit', (v) =>
      Number(v),
    )
    .action(async (opts: { embed?: boolean; headless?: boolean; maxTicks?: number }) => {
      try {
        await runStartCommand(root(), opts)
      } catch (e) {
        await fail(e)
      }
    })

  program
    .command('pause')
    .description('Pause the loop')
    .action(enqueue('pause', () => ({ kind: 'pause' })))
  program
    .command('resume')
    .description('Resume the loop')
    .action(enqueue('resume', () => ({ kind: 'resume' })))
  program
    .command('interrupt')
    .alias('abort')
    .description('Abort active hosted agents and pause for steering')
    .action(enqueue('interrupt', () => ({ kind: 'interrupt' })))
  program
    .command('review-now')
    .description('Force a review of the current diff (unless already reviewed)')
    .action(enqueue('review-now', () => ({ kind: 'review_now' })))
  program
    .command('stop')
    .description('Ask the running broker to stop')
    .action(enqueue('stop', () => ({ kind: 'stop' })))

  program
    .command('goal <text...>')
    .description('Lock a new goal for the developer')
    .action(async (text: string[]) => {
      try {
        await loadConfig(root())
        await new CommandBus(root()).submit({ kind: 'goal', goal: text.join(' ') })
        print('between: goal locked')
      } catch (e) {
        await fail(e)
      }
    })

  program
    .command('steer <text...>')
    .description('Steer active hosted agents and clear stale approval')
    .action(async (text: string[]) => {
      try {
        await loadConfig(root())
        await new CommandBus(root()).submit({ kind: 'steer_goal', goal: text.join(' ') })
        print('between: goal steered')
      } catch (e) {
        await fail(e)
      }
    })

  program
    .command('approve <scope>')
    .description('Approve a human-gated action: merge | deploy | promote_rule')
    .action(async (scope: string) => {
      try {
        if (!APPROVAL_SCOPES.includes(scope as ApprovalScope)) {
          throw new Error(`scope must be one of: ${APPROVAL_SCOPES.join(', ')}`)
        }
        await loadConfig(root())
        const state = await new StateRepository(root()).read()
        const secret = resolveApprovalSecret(root())
        // F1: the approver stamps + signs the bundle binding + expiry too.
        const bundleId = state?.diff.bundle_id ?? null
        const expiresAt = approvalExpiry(Date.now())
        const claim = {
          scope,
          diff_hash: state?.diff.hash ?? null,
          cycle: state?.workflow.cycle ?? 0,
          bundle_id: bundleId,
          expires_at: expiresAt,
        }
        const sig = secret ? signApproval(secret, claim) : undefined
        await new CommandBus(root()).submit({
          kind: 'approve',
          scope: scope as ApprovalScope,
          sig,
          bundle_id: bundleId,
          expires_at: expiresAt,
        })
        print(
          secret
            ? `between: ${scope} approval submitted (signed)`
            : `between: ${scope} approval submitted (UNSIGNED - set ${APPROVAL_SECRET_ENV} to enable the approval boundary)`,
        )
      } catch (e) {
        await fail(e)
      }
    })

  program
    .command('ack')
    .description(
      '(reviewer helper) acknowledge the outstanding review signal for the current cycle',
    )
    .action(async () => {
      try {
        const state = await new StateRepository(root()).read()
        if (!state || !state.diff.hash) throw new Error('no outstanding review to acknowledge')
        const id = buildSignal('reviewer', state.workflow.cycle, state.diff.hash, '', '').id
        const ack: Ack = {
          signal_id: id,
          target: 'reviewer',
          cycle: state.workflow.cycle,
          diff_hash: state.diff.hash,
          acked_at: new SystemClock().nowIso(),
        }
        await new AckStore(root()).write(ack)
        print(`between: acked ${id}`)
      } catch (e) {
        await fail(e)
      }
    })

  program
    .command('summarize')
    .description('Summarize cycle/phase analytics from events.jsonl')
    .action(async () => {
      try {
        const events = await new EventsLog(root()).read()
        const counts = new Map<string, number>()
        for (const e of events) counts.set(e.event, (counts.get(e.event) ?? 0) + 1)
        print(`Between - ${events.length} events`)
        for (const [event, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
          print(`  ${event}: ${n}`)
        }
        print('(full cycle analytics + Obsidian summary land in M7)')
      } catch (e) {
        await fail(e)
      }
    })

  program
    .command('verify-push')
    .description('Approval gate used by the pre-push hook: blocks a forged/unapproved push (P1-5)')
    .action(async () => {
      try {
        await runVerifyPushCommand(root())
      } catch (e) {
        await fail(e)
      }
    })

  program
    .command('dash')
    .description('Live broker dashboard (cmux/Kiro-inspired TUI)')
    .option('--once', 'render a single frame and exit (non-interactive)')
    .option('--interval <ms>', 'refresh interval in milliseconds (integer >= 250)', parseInterval)
    .action(async (opts: { once?: boolean; interval?: number }) => {
      try {
        const { runDashboard } = await import('../ui/dash')
        await runDashboard(root(), { once: opts.once, intervalMs: opts.interval })
      } catch (e) {
        await fail(e)
      }
    })
}
