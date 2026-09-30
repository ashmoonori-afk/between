import type { EventsLog } from '../adapters/events-log'
import type { StateRepository } from '../adapters/state-repository'
import type { BetweenState } from '../core/types'
import { replayStateFromEvents, ReplayError } from '../core/replay'

export async function readRecoverableState(
  state: StateRepository,
  events: EventsLog,
): Promise<BetweenState | null> {
  const [primary, backup, entries] = await Promise.all([
    state.readPrimary(),
    state.readBackup(),
    events.read(),
  ])
  // before any recovery path: a journal rolled back or deleted behind its out-of-workspace anchor
  // must stop the broker, not be recovered from
  await events.assertAnchored(entries)
  if (entries.length === 0) return primary ?? backup
  try {
    return replayStateFromEvents(entries, primary?.journal ?? backup?.journal ?? null)
  } catch (error) {
    if (error instanceof ReplayError && error.code === 'missing_replay_state') {
      return primary ?? backup
    }
    throw error
  }
}
