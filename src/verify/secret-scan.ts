import { redactSecrets } from '../core/redact'

export interface SecretScanResult {
  /** number of secret-shaped tokens found in the ADDED lines of the diff. */
  hits: number
  /** which redaction rules matched (e.g. 'aws-access-key-id', 'env-assignment'). */
  rules: string[]
}

/**
 * B3: the `secret_scan` policy gate. Scan only the ADDED lines of the tracked patch (a secret in
 * a pre-existing context/removed line isn't being introduced by this change) using the same
 * conservative rules as the snapshot redactor. Pure + unit-tested.
 */
export function scanDiffForSecrets(trackedPatch: string): SecretScanResult {
  const added = trackedPatch
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++')) // added lines, not the +++ file header
    .map((l) => l.slice(1))
    .join('\n')
  const r = redactSecrets(added)
  return { hits: r.redactedCount, rules: r.rulesHit }
}
