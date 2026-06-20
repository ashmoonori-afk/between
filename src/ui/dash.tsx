import { useState, useEffect, useCallback } from 'react'
import { render, useApp, useInput, Text } from 'ink'
import { Dashboard } from './Dashboard'
import { StateRepository } from '../adapters/state-repository'
import { EventsLog } from '../adapters/events-log'
import { SystemClock } from '../core/clock'
import type { BetweenEvent, BetweenState } from '../core/types'
import {
  buildDashboardCommandItems,
  clampCommandIndex,
  commandItemForKey,
  selectEnabledCommand,
  submitDashboardCommand,
  type DashboardCommandItem,
} from './command-palette'

interface DashAppProps {
  root: string
  intervalMs: number
}

function DashApp({ root, intervalMs }: DashAppProps) {
  const [state, setState] = useState<BetweenState | null>(null)
  const [events, setEvents] = useState<BetweenEvent[]>([])
  const [now, setNow] = useState(new SystemClock().nowIso())
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [lastCommandMessage, setLastCommandMessage] = useState<string | null>(null)
  const { exit } = useApp()
  const commandItems = state ? buildDashboardCommandItems(state) : []
  const commandSignature = commandItems
    .map((item) => `${item.id}:${item.enabled ? '1' : '0'}`)
    .join('|')

  useEffect(() => {
    setSelectedCommandIndex((index) => clampCommandIndex(commandItems, index))
  }, [commandSignature])

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
    if (input === 'q') {
      exit()
      return
    }
    if (!state) return

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

    if (input === 'c' || input === ':') {
      setPaletteOpen(true)
      setSelectedCommandIndex((index) => clampCommandIndex(commandItems, index))
      return
    }
    const item = commandItemForKey(commandItems, input)
    if (item) queueCommand(item)
  })

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

  if (!state) {
    return <Text>between: no state found - run `between init`</Text>
  }
  return (
    <Dashboard
      state={state}
      events={events}
      now={now.slice(11, 19)}
      commandPalette={{
        open: paletteOpen,
        selectedIndex: selectedCommandIndex,
        lastMessage: lastCommandMessage,
      }}
    />
  )
}

export interface DashOptions {
  once?: boolean
  intervalMs?: number
}

/** Render the live broker dashboard (real terminal) or a single static frame (`--once`). */
export async function runDashboard(root: string, opts: DashOptions = {}): Promise<void> {
  if (opts.once) {
    const [s, e] = await Promise.all([new StateRepository(root).read(), new EventsLog(root).read()])
    if (!s) {
      process.stdout.write('between: no state found - run `between init`\n')
      return
    }
    const app = render(
      <Dashboard state={s} events={e} now={new SystemClock().nowIso().slice(11, 19)} />,
    )
    app.unmount()
    return
  }
  // defense-in-depth: never let a bad interval collapse setInterval to a tight loop (P2)
  const intervalMs =
    typeof opts.intervalMs === 'number' &&
    Number.isInteger(opts.intervalMs) &&
    opts.intervalMs >= 250
      ? opts.intervalMs
      : 1000
  const app = render(<DashApp root={root} intervalMs={intervalMs} />)
  await app.waitUntilExit()
}
