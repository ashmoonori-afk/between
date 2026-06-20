import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { APPROVAL_SECRET_ENV } from '../../src/adapters/approval-secret'
import { buildAgentSandboxEnv, writeAgentEnvManifest } from '../../src/adapters/agent-env'

const secret = 'secret-value-should-never-appear'

let dir: string | null = null

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  dir = null
})

describe('buildAgentSandboxEnv', () => {
  it('strips signing, push, npm, ssh, git, and cloud credentials', () => {
    const result = buildAgentSandboxEnv(
      { FORCE_COLOR: '1', BETWEEN_ROOT: 'C:/repo' },
      {
        baseEnv: {
          Path: 'C:/Windows/System32',
          SystemRoot: 'C:/Windows',
          USERPROFILE: 'C:/Users/lg',
          [APPROVAL_SECRET_ENV]: secret,
          GITHUB_TOKEN: secret,
          GH_TOKEN: secret,
          SSH_AUTH_SOCK: secret,
          GIT_ASKPASS: secret,
          NPM_TOKEN: secret,
          NODE_AUTH_TOKEN: secret,
          AWS_SECRET_ACCESS_KEY: secret,
          AWS_SESSION_TOKEN: secret,
          GOOGLE_APPLICATION_CREDENTIALS: secret,
          AZURE_CLIENT_SECRET: secret,
        },
      },
    )

    expect(result.env.Path).toBe('C:/Windows/System32')
    expect(result.env.SystemRoot).toBe('C:/Windows')
    expect(result.env.USERPROFILE).toBe('C:/Users/lg')
    expect(result.env.FORCE_COLOR).toBe('1')
    expect(result.env.BETWEEN_ROOT).toBe('C:/repo')
    for (const key of [
      APPROVAL_SECRET_ENV,
      'GITHUB_TOKEN',
      'GH_TOKEN',
      'SSH_AUTH_SOCK',
      'GIT_ASKPASS',
      'NPM_TOKEN',
      'NODE_AUTH_TOKEN',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'AZURE_CLIENT_SECRET',
    ]) {
      expect(result.env[key]).toBeUndefined()
      expect(result.manifest.stripped.map((entry) => entry.name)).toContain(key)
    }
    expect(JSON.stringify(result.manifest)).not.toContain(secret)
  })

  it('honors an explicit allowlist for non-secret project-specific variables', () => {
    const result = buildAgentSandboxEnv(
      {},
      {
        allowlist: ['PROJECT_TOKEN_HINT'],
        baseEnv: { PROJECT_TOKEN_HINT: 'safe-mode-name', GITHUB_TOKEN: secret },
      },
    )

    expect(result.env.PROJECT_TOKEN_HINT).toBe('safe-mode-name')
    expect(result.env.GITHUB_TOKEN).toBeUndefined()
    expect(result.manifest.allowlisted.map((entry) => entry.name)).toEqual(['PROJECT_TOKEN_HINT'])
    expect(JSON.stringify(result.manifest)).not.toContain('safe-mode-name')
  })

  it('writes a value-free manifest under .between agent env state', async () => {
    dir = await mkdtemp(join(tmpdir(), 'between-agent-env-'))
    const result = buildAgentSandboxEnv(
      { BETWEEN_ROOT: dir },
      { baseEnv: { GITHUB_TOKEN: secret, Path: 'C:/Windows/System32' } },
    )

    const path = await writeAgentEnvManifest(dir, 'developer', result.manifest)
    const saved = await readFile(path, 'utf8')

    expect(path).toContain(join('.between', 'agent-env'))
    expect(saved).toContain('"role": "developer"')
    expect(saved).toContain('"GITHUB_TOKEN"')
    expect(saved).not.toContain(secret)
    expect(saved).not.toContain('C:/Windows/System32')
  })
})
