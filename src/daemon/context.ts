import type { BetweenConfig } from '../core/config-schema'
import type { BetweenState, Clock, EventName, SignalTarget, SignalTransport } from '../core/types'
import type { GitAdapter } from '../adapters/git'
import type { StateRepository } from '../adapters/state-repository'
import type { EventsLog } from '../adapters/events-log'
import type { SnapshotStore } from '../adapters/snapshot-store'
import type { CommandBus } from '../adapters/command-bus'

export interface DaemonDeps {
  root: string
  config: BetweenConfig
  clock: Clock
  git: GitAdapter
  state: StateRepository
  events: EventsLog
  transport: SignalTransport
  snapshots: SnapshotStore
  commands: CommandBus
  log?: (msg: string) => void
}

export interface EmitExtra {
  target?: SignalTarget
  diff_hash?: string
  detail?: Record<string, unknown>
}

/**
 * The seam through which the extracted phase/command handlers (phases.ts, commands.ts)
 * reach daemon state. The `Daemon` class in loop.ts owns the single-writer implementation
 * of persist/emit/dispatch; `current()` is a LIVE getter (not a snapshot) because handlers
 * read state again after awaiting persist/dispatch.
 */
export interface DaemonContext {
  readonly deps: DaemonDeps
  current(): BetweenState
  persist(next: BetweenState): Promise<void>
  emit(event: string, extra?: EmitExtra): Promise<void>
  dispatch(
    event: EventName,
    mutate?: (s: BetweenState) => BetweenState,
    extra?: EmitExtra,
  ): Promise<boolean>
  requestStop(): void
}
