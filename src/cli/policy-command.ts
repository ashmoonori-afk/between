import type { Command } from 'commander'
import { existsSync } from 'node:fs'
import { SystemClock } from '../core/clock'
import { StateRepository } from '../adapters/state-repository'
import { print, printErr } from './output'
import { fail, root } from './shared'

export function registerPolicyCommand(program: Command): void {
  program
    .command('policy')
    .description('Evaluate the current cycle against policy-as-code (risk, gates, approvals) (B2)')
    .option('--init', 'write a default .between/policy.yaml')
    .action(async (opts: { init?: boolean }) => {
      try {
        const { policyPath } = await import('../policy/load')

        if (opts.init) {
          const { defaultPolicyYaml } = await import('../policy/schema')
          const path = policyPath(root())
          if (existsSync(path)) {
            print(`between: policy already exists at ${path}`)
            return
          }
          const { writeFile } = await import('node:fs/promises')
          await writeFile(path, defaultPolicyYaml(), 'utf8')
          print(`between: wrote default policy to ${path}`)
          return
        }

        const state = await new StateRepository(root()).read()
        if (!state) {
          printErr('between: no state found - run `between init`')
          process.exitCode = 1
          return
        }
        // single source of truth shared with the merge-approval + push lifecycle gates (#5).
        const { evaluateCyclePolicy } = await import('../policy/gate')
        const { evaluation } = await evaluateCyclePolicy(root(), state, new SystemClock().nowIso())

        print(`Policy - ${state.project.name} | cycle ${state.workflow.cycle}`)
        print(`  risk:      ${evaluation.risk}`)
        print(
          `  approvals: ${evaluation.requiredApprovals.reviewers} reviewer(s)${evaluation.requiredApprovals.local_human_required ? ' + local human' : ''}`,
        )
        print('  gates:')
        for (const g of evaluation.gates) print(`    [${g.status}] ${g.name} - ${g.detail}`)
        print(`  result:    ${evaluation.satisfied ? 'SATISFIED' : 'BLOCKED'}`)
        if (!evaluation.satisfied) process.exitCode = 1
      } catch (e) {
        await fail(e)
      }
    })
}
