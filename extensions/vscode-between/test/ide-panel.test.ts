import { describe, expect, it } from 'vitest'
import { buildBetweenIdeViewModel, renderBetweenIdeHtml } from '../src/ide-panel.js'

describe('IDE panel rendering', () => {
  it('renders a broker-first IDE shell without exposing raw review HTML', () => {
    const view = {
      project: '<demo>',
      phase: 'human_gate',
      cycle: 3,
      cyclesThisGoal: 1,
      bundleId: 'b'.repeat(64),
      diffHash: 'd'.repeat(64),
      evidenceVerdict: 'blocked',
      evidenceTrust: 'real',
      canApprove: true,
      ideProfile: {
        builderAgentCount: 3,
        reviewerAgentCount: 2,
        rulesMode: 'project_only',
        permissionMode: 'guard',
        workingFolder: 'packages/<app>',
        followupMode: 'queue',
        panes: [
          { id: 'builder-1', label: 'Builder 1', target: 'builder:1', role: 'builder' },
          {
            id: 'reviewer-1',
            label: 'Reviewer 1',
            target: 'reviewer:<script>1</script>',
            role: 'reviewer',
          },
        ],
      },
      developer: 'claude',
      developerStatus: 'working',
      reviewer: 'codex',
      reviewerStatus: 'reviewing_diff',
      waitingOn: 'human',
      changedFiles: 2,
      model: {
        findings: [
          {
            finding: {
              id: 'F1',
              severity: 'blocking',
              summary: '<script>alert(1)</script>',
            },
            location: { file: 'src/app.ts', line: 4 },
            stale: false,
            linked: true,
          },
        ],
      },
    }

    const model = buildBetweenIdeViewModel(view)
    const html = renderBetweenIdeHtml(view, 'fixednonce')

    expect(model.blocking).toBe(1)
    expect(html).toContain('data-between-ide')
    expect(html).toContain('Broker command')
    expect(html).toContain('Builder agents')
    expect(html).toContain('Reviewer agents')
    expect(html).toContain('Global rules bypassed')
    expect(html).toContain('Permission mode')
    expect(html).toContain('Follow-up mode')
    expect(html).toContain('Working folder')
    expect(html).toContain('packages/&lt;app&gt;')
    expect(html).toContain('Broker policy enforced')
    expect(html).toContain('builder:1')
    expect(html).toContain('reviewer:&lt;script&gt;1&lt;/script&gt;')
    expect(html).toContain('&lt;demo&gt;')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>alert(1)</script>')
  })
})
