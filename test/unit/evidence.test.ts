import { describe, it, expect } from 'vitest'
import {
  buildEvidenceManifest,
  toMarkdown,
  type EvidenceManifestInput,
} from '../../src/evidence/manifest'

const project = { name: 'demo', root: '/x', obsidian_project_path: null }
const bundle = {
  schema_version: 2,
  bundle_id: 'b'.repeat(64),
  diff_hash: 'd'.repeat(64),
  diff: { tracked: '', trackedRaw: '', untracked: [] },
  repository: { head_sha: 'a'.repeat(40), branch: 'main', index_tree: 't' },
  environment: { between_version: '0.1.0', git_version: 'git', attributes_hash: '' },
  payloads: [],
}
const base: EvidenceManifestInput = {
  project,
  cycle: 2,
  phase: 'human_gate',
  evidenceTrust: 'real',
  developer: 'claude',
  reviewer: 'codex',
  generatedAt: '2026-06-20T00:00:00.000Z',
  bundle,
  review: { cycle: 2, diff_hash: 'd'.repeat(64), findings: [], complete: true },
  verify: { diff_hash: 'd'.repeat(64), passed: true, summary: 'ok' },
  verification: {
    allPassed: false,
    checks: [
      { name: 'typecheck', status: 'pass', exitCode: 0, summary: 'ok', durationMs: 12 },
      { name: 'tests', status: 'fail', exitCode: 1, summary: '1 failed', durationMs: 340 },
    ],
  },
  approval: {
    actor: 'human',
    scope: 'merge',
    diff_hash: 'd'.repeat(64),
    cycle: 2,
    granted_at: '2026-06-20T00:00:00.000Z',
    sig: 'sig',
    bundle_id: 'b'.repeat(64),
    expires_at: '2026-06-20T01:00:00.000Z',
  },
}

describe('buildEvidenceManifest', () => {
  it('binds bundle + verdict approved for a signed merge approval', () => {
    const m = buildEvidenceManifest(base)
    expect(m.verdict).toBe('approved')
    expect(m.bundle?.bundle_id).toBe('b'.repeat(64))
    expect(m.approval?.signed).toBe(true)
    expect(m.agents).toEqual({ developer: 'claude', reviewer: 'codex' })
  })

  it('folds optional usage telemetry into the manifest without estimating missing data', () => {
    const m = buildEvidenceManifest({
      ...base,
      usage: {
        input_tokens: 1000,
        output_tokens: 240,
        total_tokens: 1240,
        cost_usd: 0.0198,
        entries: [
          {
            role: 'reviewer',
            provider: 'codex',
            model: 'gpt-5-codex',
            input_tokens: 1000,
            output_tokens: 240,
            total_tokens: 1240,
            cost_usd: 0.0198,
          },
        ],
      },
    })

    expect(m.usage).toEqual({
      input_tokens: 1000,
      output_tokens: 240,
      total_tokens: 1240,
      cost_usd: 0.0198,
      entries: [
        {
          role: 'reviewer',
          provider: 'codex',
          model: 'gpt-5-codex',
          input_tokens: 1000,
          output_tokens: 240,
          total_tokens: 1240,
          cost_usd: 0.0198,
        },
      ],
    })
  })

  it('verdict is simulated when evidence_trust is simulated, regardless of approval', () => {
    expect(buildEvidenceManifest({ ...base, evidenceTrust: 'simulated' }).verdict).toBe('simulated')
  })

  it('verdict is blocked when there are blocking findings and no merge approval', () => {
    const m = buildEvidenceManifest({
      ...base,
      approval: null,
      review: {
        cycle: 2,
        diff_hash: 'd'.repeat(64),
        findings: [{ id: 'F1', severity: 'blocking', summary: 'bug', target_hash: 'd'.repeat(64) }],
        complete: true,
      },
    })
    expect(m.verdict).toBe('blocked')
    expect(m.findings.blocking).toBe(1)
  })

  it('verdict is pending when clean but unapproved', () => {
    expect(buildEvidenceManifest({ ...base, approval: null }).verdict).toBe('pending')
  })

  it('folds the structured verify report: per-check pass/fail + passed/total counts', () => {
    const m = buildEvidenceManifest(base)
    expect(m.verification).toEqual({
      all_passed: false,
      passed: 1,
      total: 2,
      checks: [
        { name: 'typecheck', status: 'pass', duration_ms: 12 },
        { name: 'tests', status: 'fail', duration_ms: 340 },
      ],
    })
  })

  it('verification is null when no report was produced', () => {
    expect(buildEvidenceManifest({ ...base, verification: null }).verification).toBeNull()
  })
})

describe('toMarkdown', () => {
  it('renders the key sections', () => {
    const md = toMarkdown(buildEvidenceManifest(base))
    expect(md).toMatch(/# Evidence - demo \| cycle 2/)
    expect(md).toMatch(/Verdict:\*\* approved/)
    expect(md).toMatch(/Review object \(immutable bundle\)/)
    expect(md).toMatch(/bundle_id: `b{64}`/)
    expect(md).toMatch(/## Approval/)
  })

  it('renders the structured verification section with per-check lines (ASCII only)', () => {
    const md = toMarkdown(buildEvidenceManifest(base))
    expect(md).toMatch(/## Verification checks \(between verify\)/)
    expect(md).toMatch(/- FAIL - 1\/2 checks passed/)
    expect(md).toMatch(/\[pass\] typecheck \(12ms\)/)
    expect(md).toMatch(/\[fail\] tests \(340ms\)/)
    // eslint-disable-next-line no-control-regex
    expect(md).not.toMatch(/[^\x00-\x7f]/) // no mojibake / non-ASCII
  })

  it('shows "not run" when no verify report exists', () => {
    const md = toMarkdown(buildEvidenceManifest({ ...base, verification: null }))
    expect(md).toMatch(/## Verification checks \(between verify\)\n- _not run_/)
  })

  it('renders usage telemetry when recorded, and an honest empty state otherwise', () => {
    const md = toMarkdown(
      buildEvidenceManifest({
        ...base,
        usage: {
          input_tokens: 1000,
          output_tokens: 240,
          total_tokens: 1240,
          cost_usd: 0.0198,
          entries: [
            {
              role: 'reviewer',
              provider: 'codex',
              model: 'gpt-5-codex',
              input_tokens: 1000,
              output_tokens: 240,
              total_tokens: 1240,
              cost_usd: 0.0198,
            },
          ],
        },
      }),
    )

    expect(md).toMatch(/## Usage/)
    expect(md).toMatch(/- tokens: 1240 \(input 1000, output 240\)/)
    expect(md).toMatch(/- cost_usd: 0\.0198/)
    expect(md).toMatch(/- reviewer codex\/gpt-5-codex: 1240 tokens, cost_usd 0\.0198/)
    expect(toMarkdown(buildEvidenceManifest(base))).toMatch(/## Usage\n- _not recorded_/)
  })
})
