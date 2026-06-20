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
        const { loadPolicy, policyPath } = await import('../policy/load')

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
        const { evaluatePolicy, changedPathsFromRaw } = await import('../policy/engine')
        const { collectEvidence } = await import('../evidence/collect')
        const { readBundle } = await import('../review/store')

        const policy = await loadPolicy(root())
        const manifest = await collectEvidence(root(), new SystemClock().nowIso())
        const bundle = state.diff.bundle_id ? await readBundle(root(), state.diff.bundle_id) : null
        const evaluation = evaluatePolicy(policy, {
          changedPaths: bundle ? changedPathsFromRaw(bundle.diff.trackedRaw) : [],
          blockingFindings: manifest?.findings.blocking ?? 0,
          verifyPassed: manifest?.verify ? manifest.verify.passed : null,
        })

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
