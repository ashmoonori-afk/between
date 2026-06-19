import { copyFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import writeFileAtomic from 'write-file-atomic'
import type { BetweenState } from '../core/types'
import { PHASES } from '../core/types'
import { betweenPaths } from './paths'

/**
 * Durable state persistence (I2). Every write is atomic (temp + fsync + rename via
 * write-file-atomic) and preceded by a `.bak` copy of the last good file. Reads fall
 * back: state.json -> state.json.bak -> null (caller then reconstructs or errors).
 */
export class StateRepository {
  private readonly p: ReturnType<typeof betweenPaths>

  constructor(root: string) {
    this.p = betweenPaths(root)
  }

  async write(state: BetweenState): Promise<void> {
    const json = JSON.stringify(state, null, 2)
    // keep a last-known-good backup before overwriting
    if (existsSync(this.p.state)) {
      try {
        await copyFile(this.p.state, this.p.stateBak)
      } catch {
        // a missing/locked bak must not block the primary write
      }
    }
    await writeFileAtomic(this.p.state, json)
  }

  async read(): Promise<BetweenState | null> {
    const primary = await this.tryRead(this.p.state)
    if (primary) return primary
    const backup = await this.tryRead(this.p.stateBak)
    return backup
  }

  private async tryRead(path: string): Promise<BetweenState | null> {
    if (!existsSync(path)) return null
    try {
      const raw = await readFile(path, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      return isBetweenState(parsed) ? migrate(parsed) : null
    } catch {
      return null
    }
  }
}

/** Structural guard — enough to reject a truncated/garbage file. */
export function isBetweenState(value: unknown): value is BetweenState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.schema_version !== 'number') return false
  const wf = v.workflow as Record<string, unknown> | undefined
  if (!wf || typeof wf.phase !== 'string') return false
  if (!(PHASES as readonly string[]).includes(wf.phase)) return false
  return typeof v.diff === 'object' && typeof v.debounce === 'object'
}

/**
 * Migration chain (I23). Newer-than-binary state is refused; older state is upgraded.
 * Currently only v1 exists, so this is the identity plus the guard rail.
 */
export function migrate(state: BetweenState): BetweenState {
  if (state.schema_version > 1) {
    throw new Error(
      `state.json schema_version ${state.schema_version} is newer than this Between build supports (1). Upgrade Between.`,
    )
  }
  return state
}
