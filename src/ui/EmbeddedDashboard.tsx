import { useState, useEffect } from 'react'
import { Box, Text, useApp, useInput, useFocusManager } from 'ink'
import { AgentPane } from './AgentPane'
import { StateRepository } from '../adapters/state-repository'
import { EventsLog } from '../adapters/events-log'
import { SystemClock } from '../core/clock'
import { COLORS, GLYPH, phaseStyle } from './theme'
import type { BetweenEvent, BetweenState } from '../core/types'
import type { AgentHost } from '../adapters/agent-host'

/** Poll `.between/state.json` + events on an interval (shared broker-state hook). */
export function useBrokerState(
  root: string,
  intervalMs: number,
): { state: BetweenState | null; events: BetweenEvent[]; now: string } {
  const [state, setState] = useState<BetweenState | null>(null)
  const [events, setEvents] = useState<BetweenEvent[]>([])
  const [now, setNow] = useState(new SystemClock().nowIso())

  useEffect(() => {
    const repo = new StateRepository(root)
    const log = new EventsLog(root)
    let active = true
    const refresh = async () => {
      const [s, e] = await Promise.all([repo.read(), log.read()])
      if (!active) return
      if (s) setState(s)
      setEvents(e)
      setNow(new SystemClock().nowIso())
    }
    void refresh()
    const timer = setInterval(() => void refresh(), intervalMs)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [root, intervalMs])

  return { state, events, now }
}

interface EmbeddedDashboardProps {
  root: string
  hosts: { developer: AgentHost; reviewer: AgentHost } | null
  intervalMs?: number
  paneRows?: number
}

/**
 * The one Between-owned window: a compact broker strip on top, two LIVE agent panes below
 * (developer=Claude, reviewer=Codex). Tab cycles the focus ring; q quits.
 */
export function EmbeddedDashboard({
  root,
  hosts,
  intervalMs = 1000,
  paneRows = 10,
}: EmbeddedDashboardProps) {
  const { state, events, now } = useBrokerState(root, intervalMs)
  const { exit } = useApp()
  const { focusNext } = useFocusManager()

  useInput((input, key) => {
    if (input === 'q') exit()
    else if (key.tab) focusNext()
  })

  if (!state) {
    return <Text>between: no state — run `between init`</Text>
  }

  const wf = state.workflow
  const ps = phaseStyle(wf.phase)
  const recent = events.slice(-4)

  return (
    <Box flexDirection="column">
      {/* compact broker strip */}
      <Box flexDirection="column" borderStyle="round" borderColor={COLORS.focusRing} paddingX={1}>
        <Box justifyContent="space-between">
          <Text>
            <Text color={COLORS.accent} bold>
              {`${GLYPH.brand} BETWEEN`}
            </Text>
            <Text color={COLORS.textMuted}>{`  ${state.project.name}`}</Text>
          </Text>
          <Text>
            <Text color={ps.color} bold>
              {`${ps.glyph} ${ps.label}`}
            </Text>
            <Text color={COLORS.textFaint} dimColor>
              {`  cycle ${wf.cycle} · → ${wf.waiting_on ?? '-'} · ${now.slice(11, 19)}`}
            </Text>
          </Text>
        </Box>
        {recent.map((e, i) => (
          <Text key={`${e.ts}-${i}`} color={COLORS.textFaint} dimColor>
            {`${GLYPH.bar} ${e.ts.slice(11, 19)} ${e.event}`}
          </Text>
        ))}
        {wf.error ? (
          <Text color={COLORS.error}>{`${GLYPH.flag} ${wf.error.code}: ${wf.error.message}`}</Text>
        ) : null}
      </Box>

      {/* live agent panes */}
      <Box flexDirection="row">
        <AgentPane
          host={hosts?.developer ?? null}
          title="DEVELOPER"
          glyph={GLYPH.dev}
          accent={phaseStyle('developing').color}
          rows={paneRows}
          focusId="developer"
        />
        <AgentPane
          host={hosts?.reviewer ?? null}
          title="REVIEWER"
          glyph={GLYPH.reviewer}
          accent={phaseStyle('reviewing').color}
          rows={paneRows}
          focusId="reviewer"
        />
      </Box>

      <Text color={COLORS.textFaint} dimColor>
        {`${GLYPH.pause} Tab: focus pane · q: quit · broker drives the loop in the background`}
      </Text>
    </Box>
  )
}
