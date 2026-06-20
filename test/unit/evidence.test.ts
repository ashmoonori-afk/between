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
})
