import { buildAgentSandboxEnv } from './agent-env'

/**
 * Human approval signing secret.
 *
 * Env-only by design: broker-spawned agents have credential-looking env vars stripped, while any
 * repo-local fallback file would be readable by a local agent and could self-sign a fake approval.
 */
export const APPROVAL_SECRET_ENV = 'BETWEEN_APPROVAL_SECRET'

export function resolveApprovalSecret(_root: string): string {
  const env = process.env[APPROVAL_SECRET_ENV]
  return env && env.length > 0 ? env : ''
}

export function strippedAgentEnv(
  extra: Record<string, string>,
): Record<string, string | undefined> {
  return buildAgentSandboxEnv(extra).env
}
