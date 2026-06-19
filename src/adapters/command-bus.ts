import { readFile, readdir, rm, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import writeFileAtomic from 'write-file-atomic'
import { z } from 'zod'
import { betweenPaths, type BetweenPaths } from './paths'

/**
 * CLI -> daemon command bus (I3). The daemon is the only writer of state; CLI verbs
 * enqueue a request file that the daemon drains on its next tick. This is what makes
 * `pause`/`resume`/`review-now`/`approve` concurrency-safe without a second writer.
 *
 * SECURITY: command files are written by CLI processes AND are reachable by any agent
 * with filesystem access to `.between/`. Every drained file is therefore schema-validated
 * (the `approve` scope is enforced HERE, not just at the CLI, so a hand-written file cannot
 * bypass the human gate, C1) and the drain is bounded so a flood can't starve the loop (M5).
 */
const CommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('goal'), goal: z.string().max(8192) }),
  z.object({ kind: z.literal('pause') }),
  z.object({ kind: z.literal('resume') }),
  z.object({ kind: z.literal('review_now') }),
  z.object({ kind: z.literal('approve'), scope: z.enum(['merge', 'deploy', 'promote_rule']) }),
  z.object({ kind: z.literal('stop') }),
])

export type Command = z.infer<typeof CommandSchema>

export interface DrainedCommand {
  file: string
  command: Command
}

const MAX_DRAIN_PER_TICK = 64
const MAX_COMMAND_BYTES = 8192

export class CommandBus {
  private readonly p: BetweenPaths

  constructor(root: string) {
    this.p = betweenPaths(root)
  }

  async submit(command: Command): Promise<void> {
    await mkdir(this.p.commands, { recursive: true })
    // ms timestamp (cross-process order) + high-res monotonic counter (tie-break within a
    // process so same-millisecond submissions keep submission order, HIGH-6) + uuid.
    const ms = Date.now().toString().padStart(16, '0')
    const hr = process.hrtime.bigint().toString().padStart(22, '0')
    const name = `${ms}-${hr}-${randomUUID()}.json`
    // atomic temp+rename so the daemon can never drain a half-written command (P2-6)
    await writeFileAtomic(join(this.p.commands, name), JSON.stringify(command))
  }

  /** Read pending commands in submission order. Caller deletes each after applying. */
  async drain(): Promise<DrainedCommand[]> {
    let names: string[]
    try {
      names = (await readdir(this.p.commands)).filter((n) => n.endsWith('.json')).sort()
    } catch {
      return []
    }
    const out: DrainedCommand[] = []
    for (const name of names.slice(0, MAX_DRAIN_PER_TICK)) {
      const file = join(this.p.commands, name)
      try {
        if ((await stat(file)).size > MAX_COMMAND_BYTES) {
          await rm(file, { force: true }) // oversized -> drop without reading
          continue
        }
        const parsed = CommandSchema.safeParse(JSON.parse(await readFile(file, 'utf8')))
        if (parsed.success) {
          out.push({ file, command: parsed.data })
        } else {
          await rm(file, { force: true }) // invalid command shape -> drop
        }
      } catch {
        await rm(file, { force: true }) // corrupt/unreadable -> drop
      }
    }
    return out
  }

  async ack(file: string): Promise<void> {
    await rm(file, { force: true })
  }
}
