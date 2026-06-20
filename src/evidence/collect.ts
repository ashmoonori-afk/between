import { readFile } from 'node:fs/promises'
import type { BetweenState } from '../core/types'
import { StateRepository } from '../adapters/state-repository'
import { betweenPaths, reviewPath, verifyPath } from '../adapters/paths'
import { parseReviewRecord, parseVerifyRecord } from '../core/findings'
import { readBundle } from '../review/store'
import { readVerifyReport } from '../verify/report'
import { buildEvidenceManifest, type EvidenceManifest } from './manifest'

async function readJson<T>(path: string, parse: (raw: unknown) => T): Promise<T | null> {
  try {
    return parse(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    return null
  }
}

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
  const [review, verify, bundle, verification] = await Promise.all([
    readJson(reviewPath(p, cycle), parseReviewRecord),
    readJson(verifyPath(p, cycle), parseVerifyRecord),
    state.diff.bundle_id ? readBundle(root, state.diff.bundle_id) : Promise.resolve(null),
    readVerifyReport(root),
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
    review,
    verify,
    verification,
    approval: state.approval,
  })
}
