import type { Command } from 'commander'
import { EventsLog } from '../adapters/events-log'
import { StateRepository } from '../adapters/state-repository'
import { print, printErr } from './output'
import { fail, root } from './shared'

export function registerJournalCommand(program: Command): void {
  program
    .command('journal')
    .description(
      'Inspect the append-only event journal; --verify checks the tamper-evident chain (B5)',
    )
    .option('--verify', 'walk the hash chain and report any tampering/truncation')
    .action(async (opts: { verify?: boolean }) => {
      try {
        const log = new EventsLog(root())
        const events = await log.read()
        if (!opts.verify) {
          print(`between: journal has ${events.length} event(s)`)
          return
        }
        const state = await new StateRepository(root()).read()
        const result = await log.verifyAll(state?.journal ?? null)
        if (result.valid) {
          print(`between: journal chain VERIFIED (${events.length} entries, untampered + pinned)`)
        } else if (!result.chain.valid) {
          printErr(
            `between: journal chain BROKEN at entry ${result.chain.brokenAt} - ${result.chain.reason ?? 'invalid'}`,
          )
          process.exitCode = 1
        } else {
          // chain is internally valid but disagrees with the head pinned in state.json
          printErr(`between: journal TAMPERED - ${result.head.reason ?? 'head pin mismatch'}`)
          process.exitCode = 1
        }
      } catch (e) {
        await fail(e)
      }
    })
}
