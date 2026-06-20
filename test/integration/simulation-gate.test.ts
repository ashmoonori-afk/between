import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '../../src/core/clock'
import { initProject } from '../../src/adapters/init-project'
import { StateRepository } from '../../src/adapters/state-repository'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-sim-'))
  await execa('git', ['init', '-q'], { cwd: dir })
  await execa('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
  await execa('git', ['config', 'user.name', 't'], { cwd: dir })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

describe('A5 — fake-mode safety', () => {
  it('init marks the bundled fake agent as a SIMULATION, real presets as real', async () => {
    await initProject(dir, { agent: 'fake' }, new FakeClock(0))
    expect((await new StateRepository(dir).read())?.evidence_trust).toBe('simulated')

    const real = await mkdtemp(join(tmpdir(), 'between-real-'))
    await execa('git', ['init', '-q'], { cwd: real })
    await initProject(real, { agent: 'claude' }, new FakeClock(0))
    expect((await new StateRepository(real).read())?.evidence_trust).toBe('real')
    await rm(real, { recursive: true, force: true }).catch(() => {})
  })

  it('the installed pre-push verifier refuses to push a SIMULATION project', async () => {
    await initProject(dir, { agent: 'fake' }, new FakeClock(0))
    const res = await execa('node', ['.git/between-verify-push.mjs'], {
      cwd: dir,
      reject: false,
    })
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toMatch(/SIMULATION/)
  })

  it('A7: distinct developer/reviewer presets wire each role independently + mark real', async () => {
    await initProject(dir, { developer: 'claude', reviewer: 'codex' }, new FakeClock(0))
    const cfg = await readFile(join(dir, '.between', 'config.yaml'), 'utf8')
    expect(cfg).toMatch(/developer_command:.*claude-agent\.mjs/)
    expect(cfg).toMatch(/reviewer_command:.*codex-agent\.mjs/)
    expect(cfg).toMatch(/agent_mode: oneshot/)

    const st = await new StateRepository(dir).read()
    expect(st?.evidence_trust).toBe('real') // both roles real
    expect(st?.developer.name).toBe('claude')
    expect(st?.reviewer.name).toBe('codex')
  })
})
