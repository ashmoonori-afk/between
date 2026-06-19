import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { touch } from '../core/state'
import { buildSignal, reviewerSignalBody } from '../adapters/signal-transport'
import { betweenPaths, signalPath } from '../adapters/paths'
import type { DaemonContext } from './context'

export async function ensureReviewerSignal(ctx: DaemonContext): Promise<void> {
  const cur = ctx.current()
  const hash = cur.diff.hash
  if (!hash) return
  const p = betweenPaths(ctx.deps.root)
  const signalOk = await reviewerSignalMatches(signalPath(p, 'reviewer'), cur.workflow.cycle, hash)
  const needsSignal =
    cur.broker.last_signal !== 'review_requested' || !cur.broker.last_signal_at || !signalOk
  if (!needsSignal) return
  await sendReviewerSignal(ctx, cur.workflow.cycle, hash, { recovered: true })
}

export async function sendReviewerSignal(
  ctx: DaemonContext,
  cycle: number,
  hash: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  const sig = buildSignal('reviewer', cycle, hash, reviewerSignalBody(), ctx.deps.clock.nowIso())
  await ctx.deps.transport.send(sig)
  await ctx.persist(
    touch(
      {
        ...ctx.current(),
        broker: {
          ...ctx.current().broker,
          last_signal: 'review_requested',
          last_signal_at: ctx.deps.clock.nowIso(),
        },
      },
      ctx.deps.clock,
    ),
  )
  await ctx.emit('signal_sent', { target: 'reviewer', diff_hash: hash, detail })
}

export function expectedSignalId(ctx: DaemonContext): string | null {
  const cur = ctx.current()
  const hash = cur.diff.hash
  if (!hash) return null
  return buildSignal('reviewer', cur.workflow.cycle, hash, '', '').id
}

async function reviewerSignalMatches(path: string, cycle: number, hash: string): Promise<boolean> {
  if (!existsSync(path)) return false
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { id?: unknown }
    return parsed.id === buildSignal('reviewer', cycle, hash, '', '').id
  } catch {
    return false
  }
}
