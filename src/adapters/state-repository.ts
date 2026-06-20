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
    // migrate() runs OUTSIDE tryRead so a newer-schema REFUSAL propagates instead of being
    // swallowed by the corrupt-file fallback and silently downgrading (P2-7).
    const primary = await this.tryRead(this.p.state)
    if (primary) return migrate(primary)
    const backup = await this.tryRead(this.p.stateBak)
    return backup ? migrate(backup) : null
  }

  /** Parse + structural-validate only (no migration); returns null on corrupt/garbage. */
  private async tryRead(path: string): Promise<BetweenState | null> {
    if (!existsSync(path)) return null
    try {
      const raw = await readFile(path, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      return isBetweenState(parsed) ? parsed : null
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
  // reviewed_hashes MUST be an array or isAlreadyReviewed() throws at runtime (HIGH-4)
  if (!Array.isArray(wf.reviewed_hashes)) return false
  if (typeof wf.cycle !== 'number' || typeof wf.cycles_this_goal !== 'number') return false
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
  // B5: a pre-pin state.json has no `journal` key. Normalize to null so the field is always present
  // (the type says ChainHead | null, not undefined) and tail-truncation checks start clean.
  return state.journal === undefined ? { ...state, journal: null } : state
}
