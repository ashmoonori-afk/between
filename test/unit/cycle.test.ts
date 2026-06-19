import { describe, it, expect } from 'vitest'
import { openCycle, resetForNewGoal, isCycleCapReached, cycleName } from '../../src/core/cycle'

describe('cycle', () => {
  it('opens a cycle by incrementing both counters', () => {
    expect(openCycle({ cycle: 6, cycles_this_goal: 2 })).toEqual({ cycle: 7, cycles_this_goal: 3 })
  })

  it('resets the per-goal counter but keeps the monotonic id', () => {
    expect(resetForNewGoal({ cycle: 12, cycles_this_goal: 5 })).toEqual({
      cycle: 12,
      cycles_this_goal: 0,
    })
  })

  it('detects the per-goal cap', () => {
    expect(isCycleCapReached(7, 8)).toBe(false)
    expect(isCycleCapReached(8, 8)).toBe(true)
    expect(isCycleCapReached(9, 8)).toBe(true)
  })

  it('zero-pads cycle names', () => {
    expect(cycleName(7)).toBe('cycle-0007')
    expect(cycleName(1234)).toBe('cycle-1234')
    expect(cycleName(99999)).toBe('cycle-99999')
  })
})
