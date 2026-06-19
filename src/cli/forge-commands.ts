import type { Command } from 'commander'
import { CommandBus } from '../adapters/command-bus'
import { loadConfig } from '../runtime'
import { print } from './output'
import { fail, root } from './shared'

async function loadForgeOrFail(): Promise<import('../forge/state').ForgeState> {
  const { readForgeState } = await import('../forge/repository')
  const state = await readForgeState(root())
  if (!state) throw new Error('forge not initialized - run `between forge init <idea>`')
  return state
}

export function registerForgeCommands(program: Command): void {
  const forge = program
    .command('forge')
    .description(
      'Drive the builtin PWSForge app-build lifecycle (idea -> PRD -> UI -> build -> ship)',
    )

  forge
    .command('init')
    .description('Scaffold docs/pwsforge/ + state.json parked at the intake phase')
    .argument('[idea...]', 'one-line app idea')
    .option('--platform <list>', 'comma-separated platform priority, e.g. ios,android,web')
    .action(async (idea: string[], opts: { platform?: string }) => {
      try {
        const { scaffoldForge } = await import('../forge/repository')
        const platformPriority = opts.platform
          ? opts.platform
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined
        const res = await scaffoldForge(root(), {
          idea: idea.join(' ') || undefined,
          platformPriority,
        })
        print(res.alreadyExisted ? 'forge: already initialized' : 'forge: initialized at intake')
        for (const c of res.created) print(`  + ${c}`)
        print(`  next: ${res.state.next_recommended_action}`)
      } catch (e) {
        await fail(e)
      }
    })

  forge
    .command('status')
    .description('Show the current forge phase, status, blockers, and whether the gate is open')
    .action(async () => {
      try {
        const state = await loadForgeOrFail()
        const { gateBlock } = await import('../forge/machine')
        const { phaseIndex, FORGE_PHASES, nextPhase } = await import('../forge/phases')
        print(`Forge - ${state.project_name}`)
        print(
          `  phase:   ${state.current_phase} (${phaseIndex(state.current_phase) + 1}/${FORGE_PHASES.length})`,
        )
        print(`  status:  ${state.phase_status}`)
        if (state.open_blockers.length) {
          print('  blockers:')
          state.open_blockers.forEach((b, i) => print(`    [${i}] ${b.severity} ${b.description}`))
        }
        const block = gateBlock(state)
        const nxt = nextPhase(state.current_phase)
        print(`  gate:    ${block ? `CLOSED - ${block}` : nxt ? `open -> ${nxt}` : 'final phase'}`)
        print(`  next:    ${state.next_recommended_action}`)
      } catch (e) {
        await fail(e)
      }
    })

  forge
    .command('approve')
    .description('Mark the current phase approved (satisfies the phase gate)')
    .action(async () => {
      try {
        const state = await loadForgeOrFail()
        const { setStatus } = await import('../forge/machine')
        const { writeForgeState } = await import('../forge/repository')
        await writeForgeState(root(), setStatus(state, 'approved'))
        print(`forge: ${state.current_phase} approved`)
      } catch (e) {
        await fail(e)
      }
    })

  forge
    .command('advance')
    .description('Advance to the next phase (refused while the gate is closed)')
    .action(async () => {
      try {
        const state = await loadForgeOrFail()
        const { advance } = await import('../forge/machine')
        const { writeForgeState } = await import('../forge/repository')
        const next = advance(state)
        await writeForgeState(root(), next)
        print(`forge: advanced ${state.current_phase} -> ${next.current_phase}`)
      } catch (e) {
        await fail(e)
      }
    })

  forge
    .command('block <severity> <description...>')
    .description('Record an open blocker (P0 closes the gate): P0 | P1 | P2 | P3')
    .action(async (severity: string, description: string[]) => {
      try {
        const sev = severity.toUpperCase()
        if (!['P0', 'P1', 'P2', 'P3'].includes(sev)) throw new Error('severity must be P0|P1|P2|P3')
        const state = await loadForgeOrFail()
        const { addBlocker } = await import('../forge/machine')
        const { writeForgeState } = await import('../forge/repository')
        await writeForgeState(
          root(),
          addBlocker(state, {
            severity: sev as 'P0' | 'P1' | 'P2' | 'P3',
            description: description.join(' '),
          }),
        )
        print(`forge: recorded ${sev} blocker`)
      } catch (e) {
        await fail(e)
      }
    })

  forge
    .command('unblock <index>')
    .description('Resolve the blocker at the given index (see `between forge status`)')
    .action(async (index: string) => {
      try {
        const state = await loadForgeOrFail()
        const { removeBlocker } = await import('../forge/machine')
        const { writeForgeState } = await import('../forge/repository')
        await writeForgeState(root(), removeBlocker(state, Number(index)))
        print(`forge: cleared blocker [${index}]`)
      } catch (e) {
        await fail(e)
      }
    })

  forge
    .command('build <task...>')
    .description(
      'CLI-forced execution: route the build task to the Between broker (never coded inline)',
    )
    .action(async (task: string[]) => {
      try {
        await loadConfig(root())
        const state = await loadForgeOrFail()
        const { delegateBuild } = await import('../forge/build')
        const bus = new CommandBus(root())
        const res = await delegateBuild(root(), state, task.join(' '), (goal) =>
          bus.submit({ kind: 'goal', goal }),
        )
        print('forge: build routed to the broker (CLI-forced)')
        print(`  goal:  ${res.goal}`)
        print(`  brief: ${res.briefPath}`)
        print('  next:  run `between start` to develop + review this goal')
      } catch (e) {
        await fail(e)
      }
    })
}
