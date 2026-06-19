import { describe, it, expect } from 'vitest'
import { redactSecrets, containsSecret } from '../../src/core/redact'

describe('redact', () => {
  it('redacts a PEM private key block', () => {
    const text =
      '-----BEGIN OPENSSH PRIVATE KEY-----\nabc123secretmaterial\n-----END OPENSSH PRIVATE KEY-----'
    const r = redactSecrets(text)
    expect(r.text).toContain('[REDACTED]')
    expect(r.text).not.toContain('secretmaterial')
    expect(r.redactedCount).toBeGreaterThan(0)
  })

  it('redacts an AWS access key id', () => {
    const r = redactSecrets('aws_key = AKIAIOSFODNN7EXAMPLE rest')
    expect(r.text).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(r.rulesHit).toContain('aws-access-key-id')
  })

  it('redacts only the value of a sensitive assignment, keeping the key', () => {
    const r = redactSecrets('API_KEY=supersecretvalue123')
    expect(r.text).toContain('API_KEY=')
    expect(r.text).toContain('[REDACTED]')
    expect(r.text).not.toContain('supersecretvalue123')
  })

  it('redacts a github token', () => {
    expect(containsSecret('ghp_' + 'a'.repeat(36))).toBe(true)
  })

  it('leaves ordinary code untouched', () => {
    const code = 'function add(a, b) {\n  return a + b // simple\n}'
    const r = redactSecrets(code)
    expect(r.text).toBe(code)
    expect(r.redactedCount).toBe(0)
    expect(containsSecret(code)).toBe(false)
  })
})
