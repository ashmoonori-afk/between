import type { Command } from 'commander'
import { EventsLog } from '../adapters/events-log'
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
        const result = await log.verify()
        if (result.valid) {
          print(`between: journal chain VERIFIED (${events.length} entries, untampered)`)
        } else {
          printErr(
            `between: journal chain BROKEN at entry ${result.brokenAt} — ${result.reason ?? 'invalid'}`,
          )
          process.exitCode = 1
        }
      } catch (e) {
        await fail(e)
      }
    })
}
