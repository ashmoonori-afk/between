import type { Command } from 'commander'
import { SystemClock } from '../core/clock'
import { StateRepository } from '../adapters/state-repository'
import { EventsLog } from '../adapters/events-log'
import { CommandBus } from '../adapters/command-bus'
import { AckStore } from '../adapters/ack-store'
import { buildSignal } from '../adapters/signal-transport'
import type { Ack, ApprovalScope } from '../core/types'
import { signApproval, verifyApproval, approvalFreshness, approvalExpiry } from '../core/approval'
import { APPROVAL_SCOPES } from '../core/constants'
import { resolveApprovalSecret, APPROVAL_SECRET_ENV } from '../adapters/approval-secret'
import { loadConfig, runStart } from '../runtime'
import { print, printErr, printJson } from './output'
import { parseInterval } from './args'
import { fail, root } from './shared'

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
        const cfg = await loadConfig(root()).catch(() => null)
        const embed = Boolean(opts.embed) || (cfg !== null && cfg.agent_mode !== 'file')
        if (embed) {
          const { runStartEmbedded } = await import('../ui/start')
          await runStartEmbedded(root(), { maxTicks: opts.maxTicks, headless: opts.headless })
        } else {
          print('between: broker started (headless file mode). Ctrl-C to stop.')
          await runStart(root(), { maxTicks: opts.maxTicks })
          print('between: broker stopped.')
        }
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
            : `between: ${scope} approval submitted (UNSIGNED - set ${APPROVAL_SECRET_ENV} or run \`between init\` to enable the approval boundary)`,
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
        const state = await new StateRepository(root()).read()
        if (!state) return
        if (state.evidence_trust === 'simulated') {
          printErr(
            'between: refusing push — SIMULATION project (fake agent); reviews are not real verification. Run: between init --agent claude|codex.',
          )
          process.exitCode = 1
          return
        }
        const secret = resolveApprovalSecret(root())
        const ap = state.approval
        if (ap) {
          // F2: only a MERGE approval authorizes a push — deploy/promote_rule are separate gates.
          if (ap.scope !== 'merge') {
            printErr(
              `between: refusing push — only a merge approval authorizes a push (got ${ap.scope})`,
            )
            process.exitCode = 1
            return
          }
          const ok = verifyApproval(secret, ap.sig ?? '', {
            scope: ap.scope,
            diff_hash: ap.diff_hash,
            cycle: ap.cycle,
            bundle_id: ap.bundle_id,
            expires_at: ap.expires_at,
          })
          if (!ok) {
            printErr('between: recorded approval failed signature verification')
            process.exitCode = 1
            return
          }
          // A2: a valid signature isn't enough — the approval must still match the current
          // diff/cycle/bundle and not be expired, or a stale approval could push new content.
          const stale = approvalFreshness(ap, {
            diff_hash: state.diff.hash,
            cycle: state.workflow.cycle,
            bundle_id: state.diff.bundle_id,
            nowMs: Date.now(),
          })
          if (stale) {
            printErr(
              `between: approval is no longer valid — ${stale} (re-approve the current diff)`,
            )
            process.exitCode = 1
            return
          }
          // #5: policy is a lifecycle gate — re-check it at push time (defense in depth: e.g. a new
          // dependency CVE could surface after approval). A failing required gate blocks the push.
          const { evaluateCyclePolicy } = await import('../policy/gate')
          const gate = await evaluateCyclePolicy(root(), state, new SystemClock().nowIso())
          if (!gate.evaluation.satisfied) {
            printErr(`between: refusing push — policy gate failed: ${gate.reason}`)
            process.exitCode = 1
            return
          }
          print('between: approval verified')
          return
        }
        if (state.workflow.phase === 'human_gate') {
          printErr('between: human approval is pending (run `between approve merge`)')
          process.exitCode = 1
          return
        }
        print('between: no approval gate pending')
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
