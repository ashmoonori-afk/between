import type { Command } from 'commander'
import { StateRepository } from '../adapters/state-repository'
import { print, printErr } from './output'
import { fail, root } from './shared'

export function registerReviewCommand(program: Command): void {
  program
    .command('review-worktree')
    .description("Materialize a read-only reviewer worktree from the current cycle's bundle (B1)")
    .action(async () => {
      try {
        const state = await new StateRepository(root()).read()
        if (!state?.diff.bundle_id) {
          printErr('between: no sealed review bundle for the current cycle yet')
          process.exitCode = 1
          return
        }
        const { readBundle } = await import('../review/store')
        const { materializeBundle } = await import('../review/materialize')
        const { WorktreeProvider } = await import('../adapters/worktree')
        const bundle = await readBundle(root(), state.diff.bundle_id)
        if (!bundle) {
          printErr(`between: bundle ${state.diff.bundle_id} not found`)
          process.exitCode = 1
          return
        }
        const path = await materializeBundle(bundle, new WorktreeProvider(root()))
        print(`between: reviewer worktree at ${path}`)
        print('  reads the sealed bundle state (read-only by convention), not the live work tree')
      } catch (e) {
        await fail(e)
      }
    })
}
