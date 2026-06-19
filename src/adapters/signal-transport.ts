import { writeFile, readFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Ack, Signal, SignalTarget, SignalTransport } from '../core/types'
import { betweenPaths, signalPath, ackPath, type BetweenPaths } from './paths'

/**
 * Build a signal whose id embeds (target, cycle, diff_hash) so that a re-send for the
 * same review object is a receiver no-op (idempotency, I7).
 */
export function buildSignal(
  target: SignalTarget,
  cycle: number,
  diffHash: string,
  body: string,
  createdAt: string,
): Signal {
  return {
    id: `${target}-${String(cycle).padStart(4, '0')}-${diffHash.slice(0, 12)}`,
    target,
    cycle,
    diff_hash: diffHash,
    body,
    created_at: createdAt,
  }
}

/**
 * File-based transport (the headless walking-skeleton transport, I19). The broker
 * writes a signal pointer to `.between/signals/<target>.json`; the receiving agent
 * reads the real context (git diff, state, notes) itself (§9). Acks are read back from
 * `.between/acks/<signal_id>.json`, so `reviewing` is gated on a real receipt (I7).
 */
export class FileTransport implements SignalTransport {
  readonly kind = 'file'
  private readonly p: BetweenPaths

  constructor(root: string) {
    this.p = betweenPaths(root)
  }

  async send(signal: Signal): Promise<void> {
    const file = signalPath(this.p, signal.target)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(signal, null, 2), 'utf8')
  }

  async pollAck(signalId: string): Promise<Ack | null> {
    try {
      const raw = await readFile(ackPath(this.p, signalId), 'utf8')
      return JSON.parse(raw) as Ack
    } catch {
      return null
    }
  }
}

/** Human-readable signal bodies (§9). Kept short; the agent reads the real context. */
export function reviewerSignalBody(): string {
  return [
    'Between signal: review requested.',
    'Read: git diff, .between/state.json, Obsidian project notes.',
    'Write findings to: .between/reviews/<cycle>.json (+ Obsidian review feed).',
    'Do not edit code unless explicitly instructed.',
  ].join('\n')
}

export function developerSignalBody(): string {
  return [
    'Between signal: review updated.',
    'Read: .between/reviews/<cycle>.json, .between/state.json, git diff.',
    'Apply accepted feedback, run verification, leave merge/deploy to the human.',
  ].join('\n')
}
