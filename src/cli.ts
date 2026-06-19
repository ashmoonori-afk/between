import { Command } from 'commander'
import { execa } from 'execa'
import { SystemClock } from './core/clock'
import { initProject } from './adapters/init-project'
import { StateRepository } from './adapters/state-repository'
import { EventsLog } from './adapters/events-log'
import { CommandBus } from './adapters/command-bus'
import { AckStore } from './adapters/ack-store'
import { GitAdapter } from './adapters/git'
import { buildSignal } from './adapters/signal-transport'
import type { Ack, ApprovalScope } from './core/types'
import type { AgentPreset } from './agents/real-agents'
import { signApproval, verifyApproval } from './core/approval'
import { resolveApprovalSecret, APPROVAL_SECRET_ENV } from './adapters/approval-secret'
import { loadConfig, runStart } from './runtime'
import { print, printErr, printJson } from './cli/output'
import { parseInterval } from './cli/args'

const VERSION = '0.1.0'
const APPROVAL_SCOPES: ApprovalScope[] = ['merge', 'deploy', 'promote_rule']
const AGENT_PRESETS: AgentPreset[] = ['fake', 'claude', 'codex']
/** Use ASCII markers when output isn't an interactive terminal (avoids Windows mojibake, P3-14). */
const ASCII =
  !process.stdout.isTTY || Boolean(process.env.NO_COLOR) || Boolean(process.env.BETWEEN_ASCII)

function root(): string {
  return process.cwd()
}

async function fail(err: unknown): Promise<never> {
  printErr(`between: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
  throw err
}

const program = new Command()
program
  .name('between')
  .description('A local terminal broker for AI pair development.')
  .version(VERSION)

program
  .command('init')
  .description('Create .between/ scaffolding, config, and initial state in the current repo')
  .option('--vault <path>', 'Obsidian vault root for human-readable project memory')
  .option('--agent <preset>', 'agent wrappers: fake (default), claude, or codex')
  .action(async (opts: { vault?: string; agent?: string }) => {
    try {
      const agent = opts.agent as AgentPreset | undefined
      if (agent && !AGENT_PRESETS.includes(agent)) {
        throw new Error(`--agent must be one of: ${AGENT_PRESETS.join(', ')}`)
      }
      const res = await initProject(root(), { vaultPath: opts.vault, agent }, new SystemClock())
      print(
        res.alreadyExisted
          ? 'between: already initialized (refreshed missing files)'
          : 'between: initialized',
      )
      for (const c of res.created) print(`  + ${c}`)
      print(`  project: ${res.project.name}`)
      if (res.project.obsidian_project_path)
        print(`  vault:   ${res.project.obsidian_project_path}`)
    } catch (e) {
      await fail(e)
    }
  })

program
  .command('status')
  .description('Print the current phase, cycle, waiting actor, diff hash, and latest event')
  .option('--json', 'output machine-readable JSON')
  .action(async (opts: { json?: boolean }) => {
    try {
      const state = await new StateRepository(root()).read()
      if (!state) {
        printErr('between: no state found — run `between init`')
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
      print(`Between · ${state.project.name}`)
      print(`  phase:      ${wf.phase}`)
      print(
        `  cycle:      ${wf.cycle} (this goal: ${wf.cycles_this_goal}/${cfg?.max_cycles_per_goal ?? '?'})`,
      )
      print(`  waiting on: ${wf.waiting_on ?? '-'}`)
      print(
        `  diff:       ${state.diff.hash ? state.diff.hash.slice(0, 12) : '-'} · ${state.diff.changed_files} files +${state.diff.insertions} -${state.diff.deletions}`,
      )
      print(`  developer:  ${state.developer.name} (${state.developer.status})`)
      print(`  reviewer:   ${state.reviewer.name} (${state.reviewer.status})`)
      if (wf.error) print(`  error:      ${wf.error.code} — ${wf.error.message}`)
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
  .option('--max-ticks <n>', 'run a bounded number of poll iterations then exit', (v) => Number(v))
  .action(async (opts: { embed?: boolean; headless?: boolean; maxTicks?: number }) => {
    try {
      const cfg = await loadConfig(root()).catch(() => null)
      const embed = Boolean(opts.embed) || (cfg !== null && cfg.agent_mode !== 'file')
      if (embed) {
        const { runStartEmbedded } = await import('./ui/start')
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

function enqueue(label: string, makeCmd: () => Parameters<CommandBus['submit']>[0]) {
  return async () => {
    try {
      await loadConfig(root()) // ensures initialized
      await new CommandBus(root()).submit(makeCmd())
      print(`between: ${label} requested`)
    } catch (e) {
      await fail(e)
    }
  }
}

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
      // sign the approval with the secret the human session holds (P1-5); a forged approve
      // file written without the secret can't produce a signature the daemon accepts.
      const secret = resolveApprovalSecret(root())
      const claim = {
        scope,
        diff_hash: state?.diff.hash ?? null,
        cycle: state?.workflow.cycle ?? 0,
      }
      const sig = secret ? signApproval(secret, claim) : undefined
      await new CommandBus(root()).submit({ kind: 'approve', scope: scope as ApprovalScope, sig })
      print(
        secret
          ? `between: ${scope} approval submitted (signed)`
          : `between: ${scope} approval submitted (UNSIGNED — set ${APPROVAL_SECRET_ENV} or run \`between init\` to enable the approval boundary)`,
      )
    } catch (e) {
      await fail(e)
    }
  })

program
  .command('ack')
  .description('(reviewer helper) acknowledge the outstanding review signal for the current cycle')
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
  .command('doctor')
  .description('Diagnose the environment and repo for Between')
  .action(async () => {
    const checks: Array<{ ok: boolean | 'warn'; label: string }> = []
    const git = new GitAdapter(root())
    try {
      const v = await execa('git', ['--version'], { reject: false })
      checks.push({ ok: v.exitCode === 0, label: `git: ${v.stdout.trim() || 'not found'}` })
    } catch {
      checks.push({ ok: false, label: 'git: not found' })
    }
    checks.push({ ok: await git.isRepo(), label: 'inside a git work tree' })
    try {
      const cfg = await loadConfig(root())
      checks.push({ ok: true, label: 'between initialized (config valid)' })
      checks.push({
        ok: cfg.vault_path ? true : 'warn',
        label: cfg.vault_path
          ? `vault: ${cfg.vault_path}`
          : 'vault: not set (Obsidian memory disabled)',
      })
    } catch {
      checks.push({ ok: false, label: 'between initialized (run `between init`)' })
    }
    let ptyOk = false
    try {
      // indirect specifier: @lydell/node-pty is an OPTIONAL native dep; don't statically resolve it
      const ptyModule = '@lydell/node-pty'
      await import(ptyModule)
      ptyOk = true
    } catch {
      ptyOk = false
    }
    checks.push({
      ok: ptyOk ? true : 'warn',
      label: ptyOk
        ? '@lydell/node-pty available (terminal mode ready)'
        : 'node-pty unavailable (headless file-signal mode only)',
    })

    for (const c of checks) {
      const mark = ASCII
        ? c.ok === true
          ? '[ok]'
          : c.ok === 'warn'
            ? '[!]'
            : '[x]'
        : c.ok === true
          ? '✓'
          : c.ok === 'warn'
            ? '⚠'
            : '✗'
      print(`  ${mark} ${c.label}`)
    }
    if (checks.some((c) => c.ok === false)) process.exitCode = 1
  })

program
  .command('summarize')
  .description('Summarize cycle/phase analytics from events.jsonl')
  .action(async () => {
    try {
      const events = await new EventsLog(root()).read()
      const counts = new Map<string, number>()
      for (const e of events) counts.set(e.event, (counts.get(e.event) ?? 0) + 1)
      print(`Between · ${events.length} events`)
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
      if (!state) return // not a Between target -> never block
      const secret = resolveApprovalSecret(root())
      const ap = state.approval
      if (ap) {
        const ok = verifyApproval(secret, ap.sig ?? '', {
          scope: ap.scope,
          diff_hash: ap.diff_hash,
          cycle: ap.cycle,
        })
        if (!ok) {
          printErr('between: recorded approval failed signature verification')
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
      const { runDashboard } = await import('./ui/dash')
      await runDashboard(root(), { once: opts.once, intervalMs: opts.interval })
    } catch (e) {
      await fail(e)
    }
  })

program.parseAsync(process.argv).catch((e: unknown) => {
  // action errors were already printed by fail() (which set exitCode); this also surfaces
  // parse-time errors (bad flags) that would otherwise fail silently (LOW-1).
  if (!process.exitCode && e instanceof Error) printErr(`between: ${e.message}`)
  if (!process.exitCode) process.exitCode = 1
})
