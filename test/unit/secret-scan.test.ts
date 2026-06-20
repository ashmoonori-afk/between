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
})
