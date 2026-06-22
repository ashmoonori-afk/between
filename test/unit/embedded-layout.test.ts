import { describe, expect, it } from 'vitest'
import { computeEmbeddedLayout } from '../../src/ui/embedded-layout'

function renderedRows(layout: ReturnType<typeof computeEmbeddedLayout>): number {
  const footerRows = 1
  const agentRows = layout.agentDirection === 'column' ? layout.agentHeight * 2 : layout.agentHeight
  return layout.brokerHeight + agentRows + footerRows
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
  })

  it('keeps a 100-column terminal in row mode within the available rows', () => {
    const layout = computeEmbeddedLayout({ columns: 100, rows: 24 }, 10)

    expect(layout.agentDirection).toBe('row')
    expect(renderedRows(layout)).toBeLessThanOrEqual(24)
  })
})
