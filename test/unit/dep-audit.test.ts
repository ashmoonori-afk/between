import { describe, it, expect } from 'vitest'
import { parseNpmAudit, runDepAudit } from '../../src/verify/dep-audit'
import type { CommandRunner } from '../../src/verify/runner'

describe('parseNpmAudit (B3)', () => {
  it('reads metadata.vulnerabilities.total from an npm audit --json (v2) body', () => {
    const raw = JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: {},
      metadata: {
        vulnerabilities: { info: 0, low: 1, moderate: 0, high: 2, critical: 0, total: 3 },
      },
    })
    expect(parseNpmAudit(raw)).toBe(3)
  })

  it('a clean audit reports zero', () => {
    const raw = JSON.stringify({
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
      },
    })
    expect(parseNpmAudit(raw)).toBe(0)
  })

  it('falls back to summing severity buckets when total is absent', () => {
    const raw = JSON.stringify({
      metadata: { vulnerabilities: { info: 0, low: 2, moderate: 1, high: 0, critical: 1 } },
    })
    expect(parseNpmAudit(raw)).toBe(4)
  })

  it('throws when the vulnerabilities block is missing (no false "clean" — review fail-open)', () => {
    // an npm error payload is valid JSON but carries no metadata.vulnerabilities -> must throw,
    // so the caller degrades to advisory rather than reporting a fabricated 0.
    expect(() => parseNpmAudit(JSON.stringify({ error: { code: 'ENOLOCK' } }))).toThrow()
    expect(() => parseNpmAudit(JSON.stringify({ metadata: {} }))).toThrow()
    expect(() => parseNpmAudit(JSON.stringify({}))).toThrow()
  })

  it('throws on a non-JSON body (caller decides advisory vs hard)', () => {
    expect(() => parseNpmAudit('npm error code ENOLOCK')).toThrow()
  })
})

describe('runDepAudit (B3)', () => {
  it('returns the total count from the injected runner (never spawns)', async () => {
    const run: CommandRunner = async (command) => {
      expect(command).toBe('npm audit --json')
      // npm audit exits non-zero when vulns exist, but the JSON is still on stdout.
      return {
        exitCode: 1,
        stdout: JSON.stringify({ metadata: { vulnerabilities: { total: 5 } } }),
        stderr: '',
      }
    }
    expect(await runDepAudit(run)).toBe(5)
  })

  it('returns null (advisory) when the audit output is not parseable', async () => {
    const run: CommandRunner = async () => ({
      exitCode: 1,
      stdout: 'npm error code ENOLOCK\nThis command requires an existing lockfile.',
      stderr: '',
    })
    expect(await runDepAudit(run)).toBeNull()
  })

  it('returns null (advisory) for an npm error JSON body — no false clean (review HIGH)', async () => {
    const run: CommandRunner = async () => ({
      exitCode: 1,
      stdout: JSON.stringify({ error: { code: 'ENOLOCK', summary: 'no lockfile' } }),
      stderr: '',
    })
    expect(await runDepAudit(run)).toBeNull()
  })

  it('returns null (advisory) when the runner itself rejects, e.g. npm not on PATH (review CRITICAL)', async () => {
    const run: CommandRunner = async () => {
      throw new Error('spawn npm ENOENT')
    }
    expect(await runDepAudit(run)).toBeNull()
  })
})
