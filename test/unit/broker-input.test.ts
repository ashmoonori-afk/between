import { describe, expect, it } from 'vitest'
import { parseBrokerInput } from '../../src/ui/broker-input'
import { initialState, setPhase } from '../../src/core/state'
import { FakeClock } from '../../src/core/clock'

const clock = new FakeClock(Date.UTC(2026, 5, 22, 12, 0, 0))
const base = initialState(
  { project: { name: 'broker-input', root: '/repo', obsidian_project_path: null } },
  clock,
)

describe('broker input parser', () => {
  it('turns plain idle text into a broker goal command', () => {
    expect(parseBrokerInput('ship the broker cockpit', base)).toEqual({
      kind: 'submit',
      label: 'goal queued',
      command: { kind: 'goal', goal: 'ship the broker cockpit' },
    })
  })

  it('turns plain active text into a broker steer command', () => {
    const developing = setPhase(base, 'developing', 'goal_locked')

    expect(parseBrokerInput('keep reviewer isolated', developing)).toEqual({
      kind: 'submit',
      label: 'steer queued',
      command: { kind: 'steer_goal', goal: 'keep reviewer isolated' },
    })
  })

  it('supports explicit slash commands for broker actions', () => {
    const developing = setPhase(base, 'developing', 'goal_locked')

    expect(parseBrokerInput('/review', developing)).toEqual({
      kind: 'submit',
      label: 'review queued',
      command: { kind: 'review_now' },
    })
    expect(parseBrokerInput('/abort', developing)).toEqual({
      kind: 'submit',
      label: 'abort queued',
      command: { kind: 'interrupt' },
    })
  })
})
