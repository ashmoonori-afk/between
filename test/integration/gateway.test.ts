import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '../../src/core/clock'
import { initProject } from '../../src/adapters/init-project'
import { GatewaySession } from '../../src/gateway/session'
import { EchoTransport } from '../../src/gateway/echo-transport'
import { CommandBus } from '../../src/adapters/command-bus'
import { StateRepository } from '../../src/adapters/state-repository'
import { initialState, setPhase } from '../../src/core/state'
import { APPROVAL_SECRET_ENV } from '../../src/adapters/approval-secret'

let dir: string
const priorApprovalSecret = process.env[APPROVAL_SECRET_ENV]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-gw-'))
  await execa('git', ['init', '-b', 'main'], { cwd: dir })
  await initProject(dir, {}, new FakeClock(0))
})
afterEach(async () => {
  if (priorApprovalSecret === undefined) delete process.env[APPROVAL_SECRET_ENV]
  else process.env[APPROVAL_SECRET_ENV] = priorApprovalSecret
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

async function allowGatewayApprover(chatId: string): Promise<void> {
  const path = join(dir, '.between', 'config.yaml')
  const config = await readFile(path, 'utf8')
  await writeFile(
    path,
    config.replace('gateway_approval_chat_ids: []', `gateway_approval_chat_ids: ["${chatId}"]`),
  )
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

  it('rejects chat approvals unless the chat id is allowlisted', async () => {
    const { echo } = await freshSession()
    await echo.inject('c1', 'approve merge')
    expect(echo.lastSent()).toContain('not allowed')
    expect(await new CommandBus(dir).drain()).toHaveLength(0)
  })

  it('signs an allowlisted approval from chat with the human session secret (P1-5)', async () => {
    process.env[APPROVAL_SECRET_ENV] = 'gateway-human-secret'
    await allowGatewayApprover('c1')
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

  it('routes interrupt/abort and steer chat messages into durable broker commands', async () => {
    const { echo } = await freshSession()
    await echo.inject('c1', 'interrupt')
    expect(echo.lastSent()).toContain('agent abort requested')
    await echo.inject('c1', 'abort')
    expect(echo.lastSent()).toContain('agent abort requested')
    await echo.inject('c1', 'steer keep the UI calm')
    expect(echo.lastSent()).toContain('goal steered')

    const cmds = await new CommandBus(dir).drain()
    expect(cmds.map((c) => c.command)).toEqual([
      { kind: 'interrupt' },
      { kind: 'interrupt' },
      { kind: 'steer_goal', goal: 'keep the UI calm' },
    ])
  })

  it('rejects malformed steer chat messages without writing a command', async () => {
    const { echo } = await freshSession()
    await echo.inject('c1', 'steer')
    expect(echo.lastSent()).toContain('usage: steer <text>')
    expect(await new CommandBus(dir).drain()).toHaveLength(0)
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
