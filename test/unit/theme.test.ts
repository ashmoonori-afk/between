import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COLORS } from '../../src/ui/theme'

describe('TUI theme tokens', () => {
  it('defines distinct broker, developer, reviewer, and input accents', () => {
    const accents = [
      COLORS.roleBroker,
      COLORS.roleDeveloper,
      COLORS.roleReviewer,
      COLORS.inputActive,
      COLORS.inputReady,
    ]

    expect(new Set(accents).size).toBe(accents.length)
    for (const color of accents) {
      expect(color).toMatch(/^#[0-9A-F]{6}$/u)
    }
  })

  it('keeps embedded render paths on theme tokens instead of raw hex colors', () => {
    const renderFiles = [
      'src/ui/AgentPane.tsx',
      'src/ui/EmbeddedDashboard.tsx',
      'src/ui/EmbeddedBrokerPane.tsx',
    ]

    for (const file of renderFiles) {
      const source = readFileSync(join(process.cwd(), file), 'utf8')
      expect(source, file).not.toMatch(/#[0-9A-Fa-f]{6}/u)
    }
  })
})
