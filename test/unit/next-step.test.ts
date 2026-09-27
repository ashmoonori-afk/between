import { describe, expect, it } from 'vitest'
import { nextStep, type NextStepInput } from '../../src/api/next-step'

const base: NextStepInput = {
  phase: 'idle',
  waiting_on: null,
  broker_running: false,
  queued_commands: 0,
  agent_mode: 'file',
}

describe('nextStep', () => {
  it('asks for a goal and a broker on a fresh workspace', () => {
    expect(nextStep(base)).toMatch(/between goal .*between start/)
  })

  it('reports queued commands before anything else when no broker runs', () => {
    expect(nextStep({ ...base, queued_commands: 2 })).toMatch(
      /2 command\(s\) queued.*between start/,
    )
    // a running broker drains the queue on its next tick, so there is nothing to tell the human
    expect(nextStep({ ...base, queued_commands: 2, broker_running: true })).toBeNull()
  })

  it('points at `between start` when work is queued but no broker runs', () => {
    expect(nextStep({ ...base, phase: 'review_requested', waiting_on: 'reviewer' })).toMatch(
      /no broker is running.*between start/,
    )
  })

  it('explains file mode when the broker waits on an agent it does not host', () => {
    const step = nextStep({
      ...base,
      phase: 'review_requested',
      waiting_on: 'reviewer',
      broker_running: true,
    })
    expect(step).toMatch(/run the reviewer agent yourself/)
    // --embed alone does not run file-mode agents; oneshot mode does
    expect(step).toMatch(/agent_mode: oneshot/)
    expect(step).not.toMatch(/--embed/)
  })

  it('stays quiet while hosted agents are working', () => {
    expect(
      nextStep({
        ...base,
        phase: 'reviewing',
        waiting_on: 'reviewer',
        broker_running: true,
        agent_mode: 'oneshot',
      }),
    ).toBeNull()
  })

  it('guides the human gate, pause, error, and done phases', () => {
    expect(nextStep({ ...base, phase: 'human_gate' })).toMatch(/between approve merge/)
    expect(nextStep({ ...base, phase: 'paused' })).toMatch(/between resume/)
    expect(nextStep({ ...base, phase: 'error' })).toMatch(/between resume/)
    expect(nextStep({ ...base, phase: 'done' })).toMatch(/between goal/)
  })
})
