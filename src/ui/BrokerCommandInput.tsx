import { useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { CommandBus } from '../adapters/command-bus'
import type { BetweenState } from '../core/types'
import { COLORS, phaseStyle } from './theme'
import { parseBrokerInput } from './broker-input'

interface BrokerCommandInputProps {
  readonly root: string
  readonly state: BetweenState
  readonly width: number
  readonly onQuit: () => void
}

export function BrokerCommandInput({ root, state, width, onQuit }: BrokerCommandInputProps) {
  const [draft, setDraft] = useState('')
  const draftRef = useRef('')
  const [status, setStatus] = useState('broker ready')
  const updateDraft = (value: string): void => {
    draftRef.current = value
    setDraft(value)
  }

  useInput(
    (input, key) => {
      if (key.return) {
        const action = parseBrokerInput(draftRef.current, state)
        if (action.kind === 'quit') {
          onQuit()
          return
        }
        if (action.kind === 'noop') {
          setStatus(action.message)
          return
        }
        setStatus(action.label)
        updateDraft('')
        void new CommandBus(root).submit(action.command).catch((e: unknown) => {
          const message = e instanceof Error ? e.message : String(e)
          setStatus(`send failed: ${message}`)
        })
        return
      }
      if (key.escape) {
        if (draftRef.current.length > 0) {
          updateDraft('')
          setStatus('cleared')
          return
        }
        setStatus('abort queued')
        void new CommandBus(root).submit({ kind: 'interrupt' }).catch((e: unknown) => {
          const message = e instanceof Error ? e.message : String(e)
          setStatus(`send failed: ${message}`)
        })
        return
      }
      if (key.backspace || key.delete) {
        updateDraft(draftRef.current.slice(0, -1))
        return
      }
      if (key.ctrl || key.meta || key.tab || key.upArrow || key.downArrow) return
      if (key.leftArrow || key.rightArrow || key.pageDown || key.pageUp || key.home || key.end)
        return
      const clean = input.replace(/\r|\n/g, '')
      if (clean.length > 0) updateDraft(draftRef.current + clean)
    },
    { isActive: true },
  )

  const label =
    state.workflow.phase === 'idle' || state.workflow.phase === 'done' ? 'GOAL' : 'STEER'
  const ps = phaseStyle(state.workflow.phase)
  const innerWidth = Math.max(16, width - 4)
  const failed = status.startsWith('send failed')
  const rail = fitLine(
    [
      'BETWEEN BROKER',
      `phase ${ps.label}`,
      `cycle ${state.workflow.cycle}`,
      `wait ${state.workflow.waiting_on ?? '-'}`,
      'esc abort',
    ].join(' | '),
    innerWidth,
  )
  const prompt = fitLine(`${label} > ${draft.length > 0 ? draft : '_'}  ${status}`, innerWidth)

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderColor={failed ? COLORS.error : COLORS.brokerPrompt}
      paddingX={1}
    >
      <Text color={COLORS.textMuted} backgroundColor={COLORS.brokerRail} wrap="truncate-end">
        {rail}
      </Text>
      <Text
        color={failed ? COLORS.textPrimary : COLORS.inputText}
        backgroundColor={failed ? COLORS.error : COLORS.brokerInputBg}
        bold
        wrap="truncate-end"
      >
        <Text color={failed ? COLORS.textPrimary : COLORS.brokerPrompt}>{label}</Text>
        {prompt.slice(label.length)}
      </Text>
    </Box>
  )
}

function fitLine(value: string, width: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length >= width) return normalized.slice(0, width)
  return normalized.padEnd(width, ' ')
}
