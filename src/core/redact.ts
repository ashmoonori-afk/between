/**
 * Secret scrubbing (I17). The full diff is captured into snapshots, events, and the
 * Obsidian mirror — a secret-spreading surface. This module redacts well-known secret
 * shapes BEFORE the first snapshot write. It is intentionally conservative: it favors
 * redacting a borderline token over leaking one, and reports how many it redacted.
 *
 * This is defense-in-depth, not a guarantee — the real mitigation is keeping untracked
 * files (where .env lives) out of the review object by default (config.review_untracked).
 */

const REDACTED = '[REDACTED]'

interface SecretRule {
  name: string
  source: string
  flags: string
  /** replace the whole match, or just capture group 1 (the value) */
  group?: 1
}

const rule = (name: string, re: RegExp, group?: 1): SecretRule => ({
  name,
  source: re.source,
  flags: re.flags,
  ...(group ? { group } : {}),
})

const RULES: readonly SecretRule[] = [
  rule(
    'private-key-block',
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  ),
  rule('aws-access-key-id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g),
  rule('github-token', /\bgh[pousr]_[A-Za-z0-9]{20,255}\b/g),
  rule('slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g),
  rule('ai-api-key', /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}\b/g),
  rule('stripe-key', /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g),
  rule('sendgrid-key', /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g),
  rule('google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g),
  rule('jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g),
  // connection-string password: proto://user:PASSWORD@host  (value = group 1)
  rule('connection-string', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:([^\s@/]+)@/gi, 1),
  // KEY=VALUE / KEY: VALUE for sensitive-looking names incl. *_KEY / ENCRYPTION_KEY (value = group 1)
  rule(
    'env-assignment',
    /(?:[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|_KEY)|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|ENCRYPTION[_-]?KEY|CLIENT[_-]?SECRET)\s*[:=]\s*['"]?([^\s'"]{6,})['"]?/gi,
    1,
  ),
]

export interface RedactionResult {
  text: string
  redactedCount: number
  rulesHit: string[]
}

export function redactSecrets(input: string): RedactionResult {
  let text = input
  let redactedCount = 0
  const rulesHit = new Set<string>()

  for (const r of RULES) {
    // fresh RegExp per call so the shared rule definitions can never carry `lastIndex` state (M3)
    const re = new RegExp(r.source, r.flags)
    text = text.replace(re, (match: string, value?: string) => {
      redactedCount += 1
      rulesHit.add(r.name)
      if (r.group === 1 && typeof value === 'string' && value.length > 0) {
        // keep the surrounding key text; redact EVERY occurrence of the value (M3)
        return match.split(value).join(REDACTED)
      }
      return REDACTED
    })
  }

  return { text, redactedCount, rulesHit: [...rulesHit] }
}

/** Convenience: true when the text contains anything we would redact. */
export function containsSecret(input: string): boolean {
  return redactSecrets(input).redactedCount > 0
}
