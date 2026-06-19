import { describe, it, expect } from 'vitest'
import { projectPhase } from '../../src/core/phase-projection'
import { PHASES } from '../../src/core/types'

describe('phase-projection', () => {
  it('defines a projection for every phase', () => {
    for (const phase of PHASES) {
      const p = projectPhase(phase)
      expect(p).toHaveProperty('waiting_on')
      expect(p).toHaveProperty('developer')
      expect(p).toHaveProperty('reviewer')
      expect(p).toHaveProperty('broker')
    }
  })

  it('routes waiting_on correctly for key phases', () => {
    expect(projectPhase('developing').waiting_on).toBe('developer')
    expect(projectPhase('review_requested').waiting_on).toBe('reviewer')
    expect(projectPhase('reviewing').waiting_on).toBe('reviewer')
    expect(projectPhase('human_gate').waiting_on).toBe('human')
    expect(projectPhase('paused').waiting_on).toBe(null)
  })

  it('reflects agent + broker status', () => {
    expect(projectPhase('reviewing').reviewer).toBe('reviewing_diff')
    expect(projectPhase('paused').broker).toBe('paused')
    expect(projectPhase('error').broker).toBe('error')
    expect(projectPhase('repo_busy').broker).toBe('busy')
  })
})
