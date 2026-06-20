import type { CommandRunner } from './runner'

/**
 * B3: the `dependency_audit` policy gate. Parse `npm audit --json` (v2) into a total vulnerability
 * count. Pure parser (unit-tested) + an injected-runner wrapper so tests never spawn npm.
 */
const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'] as const

/**
 * Pure: total vulnerability count from an `npm audit --json` body. Throws on non-JSON AND on a
 * valid-JSON body that lacks a `metadata.vulnerabilities` block (e.g. an npm error payload like
 * `{"error":{"code":"ENOLOCK"}}`) — a missing block means no audit actually ran, so the caller
 * must treat it as advisory rather than a false "0 vulnerabilities / clean" (review: fail-open).
 */
export function parseNpmAudit(raw: string): number {
  const j = JSON.parse(raw) as {
    metadata?: { vulnerabilities?: Record<string, number> & { total?: number } }
  }
  const v = j?.metadata?.vulnerabilities
  if (!v) throw new Error('npm audit JSON: no metadata.vulnerabilities block (audit did not run)')
  if (typeof v.total === 'number') return v.total
  return SEVERITIES.reduce((sum, k) => sum + (typeof v[k] === 'number' ? v[k] : 0), 0)
}

/**
 * Run `npm audit --json` (exits non-zero when vulns exist, but the JSON is still on stdout) and
 * return the total count, or null when the audit can't produce a parseable result (no lockfile,
 * offline, npm missing from PATH, etc.) — in which case the gate stays advisory. The ENTIRE body
 * is guarded so a runner-level rejection (e.g. ENOENT) degrades to advisory instead of crashing
 * the caller (review: fail-open-to-crash).
 */
export async function runDepAudit(run: CommandRunner): Promise<number | null> {
  try {
    const r = await run('npm audit --json')
    return parseNpmAudit(r.stdout)
  } catch {
    return null
  }
}
