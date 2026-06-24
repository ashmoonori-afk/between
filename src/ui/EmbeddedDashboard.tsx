import { useState, useEffect } from 'react'
import { Box, Text, useApp, useWindowSize } from 'ink'
import { AgentPane } from './AgentPane'
import { EmbeddedBrokerPane } from './EmbeddedBrokerPane'
import { StateRepository } from '../adapters/state-repository'
import { EventsLog } from '../adapters/events-log'
import { SystemClock } from '../core/clock'
import { COLORS } from './theme'
import type { BetweenEvent, BetweenState } from '../core/types'
import type { AgentHost } from '../adapters/agent-host'
import { BrokerCommandInput } from './BrokerCommandInput'
import { computeEmbeddedLayout } from './embedded-layout'

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
 * The one Between-owned window: the broker is the only human input surface, with
 * developer/reviewer panes below as broker-controlled operational logs.
 */
export function EmbeddedDashboard({
  root,
  hosts,
  intervalMs = 1000,
  paneRows = 10,
}: EmbeddedDashboardProps) {
  const { state, events, now } = useBrokerState(root, intervalMs)
  const { exit } = useApp()
  const terminal = useWindowSize()
  const layout = computeEmbeddedLayout(terminal, paneRows)

  useEffect(() => {
    if (!hosts) return
    hosts.developer.resize(layout.agentWidth, layout.agentHeight)
    hosts.reviewer.resize(layout.agentWidth, layout.agentHeight)
  }, [hosts, layout.agentWidth, layout.agentHeight])

  if (!state) {
    return <Text>between: no state - run `between init`</Text>
  }

  return (
    <Box flexDirection="column" width={layout.width}>
      <EmbeddedBrokerPane
        state={state}
        events={events}
        now={now}
        width={layout.width}
        height={layout.brokerHeight}
      />

      <Box flexDirection={layout.agentDirection} width={layout.width}>
        <AgentPane
          host={hosts?.developer ?? null}
          title="DEVELOPER"
          glyph="D"
          accent={COLORS.roleDeveloper}
          rows={layout.agentRows}
          focusId="developer"
          width={layout.agentWidth}
          height={layout.agentHeight}
        />
        <AgentPane
          host={hosts?.reviewer ?? null}
          title="REVIEWER"
          glyph="R"
          accent={COLORS.roleReviewer}
          rows={layout.agentRows}
          focusId="reviewer"
          width={layout.agentWidth}
          height={layout.agentHeight}
        />
      </Box>

      <BrokerCommandInput root={root} state={state} width={layout.width} onQuit={exit} />
    </Box>
  )
}
