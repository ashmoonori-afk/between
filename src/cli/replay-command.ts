import { writeFile } from 'node:fs/promises'
import type { Command } from 'commander'
import { EventsLog } from '../adapters/events-log'
import { StateRepository } from '../adapters/state-repository'
import { replayStateFromEvents } from '../core/replay'
import { fail, root } from './shared'
import { print, printJson } from './output'

interface ReplayOptions {
  verify?: boolean
  out?: string
}

export function registerReplayCommand(program: Command): void {
  program
    .command('replay')
    .description('Reconstruct state from the verified append-only event journal (B5)')
    .option('--verify', 'verify the journal hash chain and pinned head before output')
    .option('--out <path>', 'write reconstructed state JSON to a file instead of stdout')
    .action(async (opts: ReplayOptions) => {
      try {
        const log = new EventsLog(root())
        const state = await new StateRepository(root()).read()
        const replayed = replayStateFromEvents(
          await log.read(),
          opts.verify ? state?.journal : null,
        )
        if (opts.out) {
          await writeFile(opts.out, `${JSON.stringify(replayed, null, 2)}\n`, 'utf8')
          print(`between: replay reconstructed state -> ${opts.out}`)
        } else {
          printJson(replayed)
        }
      } catch (e) {
        await fail(e)
      }
    })
}
