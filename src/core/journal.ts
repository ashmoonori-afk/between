import { createHash } from 'node:crypto'

/**
 * B5: tamper-evident hash chain for the append-only event journal. Each entry carries `prev_hash`
 * (the previous entry's hash) and `hash` = sha256 over the entry's own content INCLUDING prev_hash.
 * Editing a past entry breaks its hash; reordering/inserting/dropping a MIDDLE entry breaks a
 * prev_hash link. Limitation closed by the chain-head pin: dropping the TAIL leaves a shorter
 * still-valid chain, so the latest hash + entry count are pinned OUTSIDE the journal (state.json)
 * and cross-checked by `verifyChainHead`. Pure + unit-tested; the events-log adapter persists these.
 */
export const GENESIS_HASH = ''

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export type JournalPayload = Record<string, unknown>
export type SealedEntry = JournalPayload & { prev_hash: string; hash: string }

/**
 * Seal a payload into the chain after `prevHash`. The hash is computed over the payload + prev_hash
 * (with `hash` always written LAST), so a verifier can strip `hash` and recompute deterministically.
 */
export function sealEntry(payload: JournalPayload, prevHash: string): SealedEntry {
  const withPrev = { ...payload, prev_hash: prevHash }
  const hash = sha256(JSON.stringify(withPrev))
  return { ...withPrev, hash }
}

export interface ChainVerification {
  valid: boolean
  /** index of the first broken entry, or null when the whole chain verifies. */
  brokenAt: number | null
  reason?: string
}

/** Walk the chain from genesis; report the first tamper/break, or valid. Pure. */
export function verifyChain(entries: ReadonlyArray<JournalPayload>): ChainVerification {
  let prev = GENESIS_HASH
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as SealedEntry
    if (typeof entry.hash !== 'string' || typeof entry.prev_hash !== 'string') {
      return { valid: false, brokenAt: i, reason: 'entry is not chained (missing hash/prev_hash)' }
    }
    if (entry.prev_hash !== prev) {
      return {
        valid: false,
        brokenAt: i,
        reason: 'broken link (reordered, truncated, or inserted)',
      }
    }
    const { hash, ...rest } = entry
    if (hash !== sha256(JSON.stringify(rest))) {
      return { valid: false, brokenAt: i, reason: 'hash mismatch (payload tampered)' }
    }
    prev = hash
  }
  return { valid: true, brokenAt: null }
}

/** The journal head to pin outside the log: the tail entry's hash + the entry count. */
export interface ChainHead {
  hash: string
  count: number
}

export interface HeadVerification {
  ok: boolean
  reason?: string
}

/** Compute the pin for a chain. Null for an empty (or unchained-tail) chain. Pure. */
export function chainHeadOf(entries: ReadonlyArray<JournalPayload>): ChainHead | null {
  if (entries.length === 0) return null
  const last = entries[entries.length - 1] as SealedEntry
  if (typeof last.hash !== 'string') return null
  return { hash: last.hash, count: entries.length }
}

/**
 * Cross-check the on-disk chain against the head pinned OUTSIDE the journal (state.json). This
 * closes verifyChain's blind spot: dropping the newest entries leaves a shorter still-valid chain.
 * The pinned entry must still sit at its recorded position (index count-1) with its recorded hash,
 * so deleting any tail entry below the pin or substituting it is caught. A journal that has grown
 * PAST the pin is fine — the pin is just a valid prefix. A null/zero pin verifies vacuously. Pure.
 */
export function verifyChainHead(
  entries: ReadonlyArray<JournalPayload>,
  pin: ChainHead | null | undefined,
): HeadVerification {
  if (!pin || pin.count <= 0) return { ok: true }
  if (entries.length < pin.count) {
    return {
      ok: false,
      reason: `tail-truncation: ${entries.length} entries on disk but state pins ${pin.count}`,
    }
  }
  const pinned = entries[pin.count - 1] as SealedEntry | undefined
  if (!pinned || pinned.hash !== pin.hash) {
    return { ok: false, reason: 'pinned head hash mismatch at recorded position (rollback)' }
  }
  return { ok: true }
}
