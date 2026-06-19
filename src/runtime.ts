import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, resolve, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { Clock, ProjectRef, SignalTransport } from './core/types'
import { parseConfig, type BetweenConfig } from './core/config-schema'
import { SystemClock } from './core/clock'
import { initialState } from './core/state'
import { GitAdapter } from './adapters/git'
import { StateRepository } from './adapters/state-repository'
import { EventsLog } from './adapters/events-log'
import { FileTransport } from './adapters/signal-transport'
import { SnapshotStore } from './adapters/snapshot-store'
import { CommandBus } from './adapters/command-bus'
import { BrokerLock } from './adapters/lock'
import { betweenPaths } from './adapters/paths'
import { reconcile } from './daemon/reconcile'
import { Daemon } from './daemon/loop'

export class NotInitializedError extends Error {
  constructor(root: string) {
    super(`No .between/ found in ${root}. Run \`between init\` first.`)
    this.name = 'NotInitializedError'
  }
}

export async function loadConfig(root: string): Promise<BetweenConfig> {
  const p = betweenPaths(root)
  if (!existsSync(p.config)) throw new NotInitializedError(root)
  const raw = await readFile(p.config, 'utf8')
  return parseConfig(parseYaml(raw))
}

function projectRef(root: string, config: BetweenConfig): ProjectRef {
  const absRoot = resolve(root)
  return {
    name: basename(absRoot),
    root: absRoot,
    obsidian_project_path: config.vault_path
      ? join(config.vault_path, 'Between', 'Projects', basename(absRoot))
      : null,
  }
}

/**
 * Assemble all adapters + the Daemon for a target repo. `transport` defaults to
 * FileTransport so every existing caller and test is unchanged; the embed path injects
 * a OneShot/Pty transport instead.
 */
export async function buildDaemon(
  root: string,
  clock: Clock = new SystemClock(),
  transport?: SignalTransport,
): Promise<Daemon> {
  const absRoot = resolve(root)
  const config = await loadConfig(absRoot)
  const stateRepo = new StateRepository(absRoot)
  const existing = await stateRepo.read()
  const initial = existing
    ? reconcile(existing, clock)
    : initialState({ project: projectRef(absRoot, config) }, clock)

  return new Daemon(
    {
      root: absRoot,
      config,
      clock,
      git: new GitAdapter(absRoot),
      state: stateRepo,
      events: new EventsLog(absRoot),
      transport: transport ?? new FileTransport(absRoot),
      snapshots: new SnapshotStore(absRoot),
      commands: new CommandBus(absRoot),
    },
    initial,
  )
}

export interface StartOptions {
  maxTicks?: number
  clock?: Clock
}

/** Acquire the single-writer lock, run the loop, and always release. */
export async function runStart(root: string, opts: StartOptions = {}): Promise<void> {
  const clock = opts.clock ?? new SystemClock()
  const absRoot = resolve(root)
  const lock = new BrokerLock(absRoot)
  await lock.acquire(clock)
  try {
    const daemon = await buildDaemon(absRoot, clock)
    await daemon.load()
    await daemon.run(opts.maxTicks ?? Infinity)
  } finally {
    await lock.releaseLock()
  }
}
