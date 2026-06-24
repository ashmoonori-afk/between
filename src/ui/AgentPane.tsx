import { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import { COLORS } from './theme'
import type { AgentHost, AgentOutputBuffer } from '../adapters/agent-host'

interface AgentPaneProps {
  host: AgentHost | null
  title: string
  glyph: string
  accent: string
  rows: number
  focusId: string
  width?: number
  height?: number
}

/**
 * Renders a bounded, ANSI-stripped TAIL of one agent's output. Source-agnostic: identical
 * for pipe (one-shot) and pty hosts. Agents are broker-controlled; humans type only into
 * the broker command input.
 */
export function AgentPane({
  host,
  title,
  glyph,
  accent,
  rows,
  focusId,
  width,
  height,
}: AgentPaneProps) {
  void focusId
  const [buf, setBuf] = useState<AgentOutputBuffer | null>(host ? host.snapshot() : null)

  useEffect(() => {
    if (!host) return
    setBuf(host.snapshot())
    return host.subscribe(setBuf)
  }, [host])

  const lines = buf ? buf.lines.slice(-rows) : []
  const exitCode = buf?.exitCode ?? null
  const dead =
    buf?.exited === true &&
    !buf.alive &&
    (buf.kind === 'pty' || exitCode === null || exitCode !== 0)
  const standby = buf?.kind === 'pty' && !buf.alive && !buf.exited
  const exitText = exitCode === null ? '' : ` (exit ${exitCode})`
  const status = !host
    ? 'not hosted'
    : buf?.alive
      ? 'live'
      : dead
        ? `dead${exitText}`
        : standby
          ? 'standby'
          : 'idle'
  const statusColor = !host
    ? COLORS.textFaint
    : dead
      ? COLORS.error
      : buf?.alive
        ? COLORS.success
        : standby
          ? COLORS.warning
          : COLORS.textMuted
  const control = host?.kind === 'pty' ? 'broker-owned pty' : 'broker signal'

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      width={width}
      height={height}
      borderStyle="single"
      borderColor={accent}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text color={accent} bold>
          {`${glyph} ${title} FIELD`}
        </Text>
        <Text color={statusColor}>{status}</Text>
      </Box>
      <Text color={COLORS.textFaint} dimColor wrap="truncate-end">
        {control}
      </Text>
      {host === null ? (
        <Text color={COLORS.textFaint} dimColor>
          (file mode - no embedded agent)
        </Text>
      ) : lines.length === 0 ? (
        <Text color={COLORS.textFaint} dimColor>
          waiting for output...
        </Text>
      ) : (
        lines.map((line, i) => (
          <Text key={i} color={COLORS.textMuted} wrap="truncate-end">
            {line.length > 0 ? line : ' '}
          </Text>
        ))
      )}
    </Box>
  )
}
