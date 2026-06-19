import { useState, useEffect } from 'react'
import { render, useApp, useInput, Text } from 'ink'
import { Dashboard } from './Dashboard'
import { StateRepository } from '../adapters/state-repository'
import { EventsLog } from '../adapters/events-log'
import { SystemClock } from '../core/clock'
import type { BetweenEvent, BetweenState } from '../core/types'

interface DashAppProps {
  root: string
  intervalMs: number
}

function DashApp({ root, intervalMs }: DashAppProps) {
  const [state, setState] = useState<BetweenState | null>(null)
  const [events, setEvents] = useState<BetweenEvent[]>([])
  const [now, setNow] = useState(new SystemClock().nowIso())
  const { exit } = useApp()

  useInput((input) => {
    if (input === 'q') exit()
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
    return <Text>between: no state found — run `between init`</Text>
  }
  return <Dashboard state={state} events={events} now={now.slice(11, 19)} />
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
      process.stdout.write('between: no state found — run `between init`\n')
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
