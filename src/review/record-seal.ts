import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { chmod, lstat, open } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { BetweenEvent } from '../core/types'
import {
  pinIsAuthentic,
  verifyChain,
  verifyChainHead,
  type ChainHead,
  type JournalPayload,
} from '../core/journal'
import type { EventsLog } from '../adapters/events-log'

/**
 * Review/verify record immutability. Reviewer agents write `.between/reviews/cycle-NNNN.json` and
 * `.between/verify/cycle-NNNN.json` themselves; once the broker ACCEPTS one it seals it: the file
 * is made read-only (best effort) and its sha256 is appended to the hash-chained journal as a
 * `record_sealed` event. Every later read re-hashes the file and refuses it (fail closed, like
 * readBundle) when the bytes changed, the file was deleted, or it was swapped for a symlink / other
 * non-regular file.
 *
 * Seal trust: the journal snapshot must pass its hash chain + pinned head, and only entries inside
 * the pinned range count (a well-chained suffix appended after the pin is ignored). When the
 * approval secret is provisioned (env-only, stripped from agent environments), the pin itself and
 * each seal carry an HMAC agents cannot compute, so rewriting the journal and re-pinning it (to
 * drop or forge a seal) is rejected too.
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
const NON_BLOCK = constants.O_NONBLOCK ?? 0

/**
 * Read a record's exact bytes without following a symlink or blocking on a FIFO. POSIX: O_NOFOLLOW
 * refuses a symlink at open time and O_NONBLOCK keeps a named pipe from hanging the open. After
 * opening, the handle must be a regular file whose identity (dev + ino) matches a fresh lstat of
 * the path; on Windows (no O_NOFOLLOW) that comparison is what rejects a symlink/reparse swap.
 */
export async function readRecordBytes(path: string): Promise<RecordBytes> {
  try {
    const fh = await open(path, constants.O_RDONLY | NO_FOLLOW | NON_BLOCK)
    try {
      const opened = await fh.stat({ bigint: true })
      if (!opened.isFile()) return { status: 'not_regular' }
      const linked = await lstat(path, { bigint: true })
      if (!linked.isFile() || linked.dev !== opened.dev || linked.ino !== opened.ino) {
        return { status: 'not_regular' }
      }
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

/** HMAC binding (kind, cycle, sha256) to the broker's approval secret. */
export function sealMac(
  secret: string,
  kind: SealedRecordKind,
  cycle: number,
  sha256: string,
): string {
  return createHmac('sha256', secret)
    .update(['BETWEEN_RECORD_SEAL_V1', kind, String(cycle), sha256].join('\0'), 'utf8')
    .digest('hex')
}

/**
 * The sealed sha256 for (kind, cycle): the LAST matching `record_sealed` entry, else null. With a
 * secret, a matching seal without a valid MAC is a forgery and throws instead of being trusted.
 */
export function findRecordSeal(
  events: ReadonlyArray<BetweenEvent>,
  kind: SealedRecordKind,
  cycle: number,
  secret = '',
): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i]!
    if (e.event !== RECORD_SEALED_EVENT || e.cycle !== cycle) continue
    const detail = e.detail as { record?: unknown; sha256?: unknown; mac?: unknown } | undefined
    if (detail?.record !== kind || typeof detail.sha256 !== 'string') continue
    if (secret && !macMatches(detail.mac, sealMac(secret, kind, cycle, detail.sha256))) {
      throw new RecordIntegrityError(kind, cycle, 'journal seal is not authenticated')
    }
    return detail.sha256
  }
  return null
}

/**
 * Look up the seal for (kind, cycle) from ONE journal snapshot that passes its hash chain and the
 * pinned head. Only entries inside the pinned range are considered.
 */
export async function lookupRecordSeal(
  log: EventsLog,
  pin: ChainHead | null,
  kind: SealedRecordKind,
  cycle: number,
  secret = '',
): Promise<string | null> {
  const events = await log.read()
  if (secret && events.length > 0 && !pinIsAuthentic(pin, secret)) {
    // without an authenticated pin, the whole journal (seals included) could have been rewritten
    throw new RecordIntegrityError(kind, cycle, 'journal pin is not authenticated')
  }
  const payloads = events as unknown as JournalPayload[]
  const chain = verifyChain(payloads)
  const head = verifyChainHead(payloads, pin)
  if (!chain.valid || !head.ok) {
    const reason = chain.reason ?? head.reason ?? 'invalid'
    throw new RecordIntegrityError(kind, cycle, `journal integrity check failed (${reason})`)
  }
  const pinned = pin && pin.count > 0 ? events.slice(0, pin.count) : events
  return findRecordSeal(pinned, kind, cycle, secret)
}

function macMatches(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string' || actual.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(actual, 'utf8'), Buffer.from(expected, 'utf8'))
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
