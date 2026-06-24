import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureProjectStartBootstrap } from '../../src/adapters/project-bootstrap'
import { APPROVAL_SECRET_ENV } from '../../src/adapters/approval-secret'
import { FakeClock } from '../../src/core/clock'

let dir = ''
const previousSecret = process.env[APPROVAL_SECRET_ENV]

afterEach(async () => {
  if (previousSecret === undefined) delete process.env[APPROVAL_SECRET_ENV]
  else process.env[APPROVAL_SECRET_ENV] = previousSecret
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = ''
})

function codes(result: Awaited<ReturnType<typeof ensureProjectStartBootstrap>>): string[] {
  return result.actions.map((action) => action.code)
}

describe('ensureProjectStartBootstrap', () => {
  it('initializes git, Between, embedded agents, hook, and approval request on first start', async () => {
    delete process.env[APPROVAL_SECRET_ENV]
    dir = await mkdtemp(join(tmpdir(), 'between-bootstrap-'))

    const result = await ensureProjectStartBootstrap(dir, {
      clock: new FakeClock(0),
      preferPty: true,
    })
    const actionCodes = codes(result)

    expect(result.gitReady).toBe(true)
    expect(result.betweenReady).toBe(true)
    expect(result.approvalSecretReady).toBe(false)
    expect(actionCodes).toContain('git_initialized')
    expect(actionCodes).toContain('between_initialized')
    expect(actionCodes).toContain('terminal_agents_enabled')
    expect(actionCodes).toContain('pre_push_hook_installed')
    expect(actionCodes).toContain('approval_secret_missing')
    expect(existsSync(join(dir, '.git', 'hooks', 'pre-push'))).toBe(true)

    const config = await readFile(join(dir, '.between', 'config.yaml'), 'utf8')
    expect(config).toContain('agent_mode: pty')
    expect(config).toContain("developer_command: 'claude'")
    expect(config).toContain("reviewer_command: 'codex'")
  })

  it('does not overwrite an existing non-Between pre-push hook', async () => {
    process.env[APPROVAL_SECRET_ENV] = 'test-secret'
    dir = await mkdtemp(join(tmpdir(), 'between-bootstrap-conflict-'))
    await execa('git', ['init', '-q'], { cwd: dir })
    const hook = join(dir, '.git', 'hooks', 'pre-push')
    await writeFile(hook, '#!/bin/sh\necho existing\n', 'utf8')

    const result = await ensureProjectStartBootstrap(dir, { clock: new FakeClock(0) })

    expect(codes(result)).toContain('pre_push_hook_conflict')
    expect(await readFile(hook, 'utf8')).toContain('echo existing')
  })
})
