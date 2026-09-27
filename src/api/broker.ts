import { z } from 'zod'
import type { Ack, Clock } from '../core/types'
import { SystemClock } from '../core/clock'
import { StateRepository } from '../adapters/state-repository'
import { CommandBus, MAX_COMMAND_BYTES } from '../adapters/command-bus'
import { AckStore } from '../adapters/ack-store'
import { buildSignal } from '../adapters/signal-transport'
import { loadConfig } from '../runtime'
import { BetweenApiError } from './errors'

const BrokerControlSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pause') }).strict(),
  z.object({ kind: z.literal('resume') }).strict(),
  z.object({ kind: z.literal('interrupt') }).strict(),
  z.object({ kind: z.literal('review_now') }).strict(),
  z.object({ kind: z.literal('stop') }).strict(),
  z.object({ kind: z.literal('goal'), goal: z.string().trim().min(1) }).strict(),
  z.object({ kind: z.literal('steer_goal'), goal: z.string().trim().min(1) }).strict(),
])

export type BrokerControl = z.infer<typeof BrokerControlSchema>

export interface QueuedCommand {
  command_id: string
  /** accepted onto the bus; the running broker applies it on a later tick (or never, if stopped). */
  status: 'queued'
}

/**
 * Enqueue a control command for the running broker. Validated at runtime, so untyped callers
 * cannot smuggle other kinds (e.g. `approve`) through this path; human approval lives in the
 * separate `between-dev/human` entry.
 */
export async function submitBrokerCommand(root: string, command: unknown): Promise<QueuedCommand> {
  const parsed = BrokerControlSchema.safeParse(command)
  if (!parsed.success) {
    throw new BetweenApiError(
      'invalid_argument',
      `invalid broker command: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    )
  }
  const bytes = Buffer.byteLength(JSON.stringify(parsed.data), 'utf8')
  if (bytes > MAX_COMMAND_BYTES) {
    throw new BetweenApiError(
      'invalid_argument',
      `command is ${bytes} bytes; the broker drops commands over ${MAX_COMMAND_BYTES} bytes`,
    )
  }
  await loadConfig(root)
  const command_id = await new CommandBus(root).submit(parsed.data)
  return { command_id, status: 'queued' }
}

/** Reviewer helper: acknowledge the outstanding review signal for the current cycle. */
export async function ackReview(
  root: string,
  clock: Clock = new SystemClock(),
): Promise<{ signal_id: string }> {
  const state = await new StateRepository(root).read()
  if (!state || !state.diff.hash) {
    throw new BetweenApiError('not_found', 'no outstanding review to acknowledge')
  }
  const id = buildSignal('reviewer', state.workflow.cycle, state.diff.hash, '', '').id
  const ack: Ack = {
    signal_id: id,
    target: 'reviewer',
    cycle: state.workflow.cycle,
    diff_hash: state.diff.hash,
    acked_at: clock.nowIso(),
  }
  await new AckStore(root).write(ack)
  return { signal_id: id }
}
