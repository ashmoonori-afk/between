import { z } from 'zod'
import { PHASES, STATE_SCHEMA_VERSION, type BetweenEvent, type BetweenState } from './types'
import {
  chainHeadOf,
  verifyChain,
  verifyChainHead,
  type ChainHead,
  type JournalPayload,
} from './journal'

type ReplayStateSnapshot = Omit<BetweenState, 'journal'>

export type ReplayErrorCode = 'journal_tampered' | 'missing_replay_state' | 'invalid_replay_state'

export class ReplayError extends Error {
  override readonly name = 'ReplayError'

  constructor(
    readonly code: ReplayErrorCode,
    message: string,
  ) {
    super(message)
  }
}

const nullableString = z.string().nullable()
const nonNegativeInt = z.number().int().nonnegative()
const phaseSchema = z.enum(PHASES)
const actorSchema = z.enum(['developer', 'reviewer', 'human']).nullable()
const agentStatusSchema = z.enum([
  'idle',
  'working',
  'waiting_for_review',
  'reviewing_diff',
  'applying_review',
  'dead',
  'unknown',
])
const brokerStatusSchema = z.enum(['stable', 'busy', 'paused', 'error'])
const approvalScopeSchema = z.enum(['merge', 'deploy', 'promote_rule'])

const replayErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    occurred_at: z.string(),
    recoverable: z.boolean(),
    detail: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

const replayStateSchema: z.ZodType<ReplayStateSnapshot> = z
  .object({
    schema_version: z.number().int().min(1).max(STATE_SCHEMA_VERSION),
    project: z
      .object({
        name: z.string(),
        root: z.string(),
        obsidian_project_path: nullableString,
      })
      .strict(),
    workflow: z
      .object({
        phase: phaseSchema,
        previous_phase: phaseSchema.nullable(),
        cycle: nonNegativeInt,
        cycles_this_goal: nonNegativeInt,
        waiting_on: actorSchema,
        last_reviewed_hash: nullableString,
        reviewed_hashes: z.array(z.string()),
        started_at: nullableString,
        updated_at: z.string(),
        error: replayErrorSchema.nullable(),
      })
      .strict(),
    diff: z
      .object({
        hash: nullableString,
        previous_hash: nullableString,
        changed_files: nonNegativeInt,
        insertions: nonNegativeInt,
        deletions: nonNegativeInt,
        snapshot_path: nullableString,
        bundle_id: nullableString,
        bundle_path: nullableString,
      })
      .strict(),
    debounce: z
      .object({
        candidate_hash: nullableString,
        candidate_first_seen_at: nullableString,
        debounce_restarts: nonNegativeInt,
      })
      .strict(),
    developer: z
      .object({
        name: z.string(),
        terminal_id: z.string(),
        status: agentStatusSchema,
      })
      .strict(),
    reviewer: z
      .object({
        name: z.string(),
        terminal_id: z.string(),
        status: agentStatusSchema,
      })
      .strict(),
    broker: z
      .object({
        status: brokerStatusSchema,
        last_signal: nullableString,
        last_signal_at: nullableString,
      })
      .strict(),
    approval: z
      .object({
        actor: z.literal('human'),
        scope: approvalScopeSchema,
        diff_hash: nullableString,
        cycle: nonNegativeInt,
        granted_at: z.string(),
        sig: nullableString,
        bundle_id: nullableString,
        expires_at: z.string(),
      })
      .strict()
      .nullable(),
    evidence_trust: z.enum(['simulated', 'real']),
  })
  .strict()

export function replaySnapshot(state: BetweenState): ReplayStateSnapshot {
  return {
    schema_version: state.schema_version,
    project: structuredClone(state.project),
    workflow: structuredClone(state.workflow),
    diff: structuredClone(state.diff),
    debounce: structuredClone(state.debounce),
    developer: structuredClone(state.developer),
    reviewer: structuredClone(state.reviewer),
    broker: structuredClone(state.broker),
    approval: structuredClone(state.approval),
    evidence_trust: state.evidence_trust,
  }
}

export function replayStateFromEvents(
  events: ReadonlyArray<BetweenEvent>,
  pinnedHead: ChainHead | null | undefined,
): BetweenState {
  const payloads = journalPayloads(events)
  const chain = verifyChain(payloads)
  const head = verifyChainHead(payloads, pinnedHead)
  if (!chain.valid || !head.ok) {
    const reason = chain.reason ?? head.reason ?? 'journal integrity check failed'
    throw new ReplayError('journal_tampered', `journal TAMPERED: ${reason}`)
  }

  const tail = events.at(-1)
  if (!tail?.replay_state) {
    throw new ReplayError('missing_replay_state', 'journal cannot replay: missing replay_state')
  }
  const parsed = replayStateSchema.safeParse(tail.replay_state)
  if (!parsed.success) {
    throw new ReplayError('invalid_replay_state', 'journal cannot replay: invalid replay_state')
  }

  return {
    ...structuredClone(parsed.data),
    journal: chainHeadOf(payloads),
  }
}

function journalPayloads(events: ReadonlyArray<BetweenEvent>): JournalPayload[] {
  return events.map((event) => ({ ...event }))
}
