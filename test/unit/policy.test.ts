import { describe, it, expect } from 'vitest'
import { DEFAULT_POLICY, parsePolicy } from '../../src/policy/schema'
import {
  globMatch,
  classifyRisk,
  evaluatePolicy,
  changedPathsFromRaw,
  type PolicyInput,
} from '../../src/policy/engine'

const ok: PolicyInput = { changedPaths: ['src/util/x.ts'], blockingFindings: 0, verifyPassed: true }

describe('globMatch', () => {
  it('** spans directories, * does not', () => {
    expect(globMatch('src/auth/**', 'src/auth/login.ts')).toBe(true)
    expect(globMatch('src/auth/**', 'src/auth/sub/deep.ts')).toBe(true)
    expect(globMatch('**/*.key', 'a/b/c.key')).toBe(true)
    expect(globMatch('src/*.ts', 'src/sub/x.ts')).toBe(false) // * must not cross /
    expect(globMatch('src/auth/**', 'src/util/x.ts')).toBe(false)
  })

  it('leading **/ matches ROOT-level files (review: no policy bypass)', () => {
    expect(globMatch('**/*.key', 'secret.key')).toBe(true) // root-level .key
    expect(globMatch('**/secrets/**', 'secrets/api.key')).toBe(true)
  })

  it('normalizes backslash + leading ./ globs and paths (review: no bypass)', () => {
    expect(globMatch('src\\auth\\**', 'src/auth/login.ts')).toBe(true) // backslash glob
    expect(globMatch('./src/auth/**', 'src/auth/login.ts')).toBe(true) // leading ./ glob
    expect(globMatch('src/auth/**', 'src\\auth\\login.ts')).toBe(true) // backslash path
  })

  it('rejects ReDoS-shaped globs (too many wildcards)', () => {
    expect(() => globMatch('a*a*a*a*a*a*a*a*a*a*a*a*a*b', 'x')).toThrow(/wildcards/)
  })
})

describe('classifyRisk', () => {
  it('high when any changed path matches a high_risk glob, else normal', () => {
    expect(classifyRisk(DEFAULT_POLICY, ['src/auth/login.ts'])).toBe('high')
    expect(classifyRisk(DEFAULT_POLICY, ['README.md', 'config/app.key'])).toBe('high')
    expect(classifyRisk(DEFAULT_POLICY, ['src/util/x.ts', 'README.md'])).toBe('normal')
  })
})

describe('evaluatePolicy', () => {
  it('normal change, clean review, verify passed -> satisfied with 1 reviewer', () => {
    const e = evaluatePolicy(DEFAULT_POLICY, ok)
    expect(e.risk).toBe('normal')
    expect(e.satisfied).toBe(true)
    expect(e.requiredApprovals).toEqual({ reviewers: 1, local_human_required: false })
  })

  it('high-risk change requires 2 reviewers + a local human', () => {
    const e = evaluatePolicy(DEFAULT_POLICY, { ...ok, changedPaths: ['src/auth/login.ts'] })
    expect(e.risk).toBe('high')
    expect(e.requiredApprovals).toEqual({ reviewers: 2, local_human_required: true })
  })

  it('blocking findings fail the no_blocking_findings gate (BLOCKED)', () => {
    const e = evaluatePolicy(DEFAULT_POLICY, { ...ok, blockingFindings: 2 })
    expect(e.satisfied).toBe(false)
    expect(e.gates.find((g) => g.name === 'no_blocking_findings')?.status).toBe('fail')
  })

  it('a missing/failed verification fails the verification gate', () => {
    expect(evaluatePolicy(DEFAULT_POLICY, { ...ok, verifyPassed: false }).satisfied).toBe(false)
    expect(evaluatePolicy(DEFAULT_POLICY, { ...ok, verifyPassed: null }).satisfied).toBe(false)
  })

  it('secret_scan is advisory when not run, but enforced once a scan result is supplied (B3)', () => {
    const high = ['src/auth/x.ts'] // high risk -> gate set includes secret_scan
    // not run -> advisory (not_enforced), does not block
    const naEval = evaluatePolicy(DEFAULT_POLICY, { ...ok, changedPaths: high })
    expect(naEval.gates.find((g) => g.name === 'secret_scan')?.status).toBe('not_enforced')
    expect(naEval.satisfied).toBe(true)
    // scanned, 0 hits -> pass
    expect(
      evaluatePolicy(DEFAULT_POLICY, { ...ok, changedPaths: high, secretScanHits: 0 }).gates.find(
        (g) => g.name === 'secret_scan',
      )?.status,
    ).toBe('pass')
    // scanned, hits -> fail -> BLOCKED
    const failEval = evaluatePolicy(DEFAULT_POLICY, {
      ...ok,
      changedPaths: high,
      secretScanHits: 2,
    })
    expect(failEval.gates.find((g) => g.name === 'secret_scan')?.status).toBe('fail')
    expect(failEval.satisfied).toBe(false)
  })
})

describe('changedPathsFromRaw + parsePolicy', () => {
  it('extracts paths from a git diff --raw body', () => {
    const raw = ':100644 100644 aaa bbb M\tsrc/auth/login.ts\n:000000 100644 000 ccc A\tREADME.md'
    expect(changedPathsFromRaw(raw)).toEqual(['src/auth/login.ts', 'README.md'])
  })

  it('rejects an unknown policy key (strict)', () => {
    expect(() => parsePolicy({ bogus: 1 })).toThrow(/Invalid policy/)
  })

  it('rejects an unknown/typo gate name (review: no silent fail-open)', () => {
    expect(() => parsePolicy({ gates: { high: ['verifiction'], normal: [] } })).toThrow(
      /Invalid policy/,
    )
  })
})
