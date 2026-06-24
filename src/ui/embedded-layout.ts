export interface EmbeddedTerminalSize {
  readonly columns: number
  readonly rows: number
}

export interface EmbeddedLayout {
  readonly width: number
  readonly brokerHeight: number
  readonly agentHeight: number
  readonly agentWidth: number
  readonly agentRows: number
  readonly agentDirection: 'row' | 'column'
}

export const EMBEDDED_INPUT_ROWS = 4

export function computeEmbeddedLayout(
  size: EmbeddedTerminalSize,
  requestedAgentRows: number,
): EmbeddedLayout {
  const width = clamp(size.columns, 60, 140)
  const rows = clamp(size.rows, 16, 80)
  const agentDirection = width < 84 ? 'column' : 'row'
  const usableRows = Math.max(8, rows - EMBEDDED_INPUT_ROWS)
  const minBrokerHeight = rows <= 18 ? 4 : 7
  const minAgentHeight = rows <= 18 ? 4 : 6
  const agentSlots = agentDirection === 'column' ? 2 : 1
  const absoluteMin = minBrokerHeight + minAgentHeight * agentSlots
  if (usableRows <= absoluteMin) {
    const agentHeight = Math.max(3, Math.floor((usableRows - minBrokerHeight) / agentSlots))
    const brokerHeight = Math.max(3, usableRows - agentHeight * agentSlots)
    const agentWidth = agentDirection === 'row' ? Math.floor(width / 2) : width
    return {
      width,
      brokerHeight,
      agentHeight,
      agentWidth,
      agentRows: Math.min(requestedAgentRows, Math.max(1, agentHeight - 4)),
      agentDirection,
    }
  }
  const maxBrokerHeight = Math.max(minBrokerHeight, usableRows - minAgentHeight * agentSlots)
  const desiredBrokerHeight = Math.floor((usableRows * 2) / 3)
  const brokerHeight = Math.min(maxBrokerHeight, Math.max(minBrokerHeight, desiredBrokerHeight))
  const agentHeight = Math.max(minAgentHeight, Math.floor((usableRows - brokerHeight) / agentSlots))
  const agentWidth = agentDirection === 'row' ? Math.floor(width / 2) : width
  const visibleRows = Math.max(1, agentHeight - 4)
  return {
    width,
    brokerHeight,
    agentHeight,
    agentWidth,
    agentRows: Math.min(requestedAgentRows, visibleRows),
    agentDirection,
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.floor(value)))
}
