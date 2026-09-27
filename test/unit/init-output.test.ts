import { describe, expect, it } from 'vitest'
import { formatInitResult } from '../../src/cli/setup-commands'
import type { InitResult } from '../../src/adapters/init-project'

const base: InitResult = {
  created: ['/r/.between', '/r/.between/config.yaml', '/r/.between/state.json'],
  alreadyExisted: false,
  project: { name: 'app', root: '/r', obsidian_project_path: null },
  developer: 'fake',
  reviewer: 'fake',
  simulated: true,
  hook: { kind: 'installed', path: '/r/.git/hooks/pre-push' },
}

describe('formatInitResult', () => {
  it('summarizes instead of listing every path, and explains simulation mode', () => {
    const out = formatInitResult(base).join('\n')
    expect(out).toMatch(/^between: initialized app \(3 paths created\)/)
    expect(out).not.toContain('/r/.between/config.yaml')
    expect(out).toMatch(/SIMULATION/)
    expect(out).toMatch(/next: {4}between goal/)
    expect(out).toMatch(/between init --developer claude --reviewer codex/)
    expect(out).not.toMatch(/onboard/)
  })

  it('lists created paths with --verbose', () => {
    expect(formatInitResult(base, { verbose: true })).toContain('  + /r/.between/config.yaml')
  })

  it('does not suggest real agents or simulation for a real setup', () => {
    const out = formatInitResult({
      ...base,
      developer: 'claude',
      reviewer: 'codex',
      simulated: false,
    }).join('\n')
    expect(out).not.toMatch(/SIMULATION|real agents:/)
    expect(out).toMatch(/hosts the developer and reviewer agents/)
  })

  it('warns when the pre-push gate is not active', () => {
    expect(formatInitResult({ ...base, hook: { kind: 'not_git_repo' } }).join('\n')).toMatch(
      /not a git repository.*git init/,
    )
    expect(
      formatInitResult({
        ...base,
        hook: { kind: 'conflict', path: '/r/.git/hooks/pre-push' },
      }).join('\n'),
    ).toMatch(/existing pre-push hook was kept.*NOT active/)
  })
})
