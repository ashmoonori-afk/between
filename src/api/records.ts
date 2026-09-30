import { SystemClock } from '../core/clock'
import { replayStateFromEvents } from '../core/replay'
import { EventsLog } from '../adapters/events-log'
import { StateRepository } from '../adapters/state-repository'
import { WorktreeProvider } from '../adapters/worktree'
import { collectEvidence } from '../evidence/collect'
import type { EvidenceManifest } from '../evidence/manifest'
import { readBundle } from '../review/store'
import { materializeBundle } from '../review/materialize'
import { BetweenApiError, noStateError } from './errors'

export type JournalIntegrity =
  | { status: 'verified' }
  | { status: 'broken'; broken_at: number | null; reason: string }
  | { status: 'tampered'; reason: string }

export interface JournalReport {
  entries: number
  /** present only when verification was requested. */
  integrity?: JournalIntegrity
}

/** Count journal entries; with `verify`, walk the hash chain and check the head pinned in state. */
export async function inspectJournal(
  root: string,
  opts: { verify?: boolean } = {},
): Promise<JournalReport> {
  const log = new EventsLog(root)
  const events = await log.read()
  const state = await new StateRepository(root).read()
  if (!state && events.length === 0) throw noStateError()
  if (!opts.verify) return { entries: events.length }
  const result = await log.verifyAll(state?.journal ?? null)
  if (result.valid) return { entries: events.length, integrity: { status: 'verified' } }
  if (!result.chain.valid) {
    return {
      entries: events.length,
      integrity: {
        status: 'broken',
        broken_at: result.chain.brokenAt ?? null,
        reason: result.chain.reason ?? 'invalid',
      },
    }
  }
  const reason = !result.head.ok
    ? (result.head.reason ?? 'head pin mismatch')
    : (result.anchor.reason ?? 'journal anchor mismatch')
  return { entries: events.length, integrity: { status: 'tampered', reason } }
}

/**
 * Human recovery after an intentional restore of `.between/`: anchor the journal as it is now.
 * Refuses a broken chain. Not exposed over MCP.
 */
export async function resetJournalAnchor(
  root: string,
): Promise<{ entries: number; anchor: 'keychain' | 'file' | null }> {
  const log = new EventsLog(root)
  const head = await log.resetAnchor()
  return { entries: head?.count ?? 0, anchor: log.anchorKind }
}

/** Reconstruct state from the append-only journal; `verify` enforces the chain + pinned head. */
export async function replayState(
  root: string,
  opts: { verify?: boolean } = {},
): Promise<ReturnType<typeof replayStateFromEvents>> {
  const log = new EventsLog(root)
  const state = await new StateRepository(root).read()
  const events = await log.read()
  if (opts.verify) await log.assertAnchored(events)
  if (!state && events.length === 0) throw noStateError()
  return replayStateFromEvents(events, opts.verify ? state?.journal : null)
}

/** Portable evidence manifest for the current cycle (bundle + review + verification + approval). */
export async function getEvidence(root: string): Promise<EvidenceManifest> {
  const manifest = await collectEvidence(root, new SystemClock().nowIso())
  if (!manifest) throw noStateError()
  return manifest
}

/** Materialize a read-only reviewer worktree from the current cycle's sealed bundle. */
export async function materializeReviewWorktree(root: string): Promise<{ path: string }> {
  const state = await new StateRepository(root).read()
  if (!state?.diff.bundle_id) {
    throw new BetweenApiError('not_found', 'no sealed review bundle for the current cycle yet')
  }
  const bundle = await readBundle(root, state.diff.bundle_id)
  if (!bundle) {
    throw new BetweenApiError('not_found', `bundle ${state.diff.bundle_id} not found`)
  }
  return { path: await materializeBundle(bundle, new WorktreeProvider(root)) }
}
