import type { Command } from 'commander'
import { print } from './output'
import { fail, root } from './shared'

export function registerEvidenceCommand(program: Command): void {
  program
    .command('evidence')
    .description(
      'Emit the portable evidence manifest for the current cycle (bundle+review+approval)',
    )
    .option('--json', 'emit JSON instead of Markdown')
    .option('--out <path>', 'write to a file instead of stdout')
    .action(async (opts: { json?: boolean; out?: string }) => {
      try {
        const { getEvidence } = await import('../api/records')
        const { toMarkdown } = await import('../evidence/manifest')
        const manifest = await getEvidence(root())
        const out = opts.json ? JSON.stringify(manifest, null, 2) : toMarkdown(manifest)
        if (opts.out) {
          const { writeFile } = await import('node:fs/promises')
          await writeFile(opts.out, out.endsWith('\n') ? out : `${out}\n`, 'utf8')
          print(`between: evidence written to ${opts.out}`)
        } else {
          print(out)
        }
      } catch (e) {
        await fail(e)
      }
    })
}
