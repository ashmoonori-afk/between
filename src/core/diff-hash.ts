import { createHash } from 'node:crypto'
import type { DiffInput, UntrackedEntry } from './types'

/** NUL byte separator — cannot collide with diff text. */
const NUL = String.fromCharCode(0)
const PAYLOAD_VERSION = 'BETWEEN_DIFF_V1'

/**
 * Deterministically serialize a diff into a canonical payload (I5, I15).
 *
 * Properties:
 * - Every section is always present (empty when absent) so structure can't shift.
 * - Untracked entries are sorted by path so filesystem order can't perturb the hash.
 * - NUL separators can't collide with diff text.
 * - The caller is responsible for pinning git flags (autocrlf/locale/renames) so the
 *   INPUT text is itself stable across machines; this function never re-introduces
 *   nondeterminism.
 */
export function canonicalDiffPayload(input: DiffInput): string {
  const untracked = serializeUntracked(input.untracked)
  return [
    PAYLOAD_VERSION,
    'TRACKED',
    input.tracked,
    'RAW',
    input.trackedRaw,
    'UNTRACKED',
    untracked,
  ].join(NUL)
}

function serializeUntracked(entries: readonly UntrackedEntry[]): string {
  return [...entries]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((e) => `${e.path}${NUL}${e.oid}`)
    .join(NUL)
}

/** SHA-256 hex of the canonical payload — the dedup key the same-hash guardrail relies on. */
export function hashDiff(input: DiffInput): string {
  return createHash('sha256').update(canonicalDiffPayload(input), 'utf8').digest('hex')
}

/** True when there is no tracked or untracked change at all (empty review object). */
export function isEmptyDiff(input: DiffInput): boolean {
  return (
    input.tracked.trim().length === 0 &&
    input.trackedRaw.trim().length === 0 &&
    input.untracked.length === 0
  )
}
