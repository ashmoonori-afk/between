import * as readline from 'node:readline/promises'
import type { Command } from 'commander'
import {
  DEFAULT_REVIEWER_USER,
  checkIsolation,
  interactiveRunner,
  isolationConfigPath,
  planIsolationRemoval,
  planIsolationSetup,
  probeHostFacts,
  probeRunner,
  protectedPathsFor,
  readIsolationConfig,
  runIsolationPlan,
  type IsolationPlan,
} from '../adapters/reviewer-isolation'
import { print } from './output'
import { fail, root } from './shared'

async function confirmAndRun(plan: IsolationPlan, yes: boolean): Promise<void> {
  if (!plan.supported) {
    print(`between: ${plan.reason}`)
    process.exitCode = 1
    return
  }
  const interactive = Boolean(process.stdin.isTTY)
  const rl = interactive
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : null
  try {
    const outcome = await runIsolationPlan(plan, {
      yes,
      interactive,
      ask: async (q) => (rl ? await rl.question(q) : ''),
      print,
      runner: interactiveRunner,
    })
    if (outcome === 'declined') process.exitCode = 1
  } finally {
    rl?.close()
  }
}

export function registerIsolationCommand(program: Command): void {
  const isolation = program
    .command('isolation')
    .description(
      'Opt-in: run the direct reviewer as a separate OS user that cannot write the journal anchor (Linux)',
    )

  isolation
    .command('setup')
    .description(
      'Print what will be created (user, sudoers rule, root-owned opt-in), confirm, then create it',
    )
    .option('--user <name>', 'new reviewer OS user to create', DEFAULT_REVIEWER_USER)
    .option('--yes', 'confirm without prompting (the plan is still printed)')
    .action(async (opts: { user: string; yes?: boolean }) => {
      try {
        const configPath = isolationConfigPath()
        const invokingUid = process.getuid?.() ?? -1
        const plan = planIsolationSetup({
          platform: process.platform,
          user: opts.user,
          invokingUid,
          configPath,
          facts:
            process.platform === 'linux' && configPath
              ? await probeHostFacts(opts.user, configPath)
              : { userExists: false, configExists: false },
        })
        await confirmAndRun(plan, Boolean(opts.yes))
      } catch (e) {
        await fail(e)
      }
    })

  isolation
    .command('remove')
    .description(
      'Print what will be removed (sudoers rule, user, opt-in), confirm, then remove it; only touches what setup created',
    )
    .option('--yes', 'confirm without prompting (the plan is still printed)')
    .action(async (opts: { yes?: boolean }) => {
      try {
        const configPath = isolationConfigPath()
        const plan = planIsolationRemoval({
          platform: process.platform,
          configPath,
          config: await readIsolationConfig(configPath),
        })
        await confirmAndRun(plan, Boolean(opts.yes))
      } catch (e) {
        await fail(e)
      }
    })

  isolation
    .command('status')
    .description('Report whether reviewer isolation is off, active, broken, or unsupported here')
    .action(async () => {
      const status = await checkIsolation({
        platform: process.platform,
        configPath: isolationConfigPath(),
        protectedPaths: protectedPathsFor(root()),
        runner: probeRunner,
      })
      print(`reviewer isolation: ${status.state} - ${status.detail}`)
      if (status.state === 'broken') process.exitCode = 1
    })
}
