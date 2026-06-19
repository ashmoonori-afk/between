import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Resolves the approval secret used to sign/verify human approvals (P1-5). Order:
 *  1. `BETWEEN_APPROVAL_SECRET` env — the STRONG path: the human's shell has it; agents
 *     spawned by the broker do NOT (the transports strip it from the child env).
 *  2. `.git/between-approval.key` — a generated fallback that lives in `.git/`, outside the
 *     agents' `.between/` write surface. Only as strong as `.git` access; prefer the env var.
 */
export const APPROVAL_SECRET_ENV = 'BETWEEN_APPROVAL_SECRET'

function keyPath(root: string): string {
  return join(root, '.git', 'between-approval.key')
}

/** Read the secret if provisioned; '' when neither the env nor the key file exists. */
export function resolveApprovalSecret(root: string): string {
  const env = process.env[APPROVAL_SECRET_ENV]
  if (env && env.length > 0) return env
  const p = keyPath(root)
  if (existsSync(p)) {
    try {
      return readFileSync(p, 'utf8').trim()
    } catch {
      return ''
    }
  }
  return ''
}

/**
 * Build the env for a spawned agent with the approval secret REMOVED, so an agent the broker
 * launches never inherits the human's signing key (P1-5). The `.git/` key fallback is still
 * readable from disk by a fully-local agent, so the env var is the genuinely-isolated path.
 */
export function strippedAgentEnv(
  extra: Record<string, string>,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, ...extra }
  delete env[APPROVAL_SECRET_ENV]
  return env
}

/** Resolve, generating + persisting a `.git/` key when no env/key exists yet (used by init). */
export function ensureApprovalSecret(root: string): string {
  const existing = resolveApprovalSecret(root)
  if (existing) return existing
  const secret = randomBytes(32).toString('hex')
  try {
    mkdirSync(join(root, '.git'), { recursive: true })
    writeFileSync(keyPath(root), secret, 'utf8')
  } catch {
    // not a git repo / unwritable .git — caller falls back to cooperative (unsigned) mode
    return ''
  }
  return secret
}
