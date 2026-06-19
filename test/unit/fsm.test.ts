import { describe, it, expect } from 'vitest'
import { transition, canTransition, isTerminal } from '../../src/core/fsm'
import type { Phase } from '../../src/core/types'

const at = (phase: Phase, previous: Phase | null = null) => ({ phase, previous_phase: previous })

describe('fsm happy path', () => {
  it('walks idle -> ... -> human_gate', () => {
    let s = at('idle')
    s = transition(s, 'goal_locked')
    expect(s.phase).toBe('goal_locked')
    s = transition(s, 'dev_started')
    expect(s.phase).toBe('developing')
    s = transition(s, 'diff_detected')
    expect(s.phase).toBe('debouncing')
    s = transition(s, 'diff_stable')
    expect(s.phase).toBe('review_requested')
    s = transition(s, 'review_acked')
    expect(s.phase).toBe('reviewing')
    s = transition(s, 'review_written')
    expect(s.phase).toBe('review_written')
    s = transition(s, 'review_applied')
    expect(s.phase).toBe('applying_review')
    s = transition(s, 'review_applied')
    expect(s.phase).toBe('developing')
  })

  it('clean review path: review_written -> verify_passed -> human_gate -> done', () => {
    let s = at('review_written')
    s = transition(s, 'verify_passed')
    expect(s.phase).toBe('human_gate')
    s = transition(s, 'human_approved')
    expect(s.phase).toBe('done')
    expect(isTerminal(s.phase)).toBe(true)
  })
})

describe('fsm branches', () => {
  it('debounce self-loop on diff_changed', () => {
    expect(transition(at('debouncing'), 'diff_changed').phase).toBe('debouncing')
  })

  it('debounce revert aborts to developing (no cycle)', () => {
    expect(transition(at('debouncing'), 'diff_reverted').phase).toBe('developing')
  })

  it('verifying fail returns to developing', () => {
    expect(transition(at('verifying'), 'verify_failed').phase).toBe('developing')
  })

  it('human_gate can request another cycle', () => {
    expect(transition(at('human_gate'), 'dev_started').phase).toBe('developing')
  })
})

describe('fsm universal interrupts', () => {
  it('pause captures previous phase and resume restores it', () => {
    const paused = transition(at('reviewing'), 'pause')
    expect(paused.phase).toBe('paused')
    expect(paused.previous_phase).toBe('reviewing')
    const resumed = transition(paused, 'resume')
    expect(resumed.phase).toBe('reviewing')
  })

  it('repo_busy then repo_cleared restores previous phase', () => {
    const busy = transition(at('debouncing'), 'repo_busy_detected')
    expect(busy.phase).toBe('repo_busy')
    expect(transition(busy, 'repo_cleared').phase).toBe('debouncing')
  })

  it('max_cycles_reached and timeouts route to human_gate', () => {
    expect(transition(at('debouncing'), 'max_cycles_reached').phase).toBe('human_gate')
    expect(transition(at('review_requested'), 'review_timeout').phase).toBe('human_gate')
    expect(transition(at('reviewing'), 'developer_timeout').phase).toBe('human_gate')
  })

  it('agent_died and fail route to error, and error resumes', () => {
    const dead = transition(at('reviewing'), 'agent_died')
    expect(dead.phase).toBe('error')
    expect(transition(dead, 'resume').phase).toBe('reviewing')
  })

  it('does not interrupt a terminal phase', () => {
    expect(transition(at('done'), 'pause').changed).toBe(false)
    expect(transition(at('done'), 'agent_died').changed).toBe(false)
  })
})

describe('fsm illegal transitions', () => {
  it('returns changed:false for an illegal event', () => {
    const r = transition(at('idle'), 'review_acked')
    expect(r.changed).toBe(false)
    expect(r.phase).toBe('idle')
  })

  it('canTransition reflects legality', () => {
    expect(canTransition('developing', 'diff_detected')).toBe(true)
    expect(canTransition('developing', 'human_approved')).toBe(false)
  })

  it('resume from a non-holding phase is a no-op', () => {
    expect(transition(at('developing'), 'resume').changed).toBe(false)
  })
})
