import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '../../src/core/clock'
import { initProject } from '../../src/adapters/init-project'
import { GatewaySession } from '../../src/gateway/session'
import { EchoTransport } from '../../src/gateway/echo-transport'
import { CommandBus } from '../../src/adapters/command-bus'
import { StateRepository } from '../../src/adapters/state-repository'
import { initialState, setPhase } from '../../src/core/state'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-gw-'))
  await execa('git', ['init', '-b', 'main'], { cwd: dir })
  await initProject(dir, {}, new FakeClock(0))
})
afterEach(async () => {
  try {
    await rm(dir, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

async function freshSession() {
  const echo = new EchoTransport()
  const gw = new GatewaySession(dir, echo)
  await gw.start()
  return { echo, gw }
}

describe('gateway core (Phase 2)', () => {
  it('routes help/status and turns a goal message into a broker command', async () => {
    const { echo } = await freshSession()
    await echo.inject('c1', 'help')
    expect(echo.lastSent()).toContain('commands')
    await echo.inject('c1', 'status')
    expect(echo.lastSent()).toContain('phase')
    await echo.inject('c1', 'goal ship the gateway')
    expect(echo.lastSent()).toContain('goal locked')

    const cmds = await new CommandBus(dir).drain()
    expect(
      cmds.some((c) => c.command.kind === 'goal' && c.command.goal === 'ship the gateway'),
    ).toBe(true)
  })

  it('signs an approval from chat with the human session secret (P1-5)', async () => {
    const { echo } = await freshSession()
    await echo.inject('c1', 'approve merge')
    expect(echo.lastSent()).toContain('signed')
    const cmds = await new CommandBus(dir).drain()
    const ap = cmds.find((c) => c.command.kind === 'approve')
    expect(ap).toBeTruthy()
    expect(ap!.command.kind === 'approve' && typeof ap!.command.sig === 'string').toBe(true)
  })

  it('rejects an unknown command with help', async () => {
    const { echo } = await freshSession()
    await echo.inject('c1', 'frobnicate')
    expect(echo.lastSent()).toContain('unknown command')
  })

  it('notifies the chat when the broker reaches a human gate', async () => {
    const { echo, gw } = await freshSession()
    await echo.inject('c1', 'status') // registers the chat id
    const human = setPhase(
      initialState(
        { project: { name: 'x', root: dir, obsidian_project_path: null } },
        new FakeClock(0),
      ),
      'human_gate',
      'verifying',
    )
    await new StateRepository(dir).write(human)
    await gw.tick()
    expect(echo.sent.some((s) => s.text.includes('approval needed'))).toBe(true)
  })
})
