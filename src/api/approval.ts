import type { ApprovalScope } from '../core/types'
import { signApproval, approvalExpiry } from '../core/approval'
import { APPROVAL_SCOPES } from '../core/constants'
import { StateRepository } from '../adapters/state-repository'
import { CommandBus } from '../adapters/command-bus'
import { resolveApprovalSecret } from '../adapters/approval-secret'
import { GitAdapter } from '../adapters/git'
import { loadConfig } from '../runtime'
import { BetweenApiError } from './errors'

export function parseApprovalScope(scope: string): ApprovalScope {
  if (!APPROVAL_SCOPES.includes(scope as ApprovalScope)) {
    throw new BetweenApiError(
      'invalid_argument',
      `scope must be one of: ${APPROVAL_SCOPES.join(', ')}`,
    )
  }
  return scope as ApprovalScope
}

export interface ApprovalResult {
  scope: ApprovalScope
  /** false when BETWEEN_APPROVAL_SECRET is unset, so the approval boundary is not enforced. */
  signed: boolean
  /** approved working-tree OID; a protected-branch push must carry exactly this tree. */
  tree: string | null
}

/**
 * HUMAN-ONLY: submit a signed approval bound to the current diff, cycle, bundle, and expiry.
 * Exported only from the `between-dev/human` entry; agent-facing front ends (MCP) must not
 * import it. The real boundary is the signing secret, which agent processes never receive.
 */
export async function approve(
  root: string,
  scope: ApprovalScope,
  nowMs: number = Date.now(),
): Promise<ApprovalResult> {
  await loadConfig(root)
  const state = await new StateRepository(root).read()
  const secret = resolveApprovalSecret(root)
  const bundleId = state?.diff.bundle_id ?? null
  const expiresAt = approvalExpiry(nowMs)
  const tree = await new GitAdapter(root).worktreeTree()
  const claim = {
    scope,
    diff_hash: state?.diff.hash ?? null,
    cycle: state?.workflow.cycle ?? 0,
    bundle_id: bundleId,
    expires_at: expiresAt,
    tree,
  }
  const sig = secret ? signApproval(secret, claim) : undefined
  await new CommandBus(root).submit({
    kind: 'approve',
    scope,
    sig,
    bundle_id: bundleId,
    expires_at: expiresAt,
    tree,
  })
  return { scope, signed: Boolean(secret), tree }
}
