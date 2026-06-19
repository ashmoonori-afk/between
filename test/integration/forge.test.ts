import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { SystemClock } from '../../src/core/clock'
import { initProject } from '../../src/adapters/init-project'
import { CommandBus } from '../../src/adapters/command-bus'
import { scaffoldForge, readForgeState, writeForgeState } from '../../src/forge/repository'
import { setPhase, setStatus, advance } from '../../src/forge/machine'
import { delegateBuild } from '../../src/forge/build'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-forge-'))
  await execa('git', ['init', '-q'], { cwd: dir })
  await execa('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
  await execa('git', ['config', 'user.name', 't'], { cwd: dir })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('forge repository', () => {
  it('scaffolds docs/pwsforge with state.json + intake stub, idempotently', async () => {
    const first = await scaffoldForge(dir, { idea: 'a habit tracker' })
    expect(first.alreadyExisted).toBe(false)
    expect(first.state.current_phase).toBe('intake')

    const stateFile = join(dir, 'docs', 'pwsforge', 'state.json')
    expect(JSON.parse(await readFile(stateFile, 'utf8')).project_name).toBeTruthy()
    expect(await readFile(join(dir, 'docs', 'pwsforge', '00-intake.md'), 'utf8')).toMatch(
      /habit tracker/,
    )

    const second = await scaffoldForge(dir, { idea: 'changed' })
    expect(second.alreadyExisted).toBe(true) // never clobbers
  })

  it('persists machine transitions across read/write', async () => {
    await scaffoldForge(dir)
    let s = (await readForgeState(dir))!
    s = advance(setStatus(s, 'approved'))
    await writeForgeState(dir, s)
    expect((await readForgeState(dir))!.current_phase).toBe('interview')
  })
})

describe('forge build delegation (CLI-forced execution)', () => {
  it('routes the build task to the broker command bus and writes a task brief', async () => {
    await initProject(dir, { agent: 'fake' }, new SystemClock())
    await scaffoldForge(dir)
    let s = (await readForgeState(dir))!
    s = setPhase(s, 'build')
    await writeForgeState(dir, s)

    const bus = new CommandBus(dir)
    const res = await delegateBuild(dir, s, 'Add login screen', (goal) =>
      bus.submit({ kind: 'goal', goal }),
    )

    expect(res.goal).toBe('[forge:build] Add login screen')
    // the brief document exists
    expect(await readFile(res.briefPath, 'utf8')).toMatch(/Task brief/)
    // a real goal command was enqueued on the broker bus
    const cmdDir = join(dir, '.between', 'commands')
    const cmds = await readdir(cmdDir)
    expect(cmds.length).toBeGreaterThan(0)
    const body = JSON.parse(await readFile(join(cmdDir, cmds[0]!), 'utf8'))
    expect(body).toMatchObject({ kind: 'goal', goal: '[forge:build] Add login screen' })
    // forge state records the verified handoff
    expect((await readForgeState(dir))!.last_verified_command).toMatch(/between goal/)
  })

  it('refuses to delegate before the build phase', async () => {
    await initProject(dir, { agent: 'fake' }, new SystemClock())
    await scaffoldForge(dir)
    const s = (await readForgeState(dir))!
    await expect(delegateBuild(dir, s, 'too early', async () => {})).rejects.toThrow(
      /advance to the build phase/,
    )
  })
})
