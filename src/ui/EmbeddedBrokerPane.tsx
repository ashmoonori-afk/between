import { Box, Text } from 'ink'
import type { BetweenEvent, BetweenState } from '../core/types'
import { diffSummary, eventColor, eventTrail, short, truncate } from './DashboardParts'
import { COLORS, GLYPH, phaseStyle } from './theme'

interface EmbeddedBrokerPaneProps {
  readonly state: BetweenState
  readonly events: readonly BetweenEvent[]
  readonly now: string
  readonly width: number
  readonly height: number
}

export function EmbeddedBrokerPane({ state, events, now, width, height }: EmbeddedBrokerPaneProps) {
  const wf = state.workflow
  const ps = phaseStyle(wf.phase)
  const diff = state.diff
  const recent = events.slice(-Math.max(1, height - 8))
  const bundle = diff.bundle_id ?? diff.bundle_path

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="round"
      borderColor={COLORS.focusRing}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text color={COLORS.accent} bold>
          {`${GLYPH.brand} BROKER FIELD`}
        </Text>
        <Text color={ps.color} bold wrap="truncate-end">
          {`${ps.glyph} ${ps.label}  ${now.slice(11, 19)}`}
        </Text>
      </Box>
      <Text wrap="truncate-end">
        <Text color={COLORS.textFaint} dimColor>
          PROJECT{' '}
        </Text>
        <Text color={COLORS.textMuted}>{state.project.name}</Text>
        <Text color={COLORS.textFaint} dimColor>{`  TRUST ${state.evidence_trust}`}</Text>
      </Text>
      <Text wrap="truncate-end">
        <Text color={COLORS.textFaint} dimColor>
          PHASE{' '}
        </Text>
        <Text color={ps.color}>{ps.label}</Text>
        <Text color={COLORS.textFaint} dimColor>{`  WAIT ${wf.waiting_on ?? '-'}`}</Text>
        <Text color={COLORS.textFaint} dimColor>{`  CYCLE ${wf.cycle}`}</Text>
        <Text color={COLORS.textFaint} dimColor>{`  GOAL ${wf.cycles_this_goal}`}</Text>
      </Text>
      <Text wrap="truncate-end">
        <Text color={COLORS.textFaint} dimColor>
          DIFF{' '}
        </Text>
        <Text color={diff.hash ? COLORS.phaseDeveloping : COLORS.textMuted}>
          {diffSummary(state)}
        </Text>
        <Text color={COLORS.textFaint} dimColor>{`  HASH ${short(diff.hash)}`}</Text>
        <Text color={COLORS.textFaint} dimColor>{`  BUNDLE ${short(bundle, 13)}`}</Text>
      </Text>
      <Text wrap="truncate-end">
        <Text color={COLORS.textFaint} dimColor>
          SIGNAL{' '}
        </Text>
        <Text color={COLORS.textMuted}>
          {truncate(state.broker.last_signal, Math.max(12, width - 18))}
        </Text>
      </Text>
      {recent.length === 0 ? (
        <Text color={COLORS.textFaint} dimColor>
          {`${GLYPH.bar} no events yet`}
        </Text>
      ) : (
        recent.map((event, index) => (
          <Text key={`${event.ts}-${index}`} wrap="truncate-end">
            <Text color={index === recent.length - 1 ? ps.color : COLORS.divider}>{GLYPH.bar}</Text>
            <Text color={COLORS.textFaint} dimColor>
              {' '}
            </Text>
            <Text color={eventColor(event.event)}>{eventTrail(event)}</Text>
          </Text>
        ))
      )}
      {wf.error ? (
        <Text color={COLORS.error} wrap="truncate-end">
          {`${GLYPH.flag} ${wf.error.code}: ${wf.error.message}`}
        </Text>
      ) : null}
    </Box>
  )
}
