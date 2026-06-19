import { describe, it, expect } from 'vitest'
import { stepDebounce, emptyDebounce } from '../../src/core/debounce'

const WINDOW = 25
// Consistent clock helpers: nowMs and nowIso always describe the same instant,
// exactly as the production Clock guarantees (now() === Date.parse(nowIso())).
const iso = (sec: number): string => new Date(Date.UTC(2026, 5, 19, 0, 0, sec)).toISOString()
const ms = (sec: number): number => Date.parse(iso(sec))

describe('debounce', () => {
  it('starts a candidate when none exists', () => {
    const r = stepDebounce(emptyDebounce(), 'h1', iso(0), ms(0), WINDOW)
    expect(r.decision).toBe('started')
    expect(r.state.candidate_hash).toBe('h1')
    expect(r.state.candidate_first_seen_at).toBe(iso(0))
  })

  it('restarts when the candidate changes', () => {
    const started = stepDebounce(emptyDebounce(), 'h1', iso(0), ms(0), WINDOW).state
    const r = stepDebounce(started, 'h2', iso(6), ms(6), WINDOW)
    expect(r.decision).toBe('restarted')
    expect(r.state.candidate_hash).toBe('h2')
    expect(r.state.debounce_restarts).toBe(1)
  })

  it('is pending while the window has not elapsed', () => {
    const started = stepDebounce(emptyDebounce(), 'h1', iso(0), ms(0), WINDOW).state
    const r = stepDebounce(started, 'h1', iso(10), ms(10), WINDOW)
    expect(r.decision).toBe('pending')
  })

  it('is stable once the window elapses', () => {
    const started = stepDebounce(emptyDebounce(), 'h1', iso(0), ms(0), WINDOW).state
    const r = stepDebounce(started, 'h1', iso(25), ms(25), WINDOW)
    expect(r.decision).toBe('stable')
  })

  it('recovers deterministically from a reloaded mid-debounce state', () => {
    // simulate a crash: persisted candidate first seen at t=0, reload at t=30s
    const persisted = {
      candidate_hash: 'h1',
      candidate_first_seen_at: iso(0),
      debounce_restarts: 2,
    }
    const r = stepDebounce(persisted, 'h1', iso(30), ms(30), WINDOW)
    expect(r.decision).toBe('stable')
  })
})
