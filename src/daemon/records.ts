import { relative } from 'node:path'
import { parseReviewRecord, parseVerifyRecord } from '../core/findings'
import type { ReviewRecord, VerifyRecord } from '../core/types'
import { betweenPaths, reviewPath, verifyPath } from '../adapters/paths'
import { resolveApprovalSecret } from '../adapters/approval-secret'
import {
  RECORD_SEALED_EVENT,
  loadRecord,
  lookupRecordSeal,
  makeRecordReadOnly,
  sealMac,
  type LoadedRecord,
  type SealedRecordKind,
} from '../review/record-seal'
import type { DaemonContext } from './context'

export interface DaemonRecord<T> extends LoadedRecord<T> {
  /** true once the record's hash is in the journal; its bytes are then verified on every read. */
  sealed: boolean
}

export function readReview(ctx: DaemonContext): Promise<DaemonRecord<ReviewRecord> | null> {
  return readRecord(ctx, 'review', parseReviewRecord)
}

export function readVerify(ctx: DaemonContext): Promise<DaemonRecord<VerifyRecord> | null> {
  return readRecord(ctx, 'verify', parseVerifyRecord)
}

/**
 * Seal an accepted record: make it read-only and append its sha256 to the hash-chained journal.
 * From then on every read must reproduce these exact bytes or the cycle fails closed.
 */
export async function sealRecord(
  ctx: DaemonContext,
  kind: SealedRecordKind,
  loaded: DaemonRecord<unknown>,
): Promise<void> {
  if (loaded.sealed) return
  const path = recordPath(ctx, kind)
  const secret = resolveApprovalSecret(ctx.deps.root)
  const cycle = ctx.current().workflow.cycle
  await makeRecordReadOnly(path)
  await ctx.emit(RECORD_SEALED_EVENT, {
    diff_hash: ctx.current().diff.hash ?? undefined,
    detail: {
      record: kind,
      sha256: loaded.sha256,
      path: relative(ctx.deps.root, path).split('\\').join('/'),
      ...(secret ? { mac: sealMac(secret, kind, cycle, loaded.sha256) } : {}),
    },
  })
}

async function readRecord<T>(
  ctx: DaemonContext,
  kind: SealedRecordKind,
  parse: (raw: unknown) => T,
): Promise<DaemonRecord<T> | null> {
  const cycle = ctx.current().workflow.cycle
  const seal = await lookupRecordSeal(
    ctx.deps.events,
    ctx.current().journal,
    kind,
    cycle,
    resolveApprovalSecret(ctx.deps.root),
  )
  const loaded = await loadRecord(recordPath(ctx, kind), parse, kind, cycle, seal)
  return loaded ? { ...loaded, sealed: seal !== null } : null
}

function recordPath(ctx: DaemonContext, kind: SealedRecordKind): string {
  const p = betweenPaths(ctx.deps.root)
  const cycle = ctx.current().workflow.cycle
  return kind === 'review' ? reviewPath(p, cycle) : verifyPath(p, cycle)
}
