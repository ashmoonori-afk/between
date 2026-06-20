import { StateRepository } from '../adapters/state-repository'
import { EventsLog } from '../adapters/events-log'
import { collectEvidence } from '../evidence/collect'
import { readBundle } from '../review/store'
import { loadPolicy } from '../policy/load'
import { evaluatePolicy, changedPathsFromRaw } from '../policy/engine'
import { scanDiffForSecrets } from '../verify/secret-scan'
import type { CockpitData, CockpitGate } from './cockpit-frame'
import { buildCockpitModel, type CockpitModel, type ReplayCycleSnapshot } from './cockpit-model'

/** Compose the cockpit facts from on-disk state + evidence + policy + verification + journal. */
export async function collectCockpitData(
  root: string,
  nowIso: string,
): Promise<CockpitData | null> {
  const state = await new StateRepository(root).read()
  if (!state) return null

  const manifest = await collectEvidence(root, nowIso)
  const bundle = state.diff.bundle_id ? await readBundle(root, state.diff.bundle_id) : null

  let risk: 'high' | 'normal' | null = null
  let gates: CockpitGate[] = []
  let policySatisfied: boolean | null = null
  if (bundle) {
    const policy = await loadPolicy(root)
    const ev = evaluatePolicy(policy, {
      changedPaths: changedPathsFromRaw(bundle.diff.trackedRaw),
      blockingFindings: manifest?.findings.blocking ?? 0,
      verifyPassed: manifest?.verify ? manifest.verify.passed : null,
      secretScanHits: scanDiffForSecrets(bundle.diff.tracked).hits,
    })
    risk = ev.risk
    gates = ev.gates.map((g) => ({ name: g.name, status: g.status }))
    policySatisfied = ev.satisfied
  }

  // forward the manifest's already-validated verification (review: avoid a second read of the
  // report -> no redundant I/O and no TOCTOU window between two independent reads).
  const verification: CockpitData['verification'] = manifest?.verification
    ? {
        passed: manifest.verification.passed,
        total: manifest.verification.total,
        allPassed: manifest.verification.all_passed,
      }
    : null

  const log = new EventsLog(root)
  const entries = await log.read()
  // B5: include the chain-head pin so the cockpit also flags tail-truncation, not just edits.
  const journal = await log.verifyAll(state.journal ?? null)

  return {
    project: state.project.name,
    phase: state.workflow.phase,
    cycle: state.workflow.cycle,
    evidenceTrust: state.evidence_trust,
    changedFiles: state.diff.changed_files,
    insertions: state.diff.insertions,
    deletions: state.diff.deletions,
    bundleId: state.diff.bundle_id,
    blockingFindings: manifest?.findings.blocking ?? 0,
    nonBlockingFindings: manifest?.findings.non_blocking ?? 0,
    risk,
    gates,
    policySatisfied,
    verdict: manifest?.verdict ?? 'pending',
    verification,
    journalValid: journal.valid,
    journalEntries: entries.length,
  }
}

export async function collectCockpitModel(
  root: string,
  nowIso: string,
): Promise<CockpitModel | null> {
  const state = await new StateRepository(root).read()
  if (!state) return null
  const data = await collectCockpitData(root, nowIso)
  if (!data) return null
  const manifest = await collectEvidence(root, nowIso, state)
  const bundle = state.diff.bundle_id ? await readBundle(root, state.diff.bundle_id) : null
  const entries = await new EventsLog(root).read()
  return buildCockpitModel({
    data,
    diffHash: state.diff.hash,
    trackedDiff: bundle?.diff.tracked ?? '',
    findings: manifest?.findings.items ?? [],
    replayCycles: entries.flatMap((entry): ReplayCycleSnapshot[] =>
      entry.replay_state
        ? [
            {
              cycle: entry.replay_state.workflow.cycle,
              phase: entry.replay_state.workflow.phase,
              diffHash: entry.replay_state.diff.hash,
              changedFiles: entry.replay_state.diff.changed_files,
              insertions: entry.replay_state.diff.insertions,
              deletions: entry.replay_state.diff.deletions,
              bundleId: entry.replay_state.diff.bundle_id,
            },
          ]
        : [],
    ),
  })
}
