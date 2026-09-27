import type { Command } from 'commander'
import { print } from './output'
import { fail, root } from './shared'

export function registerPolicyCommand(program: Command): void {
  program
    .command('policy')
    .description('Evaluate the current cycle against policy-as-code (risk, gates, approvals) (B2)')
    .option('--init', 'write a default .between/policy.yaml')
    .action(async (opts: { init?: boolean }) => {
      try {
        const { evaluatePolicy, initPolicy } = await import('../api/checks')

        if (opts.init) {
          const { path, created } = await initPolicy(root())
          print(
            created
              ? `between: wrote default policy to ${path}`
              : `between: policy already exists at ${path}`,
          )
          return
        }

        const { project, cycle, evaluation } = await evaluatePolicy(root())
        print(`Policy - ${project} | cycle ${cycle}`)
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
