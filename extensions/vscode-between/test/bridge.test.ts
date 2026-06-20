import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

describe('vscode-between scaffold', () => {
  it('bridge package exposes local-only Between commands', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8')) as {
      main: string
      scripts: Record<string, string>
      activationEvents: string[]
      contributes: { commands: Array<{ command: string; title: string }> }
    }

    expect(pkg.main).toBe('./src/extension.js')
    expect(pkg.activationEvents).toContain('onView:between.panel')
    expect(pkg.activationEvents).toContain('onCommand:between.refresh')
    expect(pkg.scripts.check).toContain('test:host')
    expect(pkg.scripts['test:host']).toContain('vscode-test --label task-9-diagnostics')
    expect(pkg.contributes.views.scm).toEqual([{ id: 'between.panel', name: 'Between' }])
    expect(pkg.contributes.commands.map((command) => command.command)).toEqual([
      'between.refresh',
      'between.openEvidence',
      'between.requestSecondReview',
      'between.askDeveloperToFix',
      'between.approveExactBundle',
    ])
  })
})
