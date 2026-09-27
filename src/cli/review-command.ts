import type { Command } from 'commander'
import { print } from './output'
import { fail, root } from './shared'

export function registerReviewCommand(program: Command): void {
  program
    .command('review-worktree')
    .description("Materialize a read-only reviewer worktree from the current cycle's bundle (B1)")
    .action(async () => {
      try {
        const { materializeReviewWorktree } = await import('../api/records')
        const { path } = await materializeReviewWorktree(root())
        print(`between: reviewer worktree at ${path}`)
        print('  reads the sealed bundle state (best-effort OS read-only), not the live work tree')
      } catch (e) {
        await fail(e)
      }
    })
}
