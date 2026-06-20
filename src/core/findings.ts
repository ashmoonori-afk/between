import { z } from 'zod'
import type { Finding, ReviewRecord, VerifyRecord } from './types'

/**
 * Blocking vs non-blocking finding logic (I13). The blueprint terminated the loop on
 * "no blocking findings" but never defined a schema, parser, or authority. Here:
 * severity is a typed field SET BY THE REVIEWER, the cycle-end condition is computed
 * from structured data (not a magic string), and a disputed/malformed record is a
 * hard error the caller routes to human_gate.
 */

export const FindingSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(['blocking', 'non-blocking']),
  summary: z.string(),
  agent: z.string().min(1).optional(),
  target_hash: z.string().min(1),
})

export const ReviewRecordSchema = z.object({
  cycle: z.number().int().nonnegative(),
  diff_hash: z.string().min(1),
  findings: z.array(FindingSchema),
  complete: z.boolean(),
})

export const VerifyRecordSchema = z.object({
  diff_hash: z.string().min(1),
  passed: z.boolean(),
  summary: z.string().default(''),
})

export function parseReviewRecord(raw: unknown): ReviewRecord {
  return ReviewRecordSchema.parse(raw)
}

export function parseVerifyRecord(raw: unknown): VerifyRecord {
  return VerifyRecordSchema.parse(raw)
}

export function countBlocking(findings: readonly Finding[]): number {
  return findings.reduce((n, f) => (f.severity === 'blocking' ? n + 1 : n), 0)
}

/** A review is clean when it is complete and carries no blocking findings. */
export function reviewIsClean(review: Pick<ReviewRecord, 'findings' | 'complete'>): boolean {
  return review.complete && countBlocking(review.findings) === 0
}

/**
 * Cycle-end condition #2 (§7.2): the loop may end only when the review is clean AND
 * verification passed for the SAME diff hash. Mismatched hashes never satisfy it (I14).
 */
export function cycleShouldEnd(
  review: Pick<ReviewRecord, 'findings' | 'complete' | 'diff_hash'>,
  verify: Pick<VerifyRecord, 'passed' | 'diff_hash'> | null,
): boolean {
  if (!reviewIsClean(review)) return false
  if (verify === null) return false
  if (verify.diff_hash !== review.diff_hash) return false
  return verify.passed
}

/** Whether a review record is the one we are waiting for: complete + matching hash (I8). */
export function reviewMatchesCurrent(
  review: Pick<ReviewRecord, 'complete' | 'diff_hash'>,
  currentHash: string,
): boolean {
  return review.complete && review.diff_hash === currentHash
}
