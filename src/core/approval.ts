import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * How long a human approval stays valid (A2). An approval is additionally invalidated the moment
 * the diff/cycle/bundle changes; this TTL is a backstop so a walked-away `human_gate` approval
 * can't be pushed days later. The HMAC claim is unchanged (gateway-safe); freshness is checked
 * against live state in `verify-push` + cleared by the daemon on change.
 */
export const APPROVAL_TTL_SECONDS = 3600

/**
 * Signed human approval (trust boundary, P1-5). The cooperative `.between/` protocol lets
 * any local writer drop an `approve` command — so the broker only honors an approval whose
 * HMAC signature, over (scope, diff_hash, cycle), verifies against a secret that lives
 * OUTSIDE the agents' `.between/` write surface (an env var, or a `.git/` key). An agent
 * without the secret cannot forge a valid signature, so it cannot pass `human_gate`.
 *
 * The claim binds an approval to a SPECIFIC diff hash + cycle, so a captured signature can't
 * be replayed against a different review object.
 */
export interface ApprovalClaim {
  scope: string
  diff_hash: string | null
  cycle: number
}

function payload(claim: ApprovalClaim): string {
  return `${claim.scope}:${claim.diff_hash ?? ''}:${claim.cycle}`
}

export function signApproval(secret: string, claim: ApprovalClaim): string {
  return createHmac('sha256', secret).update(payload(claim)).digest('hex')
}

/** The freshness inputs an approval is re-checked against at push time (A2). */
export interface ApprovalFreshnessState {
  diff_hash: string | null
  cycle: number
  bundle_id: string | null
  nowMs: number
}

/**
 * A2: a valid signature is necessary but NOT sufficient — a legitimately-signed approval for an
 * old diff/cycle/bundle must not authorize a push of new content. Returns a human-readable reason
 * when the approval is stale/expired, or null when it is still fresh. Pure + unit-tested.
 */
export function approvalFreshness(
  approval: {
    diff_hash: string | null
    cycle: number
    bundle_id: string | null
    expires_at: string
  },
  state: ApprovalFreshnessState,
): string | null {
  if (approval.diff_hash !== state.diff_hash) return 'approval is for a different diff hash'
  if (approval.cycle !== state.cycle) return 'approval is for a different cycle'
  if (approval.bundle_id !== state.bundle_id)
    return 'approval is not bound to the current review bundle'
  if (!(Date.parse(approval.expires_at) > state.nowMs)) return 'approval has expired'
  return null
}

/** Constant-time verification; false on any length/format mismatch or empty secret. */
export function verifyApproval(secret: string, sig: string, claim: ApprovalClaim): boolean {
  if (!secret || !sig) return false
  const expected = signApproval(secret, claim)
  if (sig.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expected, 'utf8'))
  } catch {
    return false
  }
}
