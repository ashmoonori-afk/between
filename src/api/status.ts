import type {
  AgentState,
  BetweenEvent,
  BetweenState,
  BrokerState,
  DiffState,
  WorkflowState,
} from '../core/types'
import { StateRepository } from '../adapters/state-repository'
import { EventsLog } from '../adapters/events-log'
import { BrokerLock } from '../adapters/lock'
import { CommandBus } from '../adapters/command-bus'
import { usesSimulatedEvidence } from '../core/evidence-trust'
import { loadConfig } from '../runtime'
import { noStateError } from './errors'
import { nextStep } from './next-step'

export interface StatusReport {
  project: { name: string; root: string }
  evidence_trust: BetweenState['evidence_trust']
  workflow: WorkflowState
  diff: DiffState
  broker: BrokerState
  developer: Pick<AgentState, 'name' | 'status'>
  reviewer: Pick<AgentState, 'name' | 'status'>
  /** null when config.yaml is missing or invalid. */
  max_cycles_per_goal: number | null
  last_event: BetweenEvent | null
  /** true while a live broker holds the lock; queued commands only apply while it runs. */
  broker_running: boolean
  /** commands on the bus that no broker has applied yet. */
  queued_commands: number
  /** fake-agent project: reviews are not real verification and merge approvals are rejected. */
  simulated: boolean
  /** one actionable sentence for the human, or null. */
  next_step: string | null
}

/** Current phase, cycle, waiting actor, diff, agents, and latest event. Throws `no_state`. */
export async function getStatus(root: string): Promise<StatusReport> {
  const state = await new StateRepository(root).read()
  if (!state) throw noStateError()
  const events = await new EventsLog(root).read()
  const cfg = await loadConfig(root).catch(() => null)
  const broker_running = await new BrokerLock(root).isHeld()
  const queued_commands = await new CommandBus(root).pendingCount()
  return {
    project: { name: state.project.name, root: state.project.root },
    evidence_trust: state.evidence_trust,
    workflow: state.workflow,
    diff: state.diff,
    broker: state.broker,
    developer: { name: state.developer.name, status: state.developer.status },
    reviewer: { name: state.reviewer.name, status: state.reviewer.status },
    max_cycles_per_goal: cfg?.max_cycles_per_goal ?? null,
    last_event: events.at(-1) ?? null,
    broker_running,
    queued_commands,
    simulated: cfg ? usesSimulatedEvidence(state.evidence_trust, cfg) : true,
    next_step: nextStep({
      phase: state.workflow.phase,
      waiting_on: state.workflow.waiting_on,
      broker_running,
      queued_commands,
      agent_mode: cfg?.agent_mode ?? null,
    }),
  }
}

export interface EventSummary {
  total: number
  counts: Array<{ event: string; count: number }>
}

/** Cycle/phase analytics from events.jsonl. */
export async function summarizeEvents(root: string): Promise<EventSummary> {
  const events = await new EventsLog(root).read()
  const counts = new Map<string, number>()
  for (const e of events) counts.set(e.event, (counts.get(e.event) ?? 0) + 1)
  return {
    total: events.length,
    counts: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([event, count]) => ({ event, count })),
  }
}
