import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import type { AgentState, BetweenEvent, BetweenState } from '../core/types'
import { COLORS, GLYPH } from './theme'

export const DASHBOARD_WIDTH = 76
export const AGENT_CARD_WIDTH = 38
export const BROKER_DIVIDER_WIDTH = 68
export const SIGNAL_WIDTH = 22
export const SNAPSHOT_WIDTH = 22

export function eventColor(event: string): string {
  if (event.includes('error') || event.includes('timeout') || event === 'verify_failed') {
    return COLORS.error
  }
  if (event === 'verify_passed' || event === 'human_approved') return COLORS.success
  if (event === 'signal_sent') return COLORS.accentAlt
  if (event.startsWith('review')) return COLORS.phaseReviewing
  if (event.startsWith('diff')) return COLORS.phaseDeveloping
  return COLORS.textMuted
}

function agentStatusColor(agent: AgentState): string {
  if (agent.status === 'dead' || agent.status === 'unknown') return COLORS.error
  if (agent.status === 'working' || agent.status === 'reviewing_diff') return COLORS.success
  if (agent.status === 'waiting_for_review' || agent.status === 'applying_review') {
    return COLORS.warning
  }
  return COLORS.textMuted
}

function agentStatusLabel(agent: AgentState): string {
  switch (agent.status) {
    case 'waiting_for_review':
      return 'waiting'
    case 'reviewing_diff':
      return 'reviewing'
    case 'applying_review':
      return 'applying'
    default:
      return agent.status
  }
}

export function short(value: string | null | undefined, width = 12): string {
  if (!value) return '-'
  return value.length <= width ? value : value.slice(0, width)
}

export function truncate(value: string | null | undefined, width: number): string {
  if (!value) return '-'
  if (value.length <= width) return value
  return `${value.slice(0, Math.max(0, width - 3))}...`
}

export function diffSummary(state: BetweenState): string {
  const diff = state.diff
  return `${diff.changed_files} files +${diff.insertions} -${diff.deletions}`
}

export function eventTrail(event: BetweenEvent): string {
  const target = event.target ? ` -> ${event.target}` : ''
  const hash = event.diff_hash ? ` ${short(event.diff_hash)}` : ''
  return `${event.ts.slice(11, 19)} c${event.cycle} ${event.event}${target}${hash}`
}

export function Chip({
  glyph,
  label,
  color,
  dim,
}: {
  glyph: string
  label: string
  color: string
  dim?: boolean
}) {
  return (
    <Text>
      <Text color={color} dimColor={dim}>
        {glyph}
      </Text>
      <Text color={COLORS.textMuted}>{` ${label}`}</Text>
    </Text>
  )
}

export function Divider({ width = 74 }: { width?: number }) {
  return <Text color={COLORS.divider}>{GLYPH.divider.repeat(width)}</Text>
}

export function AgentCard({
  agent,
  title,
  glyph,
  accent,
  width,
  children,
}: {
  agent: AgentState
  title: string
  glyph: string
  accent: string
  width: number
  children: ReactNode
}) {
  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={COLORS.border}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text color={accent} bold>{`${glyph} ${title}`}</Text>
        <Text color={agentStatusColor(agent)}>{agentStatusLabel(agent)}</Text>
      </Box>
      <Text color={COLORS.textMuted}>{agent.name}</Text>
      {children}
    </Box>
  )
}
