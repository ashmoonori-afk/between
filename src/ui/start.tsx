import { resolve } from 'node:path'
import { render } from 'ink'
import type { Clock, SignalTransport } from '../core/types'
import { SystemClock } from '../core/clock'
import { BrokerLock } from '../adapters/lock'
import { buildDaemon, loadConfig } from '../runtime'
import type { Daemon } from '../daemon/loop'
import { OneShotTransport, PtyTransport } from '../adapters/pty-transport'
import { PipeAgentHost } from '../adapters/pipe-agent-host'
import { PtyAgentHost, PtyUnavailableError } from '../adapters/pty-agent-host'
import type { AgentHost, AgentRole } from '../adapters/agent-host'
import { EmbeddedDashboard } from './EmbeddedDashboard'
import { print } from '../cli/output'

export interface EmbedStartOptions {
  clock?: Clock
  maxTicks?: number
  /** force the no-UI loop even on a TTY (used for non-interactive demos/tests) */
  headless?: boolean
}

type Hosts = { developer: AgentHost; reviewer: AgentHost } | null

/**
 * `between start --embed`: one Between-owned window hosting the broker + two live agent
 * regions. Selects transport/hosts from config.agent_mode (file | oneshot | pty), with a
 * pty→pipe/one-shot degrade when no prebuilt node-pty binary loads. Runs the daemon loop
 * concurrently with the Ink dashboard; on a non-TTY (or --headless) it runs the loop only.
 */
export async function runStartEmbedded(root: string, opts: EmbedStartOptions = {}): Promise<void> {
  const clock = opts.clock ?? new SystemClock()
  const absRoot = resolve(root)
  const config = await loadConfig(absRoot)
  const cwd = config.agent_cwd ? resolve(config.agent_cwd) : absRoot
  const scrollback = config.agent_pane_scrollback

  const lock = new BrokerLock(absRoot)
  await lock.acquire(clock)

  let hosts: Hosts = null
  let transport: SignalTransport | undefined
  let mode = config.agent_mode
  let stopDeathWiring: Array<() => void> = []

  try {
    if (mode === 'pty') {
      try {
        const developer = new PtyAgentHost('developer', scrollback, {
          command: config.developer_command,
          cwd,
        })
        const reviewer = new PtyAgentHost('reviewer', scrollback, {
          command: config.reviewer_command,
          cwd,
        })
        await developer.start()
        await reviewer.start()
        hosts = { developer, reviewer }
        transport = new PtyTransport(absRoot, { hosts })
      } catch (e) {
        if (!(e instanceof PtyUnavailableError)) throw e
        print('between: PTY unavailable — falling back to pipe / one-shot')
        mode = 'oneshot'
      }
    }

    if (mode === 'oneshot') {
      const developer = new PipeAgentHost('developer', scrollback)
      const reviewer = new PipeAgentHost('reviewer', scrollback)
      hosts = { developer, reviewer }
      transport = new OneShotTransport(absRoot, {
        developerCommand: config.developer_command,
        reviewerCommand: config.reviewer_command,
        cwd,
        hosts,
      })
    }
    // mode === 'file' -> hosts stays null, transport stays undefined (FileTransport default)

    const daemon = await buildDaemon(absRoot, clock, transport)
    await daemon.load()
    stopDeathWiring = wirePtyDeaths(hosts, daemon)

    const useUi = Boolean(process.stdout.isTTY) && !opts.headless
    if (useUi) {
      const loop = daemon.run(opts.maxTicks ?? Infinity)
      const app = render(
        <EmbeddedDashboard
          root={absRoot}
          hosts={hosts}
          paneRows={config.agent_pane_visible_rows}
        />,
      )
      await app.waitUntilExit()
      daemon.requestStop()
      await loop
    } else {
      print(`between: embedded broker running (${mode} mode, no TTY)`)
      await daemon.run(opts.maxTicks ?? Infinity)
    }
  } finally {
    for (const stop of stopDeathWiring) stop()
    if (hosts) {
      await hosts.developer.stop().catch(() => {})
      await hosts.reviewer.stop().catch(() => {})
    }
    await lock.releaseLock()
  }
}

function wirePtyDeaths(hosts: Hosts, daemon: Daemon): Array<() => void> {
  if (!hosts) return []
  return (['developer', 'reviewer'] as const).flatMap((role: AgentRole) => {
    const host = hosts[role]
    if (host.kind !== 'pty') return []
    return [
      host.subscribeExit((event) => {
        void daemon.reportAgentDied(event.role, event.exitCode)
      }),
    ]
  })
}
