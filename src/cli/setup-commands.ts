import * as readline from 'node:readline/promises'
import { execa } from 'execa'
import type { Command } from 'commander'
import { SystemClock } from '../core/clock'
import { initProject } from '../adapters/init-project'
import { GitAdapter } from '../adapters/git'
import { loadConfig } from '../runtime'
import { AGENT_PRESETS, type AgentPreset } from '../core/constants'
import { print } from './output'
import { ASCII, fail, root } from './shared'

export function registerSetupCommands(program: Command): void {
  program
    .command('init')
    .description('Create .between/ scaffolding, config, and initial state in the current repo')
    .option('--vault <path>', 'Obsidian vault root for human-readable project memory')
    .option('--agent <preset>', 'agent wrappers: fake | claude | codex (default fake)')
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
        if (!res.alreadyExisted) print('  next:    run `between onboard` to wire a chat gateway')
      } catch (e) {
        await fail(e)
      }
    })

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
        if (opts.strict) {
          // A6: bot tokens must live in env, never in config.yaml — fail strict if one leaked in.
          const secretInConfig = Boolean(cfg.telegram_bot_token) || Boolean(cfg.discord_bot_token)
          checks.push({
            ok: secretInConfig ? false : true,
            label: secretInConfig
              ? 'SECRET in config.yaml — move telegram_bot_token/discord_bot_token to BETWEEN_*_TOKEN env'
              : 'no literal bot tokens in config.yaml (env-only policy)',
          })
        }
      } catch {
        checks.push({ ok: false, label: 'between initialized (run `between init`)' })
      }
      let ptyOk = false
      try {
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
}
