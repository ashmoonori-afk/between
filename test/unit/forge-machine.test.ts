import { describe, it, expect } from 'vitest'
import { initialForgeState, parseForgeState } from '../../src/forge/state'
import {
  gateBlock,
  canAdvance,
  advance,
  setStatus,
  addBlocker,
  removeBlocker,
  addDecision,
} from '../../src/forge/machine'
import { nextPhase, FORGE_PHASES } from '../../src/forge/phases'

describe('forge gate', () => {
  it('a fresh intake state cannot advance until approved', () => {
    const s = initialForgeState('demo')
    expect(s.current_phase).toBe('intake')
    expect(gateBlock(s)).toMatch(/phase_status/)
    expect(canAdvance(s)).toBe(false)
  })

  it('approving opens the gate', () => {
    const s = setStatus(initialForgeState('demo'), 'approved')
    expect(gateBlock(s)).toBeNull()
    expect(canAdvance(s)).toBe(true)
  })

  it('an open P0 blocker closes the gate even when approved', () => {
    let s = setStatus(initialForgeState('demo'), 'approved')
    s = addBlocker(s, { severity: 'P0', description: 'no PRD' })
    expect(s.phase_status).toBe('blocked')
    expect(gateBlock(s)).toMatch(/P0/)
  })

  it('clearing the P0 blocker reopens the gate', () => {
    let s = setStatus(initialForgeState('demo'), 'approved')
    s = addBlocker(s, { severity: 'P0', description: 'no PRD' })
    s = removeBlocker(s, 0)
    s = setStatus(s, 'approved')
    expect(gateBlock(s)).toBeNull()
  })

  it('P1 blocker does not close the gate', () => {
    let s = setStatus(initialForgeState('demo'), 'approved')
    s = addBlocker(s, { severity: 'P1', description: 'minor' })
    expect(gateBlock(s)).toBeNull()
  })
})

describe('forge advance', () => {
  it('advance moves to the next phase and resets status', () => {
    const s = advance(setStatus(initialForgeState('demo'), 'approved'))
    expect(s.current_phase).toBe('interview')
    expect(s.phase_status).toBe('in_progress')
  })

  it('advance throws when the gate is closed', () => {
    expect(() => advance(initialForgeState('demo'))).toThrow(/gate closed/)
  })

  it('advancing through every phase ends at retrospective with no next', () => {
    let s = initialForgeState('demo')
    for (let i = 0; i < FORGE_PHASES.length - 1; i++) {
      s = advance(setStatus(s, 'approved'))
    }
    expect(s.current_phase).toBe('retrospective')
    expect(nextPhase(s.current_phase)).toBeNull()
    expect(() => advance(setStatus(s, 'approved'))).toThrow(/final phase/)
  })

  it('does not mutate the input state (immutability)', () => {
    const s = setStatus(initialForgeState('demo'), 'approved')
    const before = JSON.stringify(s)
    advance(s)
    expect(JSON.stringify(s)).toBe(before)
  })
})

describe('forge decisions + schema', () => {
  it('addDecision appends immutably', () => {
    const s = addDecision(initialForgeState('demo'), { decision: 'use expo', reason: 'fast' })
    expect(s.decisions).toHaveLength(1)
  })

  it('parseForgeState round-trips a valid state', () => {
    const s = initialForgeState('demo')
    expect(parseForgeState(JSON.parse(JSON.stringify(s))).current_phase).toBe('intake')
  })

  it('parseForgeState rejects an unknown phase', () => {
    expect(() => parseForgeState({ ...initialForgeState('demo'), current_phase: 'nope' })).toThrow(
      /Invalid forge state/,
    )
  })
})
