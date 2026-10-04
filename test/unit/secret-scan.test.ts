import { describe, it, expect } from 'vitest'
import { scanDiffForSecrets } from '../../src/verify/secret-scan'

describe('scanDiffForSecrets (B3)', () => {
  it('flags a secret introduced in an ADDED line', () => {
    const patch = [
      'diff --git a/x b/x',
      '+++ b/x',
      '+const k = "AKIAIOSFODNN7EXAMPLE"',
      ' unchanged context',
    ].join('\n')
    const r = scanDiffForSecrets(patch)
    expect(r.hits).toBeGreaterThan(0)
    expect(r.rules).toContain('aws-access-key-id')
  })

  it('ignores secrets in context/removed lines and the +++ header', () => {
    const patch = [
      ' const k = "AKIAIOSFODNN7EXAMPLE"', // context (unchanged) -> ignored
      '-const j = "AKIAIOSFODNN7EXAMPLE"', // removed -> ignored
      '+++ b/AKIAIOSFODNN7EXAMPLE', // file header -> ignored
    ].join('\n')
    expect(scanDiffForSecrets(patch).hits).toBe(0)
  })

  it.each(['++', '++ ', '++ b/'])('scans added text starting with %s inside a hunk', (prefix) => {
    const patch = [
      'diff --git a/x b/x',
      '--- a/x',
      '+++ b/x',
      '@@ -0,0 +1 @@',
      `+${prefix}AKIAIOSFODNN7EXAMPLE`,
    ].join('\n')
    const result = scanDiffForSecrets(patch)
    expect(result).toEqual({ hits: 1, rules: ['aws-access-key-id'] })
  })

  it('ignores a real secret-shaped file header before a clean hunk', () => {
    const patch = [
      'diff --git a/x b/AKIAIOSFODNN7EXAMPLE',
      '--- a/x',
      '+++ b/AKIAIOSFODNN7EXAMPLE',
      '@@ -0,0 +1 @@',
      '+ordinary clean text',
    ].join('\n')
    expect(scanDiffForSecrets(patch)).toEqual({ hits: 0, rules: [] })
  })

  it('does not join private-key delimiters from separate tracked files', () => {
    const patch = [
      'diff --git a/x b/x',
      '+++ b/x',
      '@@ -0,0 +1 @@',
      '+-----BEGIN PRIVATE KEY-----',
      'diff --git a/y b/y',
      '+++ b/y',
      '@@ -0,0 +1 @@',
      '+-----END PRIVATE KEY-----',
    ].join('\n')
    expect(scanDiffForSecrets(patch)).toEqual({ hits: 0, rules: [] })
  })

  it('detects a private-key block across added hunks of the same tracked file', () => {
    const patch = [
      'diff --git a/x b/x',
      '+++ b/x',
      '@@ -0,0 +1 @@',
      '+-----BEGIN PRIVATE KEY-----',
      '@@ -4,0 +5 @@',
      '+-----END PRIVATE KEY-----',
    ].join('\n')
    expect(scanDiffForSecrets(patch)).toEqual({ hits: 1, rules: ['private-key-block'] })
  })
})
