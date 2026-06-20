import { describe, expect, it, afterEach } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyCommand } from '../../src/daemon/commands'
import type { BetweenState, BetweenEvent } from '../../src/core/types'
import type { DaemonContext } from '../../src/daemon/context'

let dir = ''

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = ''
})

describe('cockpit finding actions', () => {
  it('records a current finding action as a durable daemon event', async () => {
    dir = await seedReview()
    const events: BetweenEvent[] = []
    const ctx = fakeContext(events)

    await applyCommand(ctx, {
      kind: 'finding_action',
      action: 'waive',
      finding_id: 'F1',
      cycle: 1,
      diff_hash: 'd'.repeat(64),
      reason: 'accepted risk TOKEN=supersecret123456',
    })

    expect(events).toHaveLength(1)
    expect(events[0]?.event).toBe('finding_action_recorded')
    expect(events[0]?.detail).toMatchObject({
      action: 'waive',
      finding_id: 'F1',
      severity: 'blocking',
      reason: 'accepted risk TOKEN=[REDACTED]',
    })
  })

  it('rejects stale action commands before recording them', async () => {
    dir = await seedReview()
    const events: BetweenEvent[] = []
    const ctx = fakeContext(events)

    await applyCommand(ctx, {
      kind: 'finding_action',
      action: 'accept',
      finding_id: 'F1',
      cycle: 1,
      diff_hash: 'old',
    })

    expect(events).toHaveLength(1)
    expect(events[0]?.event).toBe('finding_action_rejected')
    expect(events[0]?.detail?.reason).toBe('stale_cycle_or_diff')
  })
})

async function seedReview(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'between-finding-actions-'))
  await mkdir(join(root, '.between', 'reviews'), { recursive: true })
  await writeFile(
    join(root, '.between', 'reviews', 'cycle-0001.json'),
    JSON.stringify({
      cycle: 1,
      diff_hash: 'd'.repeat(64),
      complete: true,
      findings: [
        {
          id: 'F1',
          severity: 'blocking',
          summary: '[app.ts:2] risky branch',
          target_hash: 'd'.repeat(64),
        },
      ],
    }),
  )
  return root
}

function fakeContext(events: BetweenEvent[]): DaemonContext {
  const state = {
    workflow: { cycle: 1 },
    diff: { hash: 'd'.repeat(64) },
  } as BetweenState
  return {
    deps: {
      root: dir,
      clock: {
        now: () => 0,
        nowIso: () => '2026-06-20T00:00:00.000Z',
      },
    },
    current: () => state,
    persist: async () => {},
    dispatch: async () => false,
    emit: async (event: string, extra = {}) => {
      events.push({
        v: 1,
        ts: '2026-06-20T00:00:00.000Z',
        cycle: 1,
        phase: 'human_gate',
        event,
        ...extra,
      } as BetweenEvent)
    },
    requestStop: () => {},
  } as unknown as DaemonContext
}
