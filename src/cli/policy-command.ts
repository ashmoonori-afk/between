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
        const { evaluatePolicy, changedPathsFromRaw, classifyRisk } =
          await import('../policy/engine')
        const { collectEvidence } = await import('../evidence/collect')
        const { readBundle } = await import('../review/store')
        const { scanDiffForSecrets } = await import('../verify/secret-scan')

        const policy = await loadPolicy(root())
        const manifest = await collectEvidence(root(), new SystemClock().nowIso())
        const bundle = state.diff.bundle_id ? await readBundle(root(), state.diff.bundle_id) : null
        const changedPaths = bundle ? changedPathsFromRaw(bundle.diff.trackedRaw) : []

        // run npm audit lazily — only when the active (risk-based) gate set actually needs it.
        // classifyRisk runs again inside evaluatePolicy below; both are pure + deterministic on the
        // same (policy, changedPaths), so the duplicate call is intentional and free of skew.
        const activeGates =
          classifyRisk(policy, changedPaths) === 'high' ? policy.gates.high : policy.gates.normal
        let depAuditVulns: number | null = null
        if (activeGates.includes('dependency_audit')) {
          const { runDepAudit } = await import('../verify/dep-audit')
          const { shellRunner } = await import('../verify/runner')
          depAuditVulns = await runDepAudit(shellRunner(root()))
        }

        const evaluation = evaluatePolicy(policy, {
          changedPaths,
          blockingFindings: manifest?.findings.blocking ?? 0,
          verifyPassed: manifest?.verify ? manifest.verify.passed : null,
          secretScanHits: bundle ? scanDiffForSecrets(bundle.diff.tracked).hits : null,
          depAuditVulns,
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
