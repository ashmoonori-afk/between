import type { BetweenState } from '../core/types'
import { EventsLog } from '../adapters/events-log'
import { resolveApprovalSecret } from '../adapters/approval-secret'
import { StateRepository } from '../adapters/state-repository'
import { betweenPaths, reviewPath, usagePath, verifyPath } from '../adapters/paths'
import { parseReviewRecord, parseVerifyRecord } from '../core/findings'
import { readBundle } from '../review/store'
import { loadRecord, lookupRecordSeal } from '../review/record-seal'
import { readVerifyReport } from '../verify/report'
import { buildEvidenceManifest, type EvidenceManifest } from './manifest'
import { readUsageSummary } from './usage'

/**
 * Collect the evidence manifest for the CURRENT cycle from on-disk state: the immutable bundle
 * (A1), the reviewer record, the verification, and the approval. Returns null when uninitialized.
 */
export async function collectEvidence(
  root: string,
  generatedAt: string,
  /** reuse an already-loaded state so evidence + bundle reflect the SAME cycle (review MEDIUM). */
  knownState?: BetweenState,
): Promise<EvidenceManifest | null> {
  const state = knownState ?? (await new StateRepository(root).read())
  if (!state) return null
  const p = betweenPaths(root)
  const cycle = state.workflow.cycle
  // sealed review/verify records must still match their journal seal (fail closed, like bundles)
  const log = new EventsLog(root)
  const secret = resolveApprovalSecret(root)
  const [reviewSeal, verifySeal] = await Promise.all([
    lookupRecordSeal(log, state.journal, 'review', cycle, secret),
    lookupRecordSeal(log, state.journal, 'verify', cycle, secret),
  ])
  const [review, verify, bundle, verification, usage] = await Promise.all([
    loadRecord(reviewPath(p, cycle), parseReviewRecord, 'review', cycle, reviewSeal),
    loadRecord(verifyPath(p, cycle), parseVerifyRecord, 'verify', cycle, verifySeal),
    state.diff.bundle_id ? readBundle(root, state.diff.bundle_id) : Promise.resolve(null),
    readVerifyReport(root),
    readUsageSummary(usagePath(p, cycle), cycle),
  ])
  return buildEvidenceManifest({
    project: state.project,
    cycle,
    phase: state.workflow.phase,
    evidenceTrust: state.evidence_trust,
    developer: state.developer.name,
    reviewer: state.reviewer.name,
    generatedAt,
    bundle,
    review: review?.record ?? null,
    verify: verify?.record ?? null,
    verification,
    usage,
    approval: state.approval,
  })
}
