import { Box, Text } from 'ink'
import type { BetweenEvent, BetweenState } from '../core/types'
import { COLORS, GLYPH, phaseStyle } from './theme'

interface DashboardProps {
  state: BetweenState
  events: BetweenEvent[]
  now: string
}

function eventColor(event: string): string {
  if (event.includes('error') || event.includes('timeout')) return COLORS.error
  if (event === 'verify_passed' || event === 'human_approved') return COLORS.success
  if (event === 'signal_sent') return COLORS.accentAlt
  if (event.startsWith('review')) return COLORS.phaseReviewing
  if (event.startsWith('diff')) return COLORS.phaseDeveloping
  return COLORS.textMuted
}

function Chip({
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

function Divider({ width = 72 }: { width?: number }) {
  return <Text color={COLORS.divider}>{'─'.repeat(width)}</Text>
}

/**
 * Broker-dominant 3-region dashboard (blueprint §2/§11, design spec §4):
 * header chrome bar, large broker pane (timeline), bottom dev|reviewer split, and a
 * footer that expands into an approval bar at a human gate (Kiro pattern).
 */
export function Dashboard({ state, events, now }: DashboardProps) {
  const wf = state.workflow
  const ps = phaseStyle(wf.phase)
  const dev = phaseStyle('developing')
  const rev = phaseStyle('reviewing')
  const recent = events.slice(-6)
  const diff = state.diff

  return (
    <Box flexDirection="column">
      {/* header chrome bar */}
      <Box justifyContent="space-between">
        <Text>
          <Text color={COLORS.accent} bold>
            {GLYPH.brand} BETWEEN
          </Text>
          <Text color={COLORS.textMuted}>{`  session:${state.project.name}`}</Text>
        </Text>
        <Text>
          <Chip glyph={ps.glyph} label={ps.label} color={ps.color} dim={ps.dim} />
          <Text color={COLORS.textFaint} dimColor>
            {`   ${now}`}
          </Text>
        </Text>
      </Box>

      {/* broker pane */}
      <Box flexDirection="column" borderStyle="round" borderColor={COLORS.focusRing} paddingX={1}>
        <Text>
          <Text color={ps.color} bold>
            {`${ps.glyph} ${ps.label}`}
          </Text>
          <Text color={COLORS.textMuted}>{`  → ${wf.waiting_on ?? '-'}`}</Text>
          <Text color={COLORS.textFaint} dimColor>
            {`   cycle ${wf.cycle} · this goal ${wf.cycles_this_goal}`}
          </Text>
        </Text>
        <Divider />
        {recent.length === 0 ? (
          <Text color={COLORS.textFaint} dimColor>
            {`${GLYPH.bar} no events yet — run \`between goal "<your goal>"\``}
          </Text>
        ) : (
          recent.map((e, i) => (
            <Text key={`${e.ts}-${i}`}>
              <Text color={i === recent.length - 1 ? ps.color : COLORS.divider}>{GLYPH.bar}</Text>
              <Text color={COLORS.textFaint} dimColor>
                {` ${e.ts.slice(11, 19)} `}
              </Text>
              <Text color={eventColor(e.event)}>{e.event}</Text>
            </Text>
          ))
        )}
        {wf.error ? (
          <Text color={COLORS.error}>{`${GLYPH.flag} ${wf.error.code}: ${wf.error.message}`}</Text>
        ) : null}
      </Box>

      {/* bottom split: developer | reviewer */}
      <Box flexDirection="row">
        <Box
          flexDirection="column"
          flexGrow={1}
          borderStyle="round"
          borderColor={COLORS.border}
          paddingX={1}
        >
          <Text color={dev.color} bold>
            {`${GLYPH.dev} DEVELOPER`}
          </Text>
          <Text
            color={COLORS.textMuted}
          >{`${state.developer.name} · ${state.developer.status}`}</Text>
          <Text>
            <Text color={COLORS.textFaint} dimColor>
              {`${diff.changed_files} files `}
            </Text>
            <Text color={COLORS.success}>{`+${diff.insertions} `}</Text>
            <Text color={COLORS.error}>{`-${diff.deletions}`}</Text>
          </Text>
          <Text color={COLORS.textFaint} dimColor>
            {diff.hash ? `${diff.hash.slice(0, 12)}  ${diff.snapshot_path ?? ''}` : 'no diff'}
          </Text>
        </Box>
        <Box
          flexDirection="column"
          flexGrow={1}
          borderStyle="round"
          borderColor={COLORS.border}
          paddingX={1}
        >
          <Text color={rev.color} bold>
            {`${GLYPH.reviewer} REVIEWER`}
          </Text>
          <Text
            color={COLORS.textMuted}
          >{`${state.reviewer.name} · ${state.reviewer.status}`}</Text>
          <Text color={COLORS.textFaint} dimColor>
            {wf.last_reviewed_hash
              ? `last reviewed ${wf.last_reviewed_hash.slice(0, 12)}`
              : 'no review yet'}
          </Text>
        </Box>
      </Box>

      {/* footer: approval bar at a human gate, else a hint line */}
      {wf.phase === 'human_gate' ? (
        <Box borderStyle="round" borderColor={COLORS.phaseApproval} paddingX={1}>
          <Text>
            <Text color={COLORS.phaseApproval}>{`${GLYPH.pause} Approval needed `}</Text>
            <Text color={COLORS.textMuted}>{'· '}</Text>
            <Text color={COLORS.success}>{'between approve merge'}</Text>
            <Text color={COLORS.textMuted}>{'   or   '}</Text>
            <Text color={COLORS.accentAlt}>{'between goal "<next>"'}</Text>
          </Text>
        </Box>
      ) : (
        <Text color={COLORS.textFaint} dimColor>
          {'between goal · pause · resume · review-now · approve · status'}
        </Text>
      )}
    </Box>
  )
}
