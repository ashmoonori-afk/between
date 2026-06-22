import { Box, Text } from 'ink'
import type { DashboardCommandItem, DashboardCommandPaletteState } from './command-palette'
import { COLORS, GLYPH } from './theme'

interface CommandPaletteProps extends DashboardCommandPaletteState {
  items: readonly DashboardCommandItem[]
  width: number
  extraKeys?: string
}

export function CommandPalette({
  open,
  selectedIndex,
  lastMessage,
  items,
  width,
  extraKeys,
}: CommandPaletteProps) {
  if (!open) {
    const keys = extraKeys
      ? `${extraKeys} | esc abort | c palette | r review | p pause/resume | q quit`
      : 'esc abort | c palette | r review | p pause/resume | q quit'
    return (
      <Text color={COLORS.textFaint} dimColor wrap="truncate-end">
        {`${lastMessage ? `${lastMessage} | ` : ''}keys: ${keys}`}
      </Text>
    )
  }

  return (
    <Box flexDirection="column" width={width} borderStyle="round" borderColor={COLORS.accentAlt}>
      <Box justifyContent="space-between">
        <Text color={COLORS.accentAlt} bold>
          COMMAND PALETTE
        </Text>
        <Text color={COLORS.textFaint} dimColor>
          enter run | esc close
        </Text>
      </Box>
      {items.map((item, index) => {
        const selected = index === selectedIndex
        const marker = selected ? '>' : ' '
        const status = item.enabled ? item.hint : `disabled: ${item.hint}`
        return (
          <Text key={item.id} color={item.enabled ? COLORS.textPrimary : COLORS.textMuted}>
            <Text color={selected ? COLORS.accentAlt : COLORS.divider}>{marker}</Text>
            <Text>{` ${item.key} ${item.label}`}</Text>
            <Text color={COLORS.textFaint} dimColor>{` ${GLYPH.divider} ${status}`}</Text>
          </Text>
        )
      })}
      {lastMessage ? <Text color={COLORS.success}>{lastMessage}</Text> : null}
    </Box>
  )
}
