import { Box, Text } from 'ink'
import type { BetweenEvent, BetweenState } from '../core/types'
import type { DashboardCommandPaletteState } from './command-palette'
import { buildDashboardCommandItems } from './command-palette'
import { CommandPalette } from './CommandPalette'
import {
  AGENT_CARD_WIDTH,
  AgentCard,
  BROKER_DIVIDER_WIDTH,
  Chip,
  DASHBOARD_WIDTH,
  Divider,
  SIGNAL_WIDTH,
  SNAPSHOT_WIDTH,
  diffSummary,
  eventColor,
  eventTrail,
  short,
  truncate,
} from './DashboardParts'
import { COLORS, GLYPH, phaseStyle } from './theme'

interface DashboardProps {
  state: BetweenState
  events: BetweenEvent[]
  now: string
  commandPalette?: DashboardCommandPaletteState
}

export function Dashboard({ state, events, now, commandPalette }: DashboardProps) {
  const wf = state.workflow
  const ps = phaseStyle(wf.phase)
  const dev = phaseStyle('developing')
  const rev = phaseStyle('reviewing')
  const recent = events.slice(-6)
  const diff = state.diff
  const bundle = diff.bundle_id ?? diff.bundle_path
  const signal = state.broker.last_signal
  const commandItems = buildDashboardCommandItems(state)
  const palette = commandPalette ?? { open: false, selectedIndex: 0, lastMessage: null }

  return (
    <Box flexDirection="column" width={DASHBOARD_WIDTH}>
      <Box justifyContent="space-between" width={DASHBOARD_WIDTH}>
        <Text>
          <Text color={COLORS.accent} bold>
            {`${GLYPH.brand} BETWEEN`}
          </Text>
          <Text color={COLORS.textMuted}>{`  session:${state.project.name}`}</Text>
        </Text>
        <Text>
          <Chip glyph={ps.glyph} label={ps.label} color={ps.color} dim={ps.dim} />
          <Text color={COLORS.textFaint} dimColor>{`   ${now}`}</Text>
        </Text>
      </Box>

      <Box
        flexDirection="column"
        width={DASHBOARD_WIDTH}
        borderStyle="round"
        borderColor={COLORS.focusRing}
        paddingX={1}
      >
        <Box justifyContent="space-between">
          <Text color={ps.color} bold>{`${ps.glyph} BROKER`}</Text>
          <Text color={COLORS.textMuted}>{`broker ${state.broker.status}`}</Text>
        </Box>
        <Text>
          <Text color={COLORS.textFaint} dimColor>
            PHASE{' '}
          </Text>
          <Text color={ps.color}>{ps.label}</Text>
          <Text color={COLORS.textFaint} dimColor>{`   WAIT ${wf.waiting_on ?? '-'}`}</Text>
          <Text color={COLORS.textFaint} dimColor>{`   CYCLE ${wf.cycle}`}</Text>
          <Text color={COLORS.textFaint} dimColor>{`   GOAL ${wf.cycles_this_goal}`}</Text>
        </Text>
        <Text>
          <Text color={COLORS.textFaint} dimColor>
            DIFF{' '}
          </Text>
          <Text color={diff.hash ? COLORS.phaseDeveloping : COLORS.textMuted}>
            {diffSummary(state)}
          </Text>
          <Text color={COLORS.textFaint} dimColor>{`   HASH ${short(diff.hash)}`}</Text>
          <Text color={COLORS.textFaint} dimColor>
            {`   BUNDLE ${short(bundle, 13)}`}
          </Text>
        </Text>
        <Text>
          <Text color={COLORS.textFaint} dimColor>
            REVIEW{' '}
          </Text>
          <Text color={wf.last_reviewed_hash ? COLORS.phaseReviewing : COLORS.textMuted}>
            {short(wf.last_reviewed_hash)}
          </Text>
          <Text color={COLORS.textFaint} dimColor>
            {`   SIGNAL ${truncate(signal, SIGNAL_WIDTH)}`}
          </Text>
          <Text color={COLORS.textFaint} dimColor>{`   TRUST ${state.evidence_trust}`}</Text>
        </Text>
        <Divider width={BROKER_DIVIDER_WIDTH} />
        {recent.length === 0 ? (
          <Text color={COLORS.textFaint} dimColor>
            {`${GLYPH.bar} no events yet`}
          </Text>
        ) : (
          recent.map((event, index) => (
            <Text key={`${event.ts}-${index}`}>
              <Text color={index === recent.length - 1 ? ps.color : COLORS.divider}>
                {GLYPH.bar}
              </Text>
              <Text color={COLORS.textFaint} dimColor>
                {' '}
              </Text>
              <Text color={eventColor(event.event)}>{eventTrail(event)}</Text>
            </Text>
          ))
        )}
        {wf.error ? (
          <Text color={COLORS.error}>{`${GLYPH.flag} ${wf.error.code}: ${wf.error.message}`}</Text>
        ) : null}
      </Box>

      <Box flexDirection="row" width={DASHBOARD_WIDTH}>
        <AgentCard
          agent={state.developer}
          title="DEVELOPER"
          glyph={GLYPH.dev}
          accent={dev.color}
          width={AGENT_CARD_WIDTH}
        >
          <Text>
            <Text color={COLORS.textFaint} dimColor>
              DIFF{' '}
            </Text>
            <Text color={COLORS.textMuted}>{diffSummary(state)}</Text>
          </Text>
          <Text color={COLORS.textFaint} dimColor>
            {`HASH ${short(diff.hash)}`}
          </Text>
          <Text color={COLORS.textFaint} dimColor>
            {`SNAP ${truncate(diff.snapshot_path, SNAPSHOT_WIDTH)}`}
          </Text>
        </AgentCard>
        <AgentCard
          agent={state.reviewer}
          title="REVIEWER"
          glyph={GLYPH.reviewer}
          accent={rev.color}
          width={AGENT_CARD_WIDTH}
        >
          <Text>
            <Text color={COLORS.textFaint} dimColor>
              REVIEW{' '}
            </Text>
            <Text color={COLORS.textMuted}>{short(wf.last_reviewed_hash)}</Text>
          </Text>
          <Text color={COLORS.textFaint} dimColor>
            {`BUNDLE ${short(diff.bundle_id ?? diff.bundle_path, 13)}`}
          </Text>
          <Text color={COLORS.textFaint} dimColor>
            {`TRUST ${state.evidence_trust}`}
          </Text>
        </AgentCard>
      </Box>

      {wf.phase === 'human_gate' ? (
        <Box
          width={DASHBOARD_WIDTH}
          borderStyle="round"
          borderColor={COLORS.phaseApproval}
          paddingX={1}
        >
          <Text>
            <Text color={COLORS.phaseApproval}>{`${GLYPH.pause} Approval needed`}</Text>
            <Text color={COLORS.textMuted}>{' | approve: '}</Text>
            <Text color={COLORS.success}>{'between approve merge'}</Text>
            <Text color={COLORS.textMuted}>{' | next: '}</Text>
            <Text color={COLORS.accentAlt}>{'between goal "<next>"'}</Text>
          </Text>
        </Box>
      ) : null}

      <CommandPalette
        open={palette.open}
        selectedIndex={palette.selectedIndex}
        lastMessage={palette.lastMessage}
        items={commandItems}
        width={DASHBOARD_WIDTH}
      />
    </Box>
  )
}
