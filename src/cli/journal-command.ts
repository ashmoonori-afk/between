import type { Command } from 'commander'
import { inspectJournal, resetJournalAnchor } from '../api/records'
import { print, printErr } from './output'
import { fail, root } from './shared'

export function registerJournalCommand(program: Command): void {
  program
    .command('journal')
    .description('Inspect the append-only event journal; --verify checks the tamper-evident chain')
    .option('--verify', 'walk the hash chain and report any tampering/truncation')
    .option(
      '--reset-anchor',
      're-anchor the journal outside .between/ after you restored .between/ on purpose',
    )
    .action(async (opts: { verify?: boolean; resetAnchor?: boolean }) => {
      try {
        if (opts.resetAnchor) {
          const { anchor, entries } = await resetJournalAnchor(root())
          print(
            anchor
              ? `between: journal anchor reset in the ${anchor} store (${entries} entries)`
              : 'between: journal anchor is off (BETWEEN_JOURNAL_ANCHOR=off); nothing to reset',
          )
          return
        }
        const report = await inspectJournal(root(), { verify: opts.verify })
        const integrity = report.integrity
        if (!integrity) {
          print(`between: journal has ${report.entries} event(s)`)
          return
        }
        if (integrity.status === 'verified') {
          print(`between: journal chain VERIFIED (${report.entries} entries, untampered + pinned)`)
        } else if (integrity.status === 'broken') {
          printErr(
            `between: journal chain BROKEN at entry ${integrity.broken_at} - ${integrity.reason}`,
          )
          process.exitCode = 1
        } else {
          printErr(`between: journal TAMPERED - ${integrity.reason}`)
          process.exitCode = 1
        }
      } catch (e) {
        await fail(e)
      }
    })
}
