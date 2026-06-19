/**
 * Shared type contracts for Between.
 *
 * This module is PURE (no IO, no Node APIs beyond types) and is the linchpin that
 * every other module depends on. It encodes the durable state shape (§5 + the
 * DEVELOPMENT-PLAN state additions for I4/I6/I11/I12), the phase/event vocabulary
 * (§6, I6), and the port interfaces (hexagonal architecture) that adapters implement.
 */

// ---------------------------------------------------------------------------
// Phases (§6) + repo_busy holding substate (I21)
// ---------------------------------------------------------------------------

export const PHASES = [
  'idle',
  'goal_locked',
  'developing',
  'diff_detected',
  'debouncing',
  'review_requested',
  'reviewing',
  'review_written',
  'applying_review',
  'verifying',
  'human_gate',
  'repo_busy',
  'done',
  'paused',
  'error',
] as const

export type Phase = (typeof PHASES)[number]

/** Phases from which the loop should not auto-advance without external input. */
export const TERMINAL_PHASES: ReadonlySet<Phase> = new Set<Phase>(['done'])

// ---------------------------------------------------------------------------
// Events that drive FSM transitions (I6)
// ---------------------------------------------------------------------------

export const EVENTS = [
  'goal_locked', // user goal captured
  'dev_started', // developer expected to work
  'diff_detected', // hash changed vs stable
  'diff_changed', // hash changed again during debounce -> restart timer
  'diff_stable', // hash stable through debounce window
  'diff_reverted', // debounced hash equals last_reviewed -> abort cycle
  'signal_sent', // review signal emitted to reviewer
  'review_acked', // reviewer acknowledged the signal (I7)
  'review_written', // structured review record appeared for current cycle+hash (I8)
  'review_applied', // developer applied feedback
  'verify_passed',
  'verify_failed',
  'human_approved', // approval token present (I9)
  'pause',
  'resume',
  'review_timeout', // §7 review_timeout_seconds (I7)
  'developer_timeout',
  'repo_busy_detected', // abnormal git state (I21)
  'repo_cleared',
  'agent_died', // PTY EOF / process exit (I16)
  'max_cycles_reached', // §7 max_cycles_per_goal
  'cancel',
  'fail', // unrecoverable -> error
] as const

export type EventName = (typeof EVENTS)[number]

export type Actor = 'developer' | 'reviewer' | 'human' | null

export type AgentStatus =
  | 'idle'
  | 'working'
  | 'waiting_for_review'
  | 'reviewing_diff'
  | 'applying_review'
  | 'dead'
  | 'unknown'

export type BrokerStatus = 'stable' | 'busy' | 'paused' | 'error'

// ---------------------------------------------------------------------------
// Durable state (§5 + plan additions). Persisted to .between/state.json.
// ---------------------------------------------------------------------------

export interface WorkflowState {
  phase: Phase
  /** for resume-after-pause and error recovery (I6) */
  previous_phase: Phase | null
  /** monotonic cycle id, never reused (I11) */
  cycle: number
  /** distinct from id; drives max_cycles_per_goal (I11) */
  cycles_this_goal: number
  /** derived from phase, persisted as a snapshot only (I12) */
  waiting_on: Actor
  /** keystone dedup field — the last hash actually reviewed (I4) */
  last_reviewed_hash: string | null
  /** bounded ring of reviewed hashes; handles revert/re-edit (I4) */
  reviewed_hashes: string[]
  started_at: string | null
  updated_at: string
  error: BetweenError | null
}

export interface BetweenError {
  code: string
  message: string
  occurred_at: string
  recoverable: boolean
}

export interface DiffState {
  hash: string | null
  /** observability only — MUST NOT drive dedup (I4) */
  previous_hash: string | null
  changed_files: number
  insertions: number
  deletions: number
  snapshot_path: string | null
}

export interface DebounceState {
  candidate_hash: string | null
  candidate_first_seen_at: string | null
  debounce_restarts: number
}

export interface AgentState {
  name: string
  terminal_id: string
  status: AgentStatus
}

export interface BrokerState {
  status: BrokerStatus
  last_signal: string | null
  last_signal_at: string | null
}

export type ApprovalScope = 'merge' | 'deploy' | 'promote_rule'

export interface ApprovalToken {
  actor: 'human'
  scope: ApprovalScope
  diff_hash: string | null
  granted_at: string
}

export interface ProjectRef {
  name: string
  root: string
  obsidian_project_path: string | null
}

export const STATE_SCHEMA_VERSION = 1 as const

export interface BetweenState {
  schema_version: number
  project: ProjectRef
  workflow: WorkflowState
  diff: DiffState
  debounce: DebounceState
  developer: AgentState
  reviewer: AgentState
  broker: BrokerState
  approval: ApprovalToken | null
}

// ---------------------------------------------------------------------------
// Diff hashing (§8, I5, I15)
// ---------------------------------------------------------------------------

export interface UntrackedEntry {
  path: string
  /** git blob OID of the content (deterministic, not mtime/size) */
  oid: string
}

export interface DiffInput {
  /**
   * `git diff HEAD` (all tracked changes vs HEAD), pinned flags applied.
   * Using HEAD-relative diff makes the hash STAGING-INVARIANT by construction
   * (it ignores the index boundary), which is the robust form of I5's
   * "git add is hash-invariant" requirement.
   */
  tracked: string
  /** `git diff HEAD --raw`: captures binary/mode/oid changes deterministically (I5) */
  trackedRaw: string
  /** included only when review_untracked is on, gitignore-honored (I5/I17) */
  untracked: UntrackedEntry[]
}

export interface DiffSummary {
  changed_files: number
  insertions: number
  deletions: number
}

// ---------------------------------------------------------------------------
// Findings (§16, I13)
// ---------------------------------------------------------------------------

export type FindingSeverity = 'blocking' | 'non-blocking'

export interface Finding {
  id: string
  severity: FindingSeverity
  summary: string
  /** the diff hash this finding was written against (I14) */
  target_hash: string
}

export interface ReviewRecord {
  cycle: number
  diff_hash: string
  findings: Finding[]
  complete: boolean
}

export interface VerifyRecord {
  diff_hash: string
  passed: boolean
  summary: string
}

// ---------------------------------------------------------------------------
// Signals (§9, I7)
// ---------------------------------------------------------------------------

export type SignalTarget = 'reviewer' | 'developer' | 'human'

export interface Signal {
  /** idempotency key embeds (cycle, diff_hash) so re-sends are no-ops (I7) */
  id: string
  target: SignalTarget
  cycle: number
  diff_hash: string
  /** short pointer text actually delivered to the agent (§9) */
  body: string
  created_at: string
}

export interface Ack {
  signal_id: string
  target: SignalTarget
  cycle: number
  diff_hash: string
  acked_at: string
}

/** Port: a transport that delivers a signal and exposes received acks (I7/I19). */
export interface SignalTransport {
  readonly kind: string
  send(signal: Signal): Promise<void>
  /** returns the ack for a signal id if one has been received, else null */
  pollAck(signalId: string): Promise<Ack | null>
}

// ---------------------------------------------------------------------------
// Clock port (injected everywhere; no wall-clock in core)
// ---------------------------------------------------------------------------

export interface Clock {
  /** epoch milliseconds */
  now(): number
  /** ISO-8601 string for the current instant */
  nowIso(): string
}

// ---------------------------------------------------------------------------
// Structured events (§5 events.jsonl, I2/I23)
// ---------------------------------------------------------------------------

export interface BetweenEvent {
  /** JSONL line-shape version, so the format can evolve (I23) */
  v: number
  ts: string
  cycle: number
  phase: Phase
  event: string
  target?: SignalTarget
  diff_hash?: string
  detail?: Record<string, unknown>
}

export const EVENT_SCHEMA_VERSION = 1 as const
