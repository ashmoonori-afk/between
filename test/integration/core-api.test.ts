import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '../../src/core/clock'
import { betweenPaths } from '../../src/adapters/paths'
import {
  BetweenApiError,
  ackReview,
  getStatus,
  initPolicy,
  initWorkspace,
  inspectJournal,
  parseAgentPreset,
  parseApprovalScope,
  submitBrokerCommand,
  summarizeEvents,
  verifyPush,
} from '../../src/index'

let dir = ''

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  dir = ''
})

async function freshWorkspace(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'between-core-api-'))
  await initWorkspace(dir, { agent: 'fake' }, new FakeClock(0))
  return dir
}

async function expectApiError(p: Promise<unknown>, code: BetweenApiError['code']) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(BetweenApiError)
  expect((err as BetweenApiError).code).toBe(code)
}

describe('core api', () => {
  it('reports status for an initialized workspace', async () => {
    await freshWorkspace()
    const status = await getStatus(dir)
    expect(status.workflow.phase).toBe('idle')
    expect(status.evidence_trust).toBe('simulated')
    expect(status.developer.name).toBeTruthy()
    expect(typeof status.max_cycles_per_goal).toBe('number')
  })

  it('fails status with no_state outside a workspace', async () => {
    dir = await mkdtemp(join(tmpdir(), 'between-core-api-empty-'))
    await expectApiError(getStatus(dir), 'no_state')
  })

  it('enqueues broker control commands on the command bus', async () => {
    await freshWorkspace()
    await submitBrokerCommand(dir, { kind: 'goal', goal: 'ship the api layer' })
    const commandsDir = betweenPaths(dir).commands
    const files = await readdir(commandsDir)
    expect(files).toHaveLength(1)
    const queued = JSON.parse(await readFile(join(commandsDir, files[0]!), 'utf8'))
    expect(queued).toMatchObject({ kind: 'goal', goal: 'ship the api layer' })
  })

  it('validates approval scopes and agent presets at the boundary', () => {
    expect(parseApprovalScope('merge')).toBe('merge')
    expect(() => parseApprovalScope('ship-it')).toThrow(BetweenApiError)
    expect(parseAgentPreset(undefined, 'agent')).toBeUndefined()
    expect(parseAgentPreset('codex', 'agent')).toBe('codex')
    expect(() => parseAgentPreset('gpt', '--agent')).toThrow('--agent must be one of')
  })

  it('refuses ack when there is no outstanding review', async () => {
    await freshWorkspace()
    await expectApiError(ackReview(dir), 'not_found')
  })

  it('blocks push for a simulated (fake agent) project', async () => {
    await freshWorkspace()
    const verdict = await verifyPush(dir)
    expect(verdict.allowed).toBe(false)
    expect(verdict.message).toContain('SIMULATION')
  })

  it('writes the default policy once', async () => {
    await freshWorkspace()
    expect((await initPolicy(dir)).created).toBe(true)
    expect((await initPolicy(dir)).created).toBe(false)
  })

  it('summarizes and verifies the journal', async () => {
    await freshWorkspace()
    const summary = await summarizeEvents(dir)
    expect(summary.total).toBe(summary.counts.reduce((n, c) => n + c.count, 0))
    const journal = await inspectJournal(dir, { verify: true })
    expect(journal.entries).toBe(summary.total)
    expect(journal.integrity?.status).toBe('verified')
  })
})
