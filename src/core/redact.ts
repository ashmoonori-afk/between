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
  pattern: RegExp
  /** replace the whole match, or just capture group 1 (the value) */
  group?: 1
}

const RULES: readonly SecretRule[] = [
  // PEM private key blocks
  {
    name: 'private-key-block',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  // AWS access key id
  { name: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  // GitHub tokens
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,255}\b/g },
  // Slack tokens
  { name: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  // OpenAI / Anthropic style keys
  { name: 'ai-api-key', pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}\b/g },
  // JWT
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  // Generic KEY=VALUE / KEY: VALUE for sensitive-looking names (value is group 1)
  {
    name: 'env-assignment',
    pattern:
      /(?:SECRET|TOKEN|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|CLIENT[_-]?SECRET)[A-Z0-9_]*\s*[:=]\s*['"]?([^\s'"]{6,})['"]?/gi,
    group: 1,
  },
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

  for (const rule of RULES) {
    text = text.replace(rule.pattern, (match: string, value?: string) => {
      redactedCount += 1
      rulesHit.add(rule.name)
      if (rule.group === 1 && typeof value === 'string') {
        // keep the surrounding key text, redact only the value
        return match.replace(value, REDACTED)
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
