import { useState, useEffect, useCallback } from 'react'
import { Box, Text, useApp, useInput, useFocusManager, useWindowSize } from 'ink'
import { AgentPane } from './AgentPane'
import { EmbeddedBrokerPane } from './EmbeddedBrokerPane'
import { StateRepository } from '../adapters/state-repository'
import { EventsLog } from '../adapters/events-log'
import { SystemClock } from '../core/clock'
import { COLORS, phaseStyle } from './theme'
import type { BetweenEvent, BetweenState } from '../core/types'
import type { AgentHost } from '../adapters/agent-host'
import { CommandPalette } from './CommandPalette'
import { computeEmbeddedLayout } from './embedded-layout'
import {
  buildDashboardCommandItems,
  clampCommandIndex,
  commandItemForKey,
  selectEnabledCommand,
  submitDashboardCommand,
  type DashboardCommandItem,
} from './command-palette'

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
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [lastCommandMessage, setLastCommandMessage] = useState<string | null>(null)
  const { exit } = useApp()
  const { focusNext, focus, activeId } = useFocusManager()
  const terminal = useWindowSize()
  const layout = computeEmbeddedLayout(terminal, paneRows)
  const commandItems = state ? buildDashboardCommandItems(state) : []
  const commandSignature = commandItems
    .map((item) => `${item.id}:${item.enabled ? '1' : '0'}`)
    .join('|')

  useEffect(() => {
    setSelectedCommandIndex((index) => clampCommandIndex(commandItems, index))
  }, [commandSignature])

  useEffect(() => {
    if (activeId || !hosts) return
    if (hosts.developer.kind === 'pty') {
      focus('developer')
      return
    }
    if (hosts.reviewer.kind === 'pty') focus('reviewer')
  }, [activeId, focus, hosts])

  useEffect(() => {
    if (!hosts) return
    hosts.developer.resize(layout.agentWidth, layout.agentHeight)
    hosts.reviewer.resize(layout.agentWidth, layout.agentHeight)
  }, [hosts, layout.agentWidth, layout.agentHeight])

  const queueCommand = useCallback(
    (item: DashboardCommandItem) => {
      if (!item.enabled) {
        setLastCommandMessage(`${item.label} unavailable`)
        return
      }
      setPaletteOpen(false)
      setLastCommandMessage(`${item.label} queued`)
      void submitDashboardCommand(root, item).catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e)
        setLastCommandMessage(`${item.label} failed: ${message}`)
      })
    },
    [root],
  )

  useInput((input, key) => {
    if (!state) {
      if (input === 'q' || (key.ctrl && input === 'q')) exit()
      return
    }

    const agentFocused = activeId === 'developer' || activeId === 'reviewer'

    if (paletteOpen) {
      if (key.escape || input === 'c') {
        setPaletteOpen(false)
        return
      }
      if (key.downArrow || input === 'j') {
        setSelectedCommandIndex((index) => selectEnabledCommand(commandItems, index, 1))
        return
      }
      if (key.upArrow || input === 'k') {
        setSelectedCommandIndex((index) => selectEnabledCommand(commandItems, index, -1))
        return
      }
      if (key.return) {
        const item = commandItems[selectedCommandIndex]
        if (item) queueCommand(item)
        return
      }
      const item = commandItemForKey(commandItems, input)
      if (item) queueCommand(item)
      return
    }

    if (agentFocused) {
      if (key.tab) {
        focusNext()
        return
      }
      if (key.escape) {
        const item = commandItemForKey(commandItems, 'escape')
        if (item) queueCommand(item)
        return
      }
      if (key.ctrl && input === 'q') exit()
      return
    }

    if (input === 'q') {
      exit()
      return
    }
    if (key.tab) {
      focusNext()
      return
    }
    if (input === 'c' || input === ':') {
      setPaletteOpen(true)
      setSelectedCommandIndex((index) => clampCommandIndex(commandItems, index))
      return
    }
    if (key.escape) {
      const item = commandItemForKey(commandItems, 'escape')
      if (item) queueCommand(item)
      return
    }
    const item = commandItemForKey(commandItems, input)
    if (item) queueCommand(item)
  })

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
          accent={phaseStyle('developing').color}
          rows={layout.agentRows}
          focusId="developer"
          width={layout.agentWidth}
          height={layout.agentHeight}
          inputActive={activeId === 'developer'}
        />
        <AgentPane
          host={hosts?.reviewer ?? null}
          title="REVIEWER"
          glyph="R"
          accent={phaseStyle('reviewing').color}
          rows={layout.agentRows}
          focusId="reviewer"
          width={layout.agentWidth}
          height={layout.agentHeight}
          inputActive={activeId === 'reviewer'}
        />
      </Box>

      <CommandPalette
        open={paletteOpen}
        selectedIndex={selectedCommandIndex}
        lastMessage={lastCommandMessage}
        items={commandItems}
        width={layout.width}
        extraKeys="tab pane | type in pty"
      />
    </Box>
  )
}
