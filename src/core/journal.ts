import { createHash } from 'node:crypto'

/**
 * B5: tamper-evident hash chain for the append-only event journal. Each entry carries `prev_hash`
 * (the previous entry's hash) and `hash` = sha256 over the entry's own content INCLUDING prev_hash.
 * Editing a past entry breaks its hash; reordering/inserting/dropping a MIDDLE entry breaks a
 * prev_hash link. Limitation: dropping the TAIL leaves a shorter still-valid chain — detecting
 * tail-truncation needs the latest hash committed OUTSIDE the journal (a later slice can pin the
 * chain head in state.json). Pure + unit-tested; the events-log adapter just persists these.
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
