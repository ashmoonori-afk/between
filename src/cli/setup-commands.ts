import * as readline from 'node:readline/promises'
import type { Command } from 'commander'
import { initWorkspace, parseAgentPreset, runDoctor } from '../api/setup'
import type { InitResult } from '../adapters/init-project'
import { print } from './output'
import { ASCII, fail, root } from './shared'

export function formatInitResult(res: InitResult, opts: { verbose?: boolean } = {}): string[] {
  const lines = [
    res.alreadyExisted
      ? `between: already initialized ${res.project.name} (refreshed ${res.created.length} missing file(s))`
      : `between: initialized ${res.project.name} (${res.created.length} paths created)`,
  ]
  if (opts.verbose) for (const c of res.created) lines.push(`  + ${c}`)
  lines.push(`  agents:  developer ${res.developer}, reviewer ${res.reviewer}`)
  if (res.simulated) {
    lines.push(
      '  mode:    SIMULATION - the fake agent does not really review; merge approvals and protected pushes are refused',
    )
  }
  const hook = res.hook
  if (hook.kind === 'installed' || hook.kind === 'already_installed') {
    lines.push('  hook:    pre-push gate installed')
  } else if (hook.kind === 'not_git_repo') {
    lines.push(
      '  warning: this is not a git repository, so the pre-push gate was not installed. Between reviews git diffs: run `git init`, then `between init` again.',
    )
  } else if (hook.kind === 'conflict') {
    lines.push(
      `  warning: an existing pre-push hook was kept (${hook.path}), so the push gate is NOT active`,
    )
  } else {
    lines.push(`  warning: the pre-push gate could not be installed: ${hook.reason}`)
  }
  if (res.project.obsidian_project_path)
    lines.push(`  vault:   ${res.project.obsidian_project_path}`)
  if (!res.alreadyExisted) {
    lines.push('  next:    between goal "<what to build>"')
    lines.push(
      res.simulated
        ? '           between start --embed   (runs the loop with the fake agents)'
        : '           between start --embed   (hosts the developer and reviewer agents)',
    )
    if (res.simulated) {
      lines.push('  real agents: between init --developer claude --reviewer codex')
    }
  }
  return lines
}

export function registerSetupCommands(program: Command): void {
  program
    .command('init')
    .description('Create .between/ scaffolding, config, and initial state in the current repo')
    .option('--vault <path>', 'Obsidian vault root for human-readable project memory')
    .option('--agent <preset>', 'shorthand: wrap both roles — fake | claude | codex (default fake)')
    .option('--developer <preset>', 'developer-role wrapper: fake | claude | codex')
    .option('--reviewer <preset>', 'reviewer-role wrapper: fake | claude | codex')
    .option('--verbose', 'list every created file')
    .action(
      async (opts: {
        vault?: string
        agent?: string
        developer?: string
        reviewer?: string
        verbose?: boolean
      }) => {
        try {
          const res = await initWorkspace(root(), {
            vaultPath: opts.vault,
            agent: parseAgentPreset(opts.agent, '--agent'),
            developer: parseAgentPreset(opts.developer, '--developer'),
            reviewer: parseAgentPreset(opts.reviewer, '--reviewer'),
          })
          for (const line of formatInitResult(res, { verbose: opts.verbose })) print(line)
        } catch (e) {
          await fail(e)
        }
      },
    )

  program
    .command('onboard')
    .description(
      'First-run wizard: scaffold the workspace, pick a gateway channel, and smoke-test it',
    )
    .option('--channel <name>', 'gateway channel: echo | telegram | discord')
    .option('--agent <preset>', 'agent wrappers: fake | claude | codex')
    .option('--vault <path>', 'Obsidian vault root for human-readable project memory')
    .option('--chat-id <id>', 'telegram chat id or discord channel id to notify (non-secret)')
    .option('--yes', 'non-interactive: use flags/defaults, never prompt')
    .action(
      async (opts: {
        channel?: string
        agent?: string
        vault?: string
        chatId?: string
        yes?: boolean
      }) => {
        const { runOnboard } = await import('../onboard/wizard')
        const interactive = Boolean(process.stdin.isTTY) && !opts.yes
        const rl = interactive
          ? readline.createInterface({ input: process.stdin, output: process.stdout })
          : null
        try {
          await runOnboard(
            root(),
            {
              channel: opts.channel as never,
              agent: opts.agent as never,
              vault: opts.vault,
              chatId: opts.chatId,
              nonInteractive: !interactive,
            },
            {
              ask: async (q) => (rl ? (await rl.question(q)).trim() : ''),
              print,
              env: process.env,
            },
          )
          print('between: onboarding complete')
        } catch (e) {
          await fail(e)
        } finally {
          rl?.close()
        }
      },
    )

  program
    .command('doctor')
    .description('Diagnose the environment and repo for Between')
    .option('--strict', 'also fail on policy violations (secrets in config, etc.)')
    .action(async (opts: { strict?: boolean }) => {
      const report = await runDoctor(root(), { strict: opts.strict })
      for (const c of report.checks) {
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
      if (!report.ok) process.exitCode = 1
    })
}
