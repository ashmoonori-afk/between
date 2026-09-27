import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { render } from 'ink'
import type { Clock, SignalTransport } from '../core/types'
import { SystemClock } from '../core/clock'
import { BrokerLock } from '../adapters/lock'
import { buildDaemon, loadConfig } from '../runtime'
import type { Daemon } from '../daemon/loop'
import { OneShotTransport, PtyTransport, RoleSplitTransport } from '../adapters/pty-transport'
import { PipeAgentHost } from '../adapters/pipe-agent-host'
import { PtyAgentHost, PtyUnavailableError } from '../adapters/pty-agent-host'
import type { AgentHost, AgentRole } from '../adapters/agent-host'
import type { AgentControl } from '../adapters/agent-control'
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
  let agentControl: AgentControl | undefined
  let mode = config.agent_mode
  let stopDeathWiring: Array<() => void> = []

  try {
    if (mode === 'pty') {
      try {
        const developer = new PtyAgentHost('developer', scrollback, {
          command: config.developer_command,
          root: absRoot,
          cwd,
        })
        await developer.start()
        const reviewerPane = new PipeAgentHost('reviewer', scrollback)
        reviewerPane.feed('[between] reviewer standby - waiting for broker review bundle\n')
        hosts = { developer, reviewer: reviewerPane }
        const ptyTransport = new PtyTransport(absRoot, { hosts: { developer } })
        const reviewerTransport = new OneShotTransport(absRoot, {
          developerCommand: config.developer_command,
          reviewerCommand: reviewerOneShotCommand(absRoot, config.reviewer_command),
          cwd,
          hosts: { reviewer: reviewerPane },
        })
        const splitTransport = new RoleSplitTransport(ptyTransport, reviewerTransport)
        transport = splitTransport
        agentControl = splitTransport
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
      const oneShotTransport = new OneShotTransport(absRoot, {
        developerCommand: config.developer_command,
        reviewerCommand: config.reviewer_command,
        cwd,
        hosts,
      })
      transport = oneShotTransport
      agentControl = oneShotTransport
    }
    // mode === 'file' -> hosts stays null, transport stays undefined (FileTransport default)

    const daemon = await buildDaemon(absRoot, clock, transport, agentControl)
    await daemon.load()
    stopDeathWiring = wireAgentDeaths(hosts, daemon)

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
    await shutdownEmbedded({ agentControl, hosts, lock })
  }
}

/**
 * Stop order matters: oneshot agent processes are owned by the transport (the pipe hosts are
 * passive), so abort them and wait for them to exit before stopping the hosts and releasing the
 * lock. Otherwise a new broker could start while the old broker's agents keep writing.
 */
export async function shutdownEmbedded(parts: {
  agentControl?: AgentControl
  hosts: Hosts
  lock: Pick<BrokerLock, 'releaseLock'>
}): Promise<void> {
  await parts.agentControl?.abortActive('broker stopping').catch(() => {})
  if (parts.hosts) {
    await parts.hosts.developer.stop().catch(() => {})
    await parts.hosts.reviewer.stop().catch(() => {})
  }
  await parts.lock.releaseLock()
}

export function reviewerOneShotCommand(root: string, command: string): string {
  const trimmed = command.trim()
  const preset =
    trimmed === 'codex' ? 'codex-agent.mjs' : trimmed === 'claude' ? 'claude-agent.mjs' : ''
  if (!preset) return command
  return existsSync(join(root, '.between', 'agents', preset))
    ? `node .between/agents/${preset} reviewer`
    : command
}

/**
 * Route agent exits to the daemon. A pty agent is long-lived, so any exit is a death (except a
 * deliberate stop while paused). A oneshot (pipe) agent exits after every signal, so only a
 * non-zero exit code is a failure; exit 0 is normal and a null code means it was aborted.
 */
export function wireAgentDeaths(
  hosts: Hosts,
  daemon: Pick<Daemon, 'reportAgentDied' | 'state'>,
): Array<() => void> {
  if (!hosts) return []
  return (['developer', 'reviewer'] as const).map((role: AgentRole) =>
    hosts[role].subscribeExit((event) => {
      if (event.kind === 'pty') {
        if (event.exitCode === null && daemon.state.workflow.phase === 'paused') return
      } else if (event.exitCode === null || event.exitCode === 0) {
        return
      }
      void daemon.reportAgentDied(event.role, event.exitCode)
    }),
  )
}
