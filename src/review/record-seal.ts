import { createHash } from 'node:crypto'
import { chmod, lstat, open } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { BetweenEvent } from '../core/types'
import type { ChainHead } from '../core/journal'
import type { EventsLog } from '../adapters/events-log'

/**
 * Review/verify record immutability. Reviewer agents write `.between/reviews/cycle-NNNN.json` and
 * `.between/verify/cycle-NNNN.json` themselves; once the broker ACCEPTS one it seals it: the file
 * is made read-only (best effort) and its sha256 is appended to the hash-chained journal as a
 * `record_sealed` event. Every later read re-hashes the file and refuses it (fail closed, like
 * readBundle) when the bytes changed, the file was deleted, or it was swapped for a symlink / other
 * non-regular file. The journal itself is chain- and pin-verified before its seal is trusted.
 */
export const RECORD_SEALED_EVENT = 'record_sealed'

export type SealedRecordKind = 'review' | 'verify'

/** Thrown when a sealed review/verify record no longer matches its journal seal. */
export class RecordIntegrityError extends Error {
  constructor(kind: SealedRecordKind, cycle: number, reason: string) {
    super(`${kind} record for cycle ${cycle} failed integrity check: ${reason}`)
    this.name = 'RecordIntegrityError'
  }
}

export type RecordBytes =
  | { status: 'absent' }
  | { status: 'not_regular' }
  | { status: 'ok'; raw: string; sha256: string }

const NO_FOLLOW = constants.O_NOFOLLOW ?? 0

/**
 * Read a record's exact bytes without following a symlink. POSIX: O_NOFOLLOW makes the open itself
 * refuse a symlink (no lstat/open race). Windows has no O_NOFOLLOW, so an lstat check runs first.
 */
export async function readRecordBytes(path: string): Promise<RecordBytes> {
  try {
    if (NO_FOLLOW === 0 && !(await lstat(path)).isFile()) return { status: 'not_regular' }
    const fh = await open(path, constants.O_RDONLY | NO_FOLLOW)
    try {
      if (!(await fh.stat()).isFile()) return { status: 'not_regular' }
      const buf = await fh.readFile()
      return { status: 'ok', raw: buf.toString('utf8'), sha256: sha256Bytes(buf) }
    } finally {
      await fh.close()
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { status: 'absent' }
    // ELOOP (Linux/macOS) / EMLINK (FreeBSD): O_NOFOLLOW hit a symlink
    if (code === 'ELOOP' || code === 'EMLINK') return { status: 'not_regular' }
    throw e
  }
}

/** Make a sealed record read-only. Best effort: the journal seal is the enforced check. */
export async function makeRecordReadOnly(path: string): Promise<void> {
  await chmod(path, 0o444).catch(() => {})
}

/** The sealed sha256 for (kind, cycle): the LAST matching `record_sealed` entry, else null. */
export function findRecordSeal(
  events: ReadonlyArray<BetweenEvent>,
  kind: SealedRecordKind,
  cycle: number,
): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i]!
    if (e.event !== RECORD_SEALED_EVENT || e.cycle !== cycle) continue
    const detail = e.detail as { record?: unknown; sha256?: unknown } | undefined
    if (detail?.record === kind && typeof detail.sha256 === 'string') return detail.sha256
  }
  return null
}

/**
 * Look up the seal for (kind, cycle) in the journal, trusting it only when the hash chain and the
 * pinned head verify: a rewritten or truncated journal could otherwise hide or forge a seal.
 */
export async function lookupRecordSeal(
  log: EventsLog,
  pin: ChainHead | null,
  kind: SealedRecordKind,
  cycle: number,
): Promise<string | null> {
  const integrity = await log.verifyAll(pin)
  if (!integrity.valid) {
    const reason = integrity.chain.reason ?? integrity.head.reason ?? 'invalid'
    throw new RecordIntegrityError(kind, cycle, `journal integrity check failed (${reason})`)
  }
  return findRecordSeal(await log.read(), kind, cycle)
}

export interface LoadedRecord<T> {
  record: T
  sha256: string
}

/**
 * Load a review/verify record. Without a seal (not yet accepted) a missing, non-regular, or
 * malformed file is simply "no record yet" (null). With a seal, anything but the exact sealed
 * bytes throws RecordIntegrityError.
 */
export async function loadRecord<T>(
  path: string,
  parse: (raw: unknown) => T,
  kind: SealedRecordKind,
  cycle: number,
  sealed: string | null,
): Promise<LoadedRecord<T> | null> {
  const bytes = await readRecordBytes(path)
  if (sealed !== null) {
    if (bytes.status === 'absent') {
      throw new RecordIntegrityError(kind, cycle, 'sealed record was deleted')
    }
    if (bytes.status === 'not_regular') {
      throw new RecordIntegrityError(
        kind,
        cycle,
        'sealed record was replaced by a non-regular file',
      )
    }
    if (bytes.sha256 !== sealed) {
      throw new RecordIntegrityError(kind, cycle, 'content changed after it was sealed')
    }
  }
  if (bytes.status !== 'ok') return null
  try {
    return { record: parse(JSON.parse(bytes.raw)), sha256: bytes.sha256 }
  } catch {
    if (sealed !== null) {
      throw new RecordIntegrityError(kind, cycle, 'sealed record no longer parses')
    }
    return null
  }
}

function sha256Bytes(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}
