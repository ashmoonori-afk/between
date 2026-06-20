import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitAdapter } from '../../src/adapters/git'
import { WorktreeProvider } from '../../src/adapters/worktree'
import { captureBundle } from '../../src/review/store'
import { materializeBundle, REVIEWER_WORKTREE } from '../../src/review/materialize'
import {
  buildSandboxedAgentEnv,
  readSandboxManifest,
  sandboxManifestPath,
} from '../../src/adapters/sandbox'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-sandbox-'))
  await execa('git', ['init', '-b', 'main'], { cwd: dir })
  await execa('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
  await execa('git', ['config', 'user.name', 't'], { cwd: dir })
  await writeFile(join(dir, 'a.txt'), 'committed\n')
  await execa('git', ['add', '-A'], { cwd: dir })
  await execa('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'init'], { cwd: dir })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

describe('reviewer sandbox', () => {
  it('materializes a sealed read-only reviewer worktree and manifest', async () => {
    await writeFile(join(dir, 'a.txt'), 'sealed\n')
    const bundle = await captureBundle(
      new GitAdapter(dir),
      { reviewUntracked: false, untrackedGlobs: [] },
      '0.1.0',
    )
    const wp = new WorktreeProvider(dir)
    const path = await materializeBundle(bundle, wp)
    try {
      expect(await readFile(join(path, 'a.txt'), 'utf8')).toBe('sealed\n')
      await expect(writeFile(join(path, 'a.txt'), 'mutated\n')).rejects.toThrow()
      expect(existsSync(sandboxManifestPath(dir, 'reviewer'))).toBe(true)
      const manifest = await readSandboxManifest(dir, 'reviewer')
      expect(manifest?.readonly.applied).toBe(true)
      expect(manifest?.network.denied).toBe(true)
      expect(manifest?.push_credentials).toBe(false)
    } finally {
      await wp.remove(REVIEWER_WORKTREE)
    }
  })

  it('strips push credentials and sets best-effort network-deny env', () => {
    const sandbox = buildSandboxedAgentEnv('reviewer', dir, {
      Path: 'C:/Windows/System32',
      GITHUB_TOKEN: 'ghp_secret',
      BETWEEN_APPROVAL_SECRET: 'approval-secret',
      SSH_AUTH_SOCK: '/tmp/sock',
    })

    expect(sandbox.env.Path).toBe('C:/Windows/System32')
    expect(sandbox.env.GITHUB_TOKEN).toBeUndefined()
    expect(sandbox.env.BETWEEN_APPROVAL_SECRET).toBeUndefined()
    expect(sandbox.env.SSH_AUTH_SOCK).toBeUndefined()
    expect(sandbox.env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(sandbox.env.BETWEEN_NETWORK_DISABLED).toBe('1')
    expect(JSON.stringify(sandbox.manifest)).not.toContain('ghp_secret')
  })
})
