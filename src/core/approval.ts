import { createHmac, timingSafeEqual } from 'node:crypto'

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
