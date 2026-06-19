import { describe, it, expect } from 'vitest'
import { initialForgeState } from '../../src/forge/state'
import { setPhase } from '../../src/forge/machine'
import { buildTaskBrief, slugify } from '../../src/forge/build'

describe('slugify', () => {
  it('lowercases, dashes, and trims', () => {
    expect(slugify('Add Login Screen!')).toBe('add-login-screen')
  })
  it('falls back to "task" for empty input', () => {
    expect(slugify('!!!')).toBe('task')
  })
})

describe('buildTaskBrief', () => {
  it('refuses to delegate outside an execution phase', () => {
    const s = initialForgeState('demo') // intake
    expect(() => buildTaskBrief(s, 'add login')).toThrow(/advance to the build phase/)
  })

  it('produces a broker goal tagged with the execution phase', () => {
    const s = setPhase(initialForgeState('demo'), 'build')
    const b = buildTaskBrief(s, 'Add login screen')
    expect(b.goal).toBe('[forge:build] Add login screen')
    expect(b.slug).toBe('add-login-screen')
    expect(b.brief).toMatch(/Routed to:\*\* Between broker/)
    expect(b.brief).toMatch(/Acceptance criteria/)
  })

  it('requires a non-empty task', () => {
    const s = setPhase(initialForgeState('demo'), 'build')
    expect(() => buildTaskBrief(s, '   ')).toThrow(/required/)
  })
})
