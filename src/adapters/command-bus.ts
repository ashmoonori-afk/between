import { writeFile, readFile, readdir, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ApprovalScope } from '../core/types'
import { betweenPaths, type BetweenPaths } from './paths'

/**
 * CLI -> daemon command bus (I3). The daemon is the only writer of state; CLI verbs
 * enqueue a request file that the daemon drains on its next tick. This is what makes
 * `pause`/`resume`/`review-now`/`approve` concurrency-safe without a second writer.
 */
export type Command =
  | { kind: 'goal'; goal: string }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'review_now' }
  | { kind: 'approve'; scope: ApprovalScope }
  | { kind: 'stop' }

export interface DrainedCommand {
  file: string
  command: Command
}

export class CommandBus {
  private readonly p: BetweenPaths

  constructor(root: string) {
    this.p = betweenPaths(root)
  }

  async submit(command: Command): Promise<void> {
    await mkdir(this.p.commands, { recursive: true })
    // timestamp prefix keeps lexicographic order == submission order
    const name = `${Date.now().toString().padStart(16, '0')}-${randomUUID()}.json`
    await writeFile(join(this.p.commands, name), JSON.stringify(command), 'utf8')
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
    for (const name of names) {
      const file = join(this.p.commands, name)
      try {
        const command = JSON.parse(await readFile(file, 'utf8')) as Command
        out.push({ file, command })
      } catch {
        await rm(file, { force: true }) // drop a corrupt command
      }
    }
    return out
  }

  async ack(file: string): Promise<void> {
    await rm(file, { force: true })
  }
}
