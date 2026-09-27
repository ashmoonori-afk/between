import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '../../src/core/clock'
import { betweenPaths } from '../../src/adapters/paths'
import { BrokerLock } from '../../src/adapters/lock'
import {
  BetweenApiError,
  ackReview,
  getStatus,
  initPolicy,
  initWorkspace,
  inspectJournal,
  NotInitializedError,
  parseAgentPreset,
  submitBrokerCommand,
  summarizeEvents,
  toApiError,
  verifyPush,
} from '../../src/index'
import * as publicApi from '../../src/index'
import { parseApprovalScope } from '../../src/human'
import { ReplayError } from '../../src/core/replay'

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

  it('reports whether a broker is running and what to do next', async () => {
    await freshWorkspace()
    const idle = await getStatus(dir)
    expect(idle.broker_running).toBe(false)
    expect(idle.simulated).toBe(true)
    expect(idle.next_step).toMatch(/between start/)
    expect((await submitBrokerCommand(dir, { kind: 'pause' })).broker_running).toBe(false)

    const lock = new BrokerLock(dir)
    await lock.acquire(new FakeClock(0))
    try {
      expect((await getStatus(dir)).broker_running).toBe(true)
      expect((await submitBrokerCommand(dir, { kind: 'resume' })).broker_running).toBe(true)
    } finally {
      await lock.releaseLock()
    }
    expect((await getStatus(dir)).broker_running).toBe(false)
  })

  it('fails status with no_state outside a workspace', async () => {
    dir = await mkdtemp(join(tmpdir(), 'between-core-api-empty-'))
    await expectApiError(getStatus(dir), 'no_state')
  })

  it('enqueues broker control commands on the command bus', async () => {
    await freshWorkspace()
    const res = await submitBrokerCommand(dir, { kind: 'goal', goal: 'ship the api layer' })
    expect(res.status).toBe('queued')
    const commandsDir = betweenPaths(dir).commands
    const files = await readdir(commandsDir)
    expect(files).toEqual([`${res.command_id}.json`])
    const queued = JSON.parse(await readFile(join(commandsDir, files[0]!), 'utf8'))
    expect(queued).toMatchObject({ kind: 'goal', goal: 'ship the api layer' })
  })

  it('rejects non-control kinds, blank goals, and commands the broker would drop', async () => {
    await freshWorkspace()
    await expectApiError(
      submitBrokerCommand(dir, { kind: 'approve', scope: 'merge' }),
      'invalid_argument',
    )
    await expectApiError(
      submitBrokerCommand(dir, { kind: 'steer_goal', goal: '  ' }),
      'invalid_argument',
    )
    await expectApiError(
      submitBrokerCommand(dir, { kind: 'goal', goal: 'x'.repeat(8192) }),
      'invalid_argument',
    )
    expect(await readdir(betweenPaths(dir).commands)).toEqual([])
  })

  it('keeps human approval out of the agent-facing library entry', () => {
    expect('approve' in publicApi).toBe(false)
    expect('parseApprovalScope' in publicApi).toBe(false)
  })

  it('normalizes thrown values into stable api error codes', () => {
    expect(toApiError(new NotInitializedError('/x')).code).toBe('no_state')
    expect(toApiError(new ReplayError('journal_tampered', 'bad chain')).code).toBe(
      'integrity_error',
    )
    expect(toApiError(new Error('Invalid config.yaml:\n  - x: bad')).code).toBe('invalid_config')
    const internal = toApiError(new Error('stderr: secret-ish subprocess output'))
    expect(internal.code).toBe('internal')
    expect(internal.message).not.toContain('secret-ish')
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

  it('blocks a protected push for a simulated (fake agent) project', async () => {
    await freshWorkspace()
    const push = (branch: string) =>
      verifyPush(dir, [
        {
          localRef: 'refs/heads/x',
          localSha: 'a'.repeat(40),
          remoteRef: `refs/heads/${branch}`,
          remoteSha: '0'.repeat(40),
        },
      ])
    const verdict = await push('main')
    expect(verdict.allowed).toBe(false)
    expect(verdict.message).toContain('SIMULATION')
    expect((await push('feature/demo')).allowed).toBe(true)
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
