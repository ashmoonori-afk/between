import { describe, expect, it } from 'vitest'
import { computeEmbeddedLayout, EMBEDDED_INPUT_ROWS } from '../../src/ui/embedded-layout'

function renderedRows(layout: ReturnType<typeof computeEmbeddedLayout>): number {
  const agentRows = layout.agentDirection === 'column' ? layout.agentHeight * 2 : layout.agentHeight
  return layout.brokerHeight + agentRows + EMBEDDED_INPUT_ROWS
}

describe('computeEmbeddedLayout', () => {
  it('keeps the default 80x24 terminal within the available rows', () => {
    const layout = computeEmbeddedLayout({ columns: 80, rows: 24 }, 10)

    expect(layout.agentDirection).toBe('column')
    expect(renderedRows(layout)).toBeLessThanOrEqual(24)
  })

  it('keeps a narrow 60x16 terminal within the available rows', () => {
    const layout = computeEmbeddedLayout({ columns: 60, rows: 16 }, 10)

    expect(layout.agentDirection).toBe('column')
    expect(renderedRows(layout)).toBeLessThanOrEqual(16)
    expect(layout.agentRows).toBeGreaterThanOrEqual(1)
  })

  it('keeps a 100-column terminal in row mode within the available rows', () => {
    const layout = computeEmbeddedLayout({ columns: 100, rows: 32 }, 10)

    expect(layout.agentDirection).toBe('row')
    expect(renderedRows(layout)).toBeLessThanOrEqual(32)
    expect(layout.brokerHeight).toBeGreaterThanOrEqual(layout.agentHeight)
  })

  it('caps a wide 140-column terminal without overflowing rows', () => {
    const layout = computeEmbeddedLayout({ columns: 180, rows: 40 }, 12)

    expect(layout.width).toBe(140)
    expect(layout.agentDirection).toBe('row')
    expect(renderedRows(layout)).toBeLessThanOrEqual(40)
    expect(layout.brokerHeight).toBeGreaterThanOrEqual(layout.agentHeight)
  })
})
