/**
 * Cycle math (I11). A cycle is one developer-review-feedback loop around one stable,
 * never-reviewed diff snapshot (§7).
 *
 * `cycle` is a MONOTONIC id, never reused (drives snapshot_path naming and audit).
 * `cycles_this_goal` is distinct and drives `max_cycles_per_goal` (§7) — it resets
 * when a new goal is locked, while `cycle` keeps climbing.
 */
export interface CycleCounters {
  cycle: number
  cycles_this_goal: number
}

/**
 * Open a new cycle. MUST be called as a single atomic transition at the moment a new
 * stable, never-reviewed snapshot is committed, and persisted BEFORE any signal (I11).
 */
export function openCycle(counters: Readonly<CycleCounters>): CycleCounters {
  return {
    cycle: counters.cycle + 1,
    cycles_this_goal: counters.cycles_this_goal + 1,
  }
}

/** Reset the per-goal counter when a new goal is locked; keep the monotonic id. */
export function resetForNewGoal(counters: Readonly<CycleCounters>): CycleCounters {
  return {
    cycle: counters.cycle,
    cycles_this_goal: 0,
  }
}

/** True when opening another cycle would exceed the per-goal cap (§7). */
export function isCycleCapReached(cyclesThisGoal: number, maxCyclesPerGoal: number): boolean {
  return cyclesThisGoal >= maxCyclesPerGoal
}

/** Zero-padded cycle name for snapshot files, e.g. 7 -> "cycle-0007". */
export function cycleName(cycle: number): string {
  return `cycle-${String(cycle).padStart(4, '0')}`
}
