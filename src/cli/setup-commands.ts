import * as readline from 'node:readline/promises'
import type { Command } from 'commander'
import { initWorkspace, parseAgentPreset, runDoctor } from '../api/setup'
import { print } from './output'
import { ASCII, fail, root } from './shared'

export function registerSetupCommands(program: Command): void {
  program
    .command('init')
    .description('Create .between/ scaffolding, config, and initial state in the current repo')
    .option('--vault <path>', 'Obsidian vault root for human-readable project memory')
    .option('--agent <preset>', 'shorthand: wrap both roles — fake | claude | codex (default fake)')
    .option('--developer <preset>', 'developer-role wrapper: fake | claude | codex')
    .option('--reviewer <preset>', 'reviewer-role wrapper: fake | claude | codex')
    .action(
      async (opts: { vault?: string; agent?: string; developer?: string; reviewer?: string }) => {
        try {
          const res = await initWorkspace(root(), {
            vaultPath: opts.vault,
            agent: parseAgentPreset(opts.agent, '--agent'),
            developer: parseAgentPreset(opts.developer, '--developer'),
            reviewer: parseAgentPreset(opts.reviewer, '--reviewer'),
          })
          print(
            res.alreadyExisted
              ? 'between: already initialized (refreshed missing files)'
              : 'between: initialized',
          )
          for (const c of res.created) print(`  + ${c}`)
          print(`  project: ${res.project.name}`)
          if (res.project.obsidian_project_path)
            print(`  vault:   ${res.project.obsidian_project_path}`)
          if (!res.alreadyExisted) print('  next:    run `between onboard` to wire a chat gateway')
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
