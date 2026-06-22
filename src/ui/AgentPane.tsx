import { useState, useEffect } from 'react'
import { Box, Text, useFocus, useInput } from 'ink'
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
  inputActive?: boolean
}

/**
 * Renders a bounded, ANSI-stripped TAIL of one agent's output. Source-agnostic: identical
 * for pipe (one-shot) and pty hosts. Draws a focus ring when selected (Tab cycles focus).
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
  inputActive,
}: AgentPaneProps) {
  const canInput = host?.kind === 'pty' && Boolean(host.snapshot().alive)
  const { isFocused } = useFocus({ id: focusId, autoFocus: canInput })
  const acceptsInput = inputActive ?? canInput
  const [buf, setBuf] = useState<AgentOutputBuffer | null>(host ? host.snapshot() : null)
  const [draft, setDraft] = useState('')
  const [inputStatus, setInputStatus] = useState<string | null>(null)

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
  const exitText = exitCode === null ? '' : ` (exit ${exitCode})`
  const status = !host ? 'not hosted' : buf?.alive ? 'live' : dead ? `dead${exitText}` : 'idle'
  const statusColor = !host
    ? COLORS.textFaint
    : dead
      ? COLORS.error
      : buf?.alive
        ? COLORS.success
        : COLORS.textMuted

  useInput(
    (input, key) => {
      if (!host || !canInput) return
      if (key.return) {
        const body = draft.trim()
        if (body.length === 0) return
        setInputStatus('sent')
        setDraft('')
        void host.deliver(body).catch((e: unknown) => {
          const message = e instanceof Error ? e.message : String(e)
          setInputStatus(`send failed: ${message}`)
        })
        return
      }
      if (key.escape) {
        setDraft('')
        setInputStatus('cleared')
        return
      }
      if (key.backspace || key.delete) {
        setDraft((prev) => prev.slice(0, -1))
        return
      }
      if (key.ctrl || key.meta || key.tab || key.upArrow || key.downArrow) return
      if (key.leftArrow || key.rightArrow || key.pageDown || key.pageUp || key.home || key.end)
        return
      const clean = input.replace(/\r|\n/g, '')
      if (clean.length > 0) {
        setInputStatus(null)
        setDraft((prev) => prev + clean)
      }
    },
    { isActive: canInput && acceptsInput },
  )

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      width={width}
      height={height}
      borderStyle="round"
      borderColor={isFocused ? COLORS.focusRing : COLORS.border}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text color={accent} bold>
          {`${glyph} ${title} FIELD`}
        </Text>
        <Text color={statusColor}>{status}</Text>
      </Box>
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
      <Box justifyContent="space-between">
        <Text color={canInput ? COLORS.textPrimary : COLORS.textFaint} wrap="truncate-end">
          {canInput ? `> ${draft}` : '> manual input disabled'}
        </Text>
        {inputStatus ? (
          <Text color={inputStatus.startsWith('send failed') ? COLORS.error : COLORS.textMuted}>
            {inputStatus}
          </Text>
        ) : null}
      </Box>
    </Box>
  )
}
