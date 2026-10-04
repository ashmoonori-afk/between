import { redactSecrets } from '../core/redact'
import type { ReviewBundle } from '../review/bundle'

export interface SecretScanResult {
  /** number of secret-shaped tokens found in newly introduced text. */
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
  let hits = 0
  const rules = new Set<string>()
  for (const file of trackedPatch.split(/^diff --git /m)) {
    const added: string[] = []
    let inHunk = false
    for (const line of file.split('\n')) {
      if (line.startsWith('@@ ')) inHunk = true
      // A +++ file header precedes hunks; inside a hunk, ++ is literal added text.
      if (line.startsWith('+') && (inHunk || !line.startsWith('+++ '))) {
        added.push(line.slice(1))
      }
    }
    const scan = redactSecrets(added.join('\n'))
    hits += scan.redactedCount
    for (const rule of scan.rulesHit) rules.add(rule)
  }
  return { hits, rules: [...rules] }
}

/** Scan only immutable captured content, keeping each untracked file's text separate. */
export function scanBundleForSecrets(
  bundle: ReviewBundle,
): SecretScanResult & { incomplete: boolean } {
  const tracked = scanDiffForSecrets(bundle.diff.tracked)
  let hits = tracked.hits
  const rules = new Set(tracked.rules)
  let incomplete = false
  for (const entry of bundle.diff.untracked) {
    const payload = bundle.payloads.find((p) => p.path === entry.path && p.oid === entry.oid)
    if (!payload) {
      incomplete = true
      continue
    }
    const bytes = Buffer.from(payload.content, 'base64')
    const text = bytes.toString('utf8')
    // Match captureUntrackedPayloads' existing text scope; captured binary is not missing.
    if (bytes.includes(0) || text.includes('\uFFFD')) continue
    const scan = redactSecrets(text)
    hits += scan.redactedCount
    for (const rule of scan.rulesHit) rules.add(rule)
  }
  return { hits, rules: [...rules], incomplete }
}
