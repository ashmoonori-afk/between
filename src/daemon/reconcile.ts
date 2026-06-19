import type { BetweenState, Clock } from '../core/types'
import { withProjection, touch } from '../core/state'

/**
 * On-load recovery (I11). After a restart we re-derive the invariant fields from the
 * persisted phase (so waiting_on/agent status can't have drifted, I12) and stamp the
 * load time. Debounce and in-flight cycle recovery are re-evaluated live by the loop on
 * the next tick (the debounce model is time-based against persisted timestamps).
 */
export function reconcile(state: BetweenState, clock: Clock): BetweenState {
  return touch(withProjection(state), clock)
}
