import type { Command } from 'commander'
import { APPROVAL_SECRET_ENV } from '../adapters/approval-secret'
import { getStatus, summarizeEvents } from '../api/status'
import { ackReview, submitBrokerCommand, type BrokerControl } from '../api/broker'
import { approve, parseApprovalScope } from '../api/approval'
import { print, printErr, printJson } from './output'
import { parseInterval } from './args'
import { fail, root } from './shared'
import { runStartCommand } from './start-command'
import { runVerifyPushCommand } from './verify-push-command'

const NOT_RUNNING_NOTE =
  '  note: no broker is running, so this stays queued until you run `between start`'

function enqueue(label: string, command: BrokerControl) {
  return async () => {
    try {
      const res = await submitBrokerCommand(root(), command)
      print(`between: ${label} requested`)
      if (!res.broker_running) print(NOT_RUNNING_NOTE)
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
        const s = await getStatus(root())
        if (opts.json) {
          printJson({
            workflow: s.workflow,
            diff: s.diff,
            broker: s.broker,
            last_event: s.last_event,
            broker_running: s.broker_running,
            next_step: s.next_step,
          })
          return
        }
        const wf = s.workflow
        const last = s.last_event
        print(`Between - ${s.project.name}`)
        if (s.evidence_trust === 'simulated') print('  [SIMULATION] fake agent — push blocked')
        print(`  phase:      ${wf.phase}`)
        print(
          `  cycle:      ${wf.cycle} (this goal: ${wf.cycles_this_goal}/${s.max_cycles_per_goal ?? '?'})`,
        )
        print(`  waiting on: ${wf.waiting_on ?? '-'}`)
        print(
          `  diff:       ${s.diff.hash ? s.diff.hash.slice(0, 12) : '-'} - ${s.diff.changed_files} files +${s.diff.insertions} -${s.diff.deletions}`,
        )
        print(`  developer:  ${s.developer.name} (${s.developer.status})`)
        print(`  reviewer:   ${s.reviewer.name} (${s.reviewer.status})`)
        if (wf.error) print(`  error:      ${wf.error.code} - ${wf.error.message}`)
        print(`  last event: ${last ? `${last.event} @ ${last.ts}` : '-'}`)
        print(`  broker:     ${s.broker_running ? 'running' : 'not running'}`)
        if (s.next_step) print(`  next:       ${s.next_step}`)
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
    .action(enqueue('pause', { kind: 'pause' }))
  program
    .command('resume')
    .description('Resume the loop')
    .action(enqueue('resume', { kind: 'resume' }))
  program
    .command('interrupt')
    .alias('abort')
    .description('Abort active hosted agents and pause for steering')
    .action(enqueue('interrupt', { kind: 'interrupt' }))
  program
    .command('review-now')
    .description('Force a review of the current diff (unless already reviewed)')
    .action(enqueue('review-now', { kind: 'review_now' }))
  program
    .command('stop')
    .description('Ask the running broker to stop')
    .action(enqueue('stop', { kind: 'stop' }))

  program
    .command('goal <text...>')
    .description('Lock a new goal for the developer')
    .action(async (text: string[]) => {
      try {
        const res = await submitBrokerCommand(root(), { kind: 'goal', goal: text.join(' ') })
        print('between: goal locked')
        if (!res.broker_running) print(NOT_RUNNING_NOTE)
      } catch (e) {
        await fail(e)
      }
    })

  program
    .command('steer <text...>')
    .description('Steer active hosted agents and clear stale approval')
    .action(async (text: string[]) => {
      try {
        const res = await submitBrokerCommand(root(), { kind: 'steer_goal', goal: text.join(' ') })
        print('between: goal steered')
        if (!res.broker_running) print(NOT_RUNNING_NOTE)
      } catch (e) {
        await fail(e)
      }
    })

  program
    .command('approve <scope>')
    .description('Approve a human-gated action: merge | deploy | promote_rule')
    .action(async (scope: string) => {
      try {
        const res = await approve(root(), parseApprovalScope(scope))
        print(
          res.signed
            ? `between: ${res.scope} approval submitted (signed)`
            : `between: ${res.scope} approval submitted (UNSIGNED - set ${APPROVAL_SECRET_ENV} to enable the approval boundary)`,
        )
        const s = await getStatus(root()).catch(() => null)
        if (s?.simulated && res.scope === 'merge') {
          printErr(
            'between: warning - SIMULATION project (fake agent): the broker rejects merge approvals. Use real agents: between init --developer claude --reviewer codex',
          )
        }
        if (s && !s.broker_running) print(NOT_RUNNING_NOTE)
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
        const { signal_id } = await ackReview(root())
        print(`between: acked ${signal_id}`)
      } catch (e) {
        await fail(e)
      }
    })

  program
    .command('summarize')
    .description('Summarize cycle/phase analytics from events.jsonl')
    .action(async () => {
      try {
        const summary = await summarizeEvents(root())
        print(`Between - ${summary.total} events`)
        for (const { event, count } of summary.counts) print(`  ${event}: ${count}`)
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
