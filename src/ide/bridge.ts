import { existsSync } from 'node:fs'
import { betweenPaths } from '../adapters/paths'
import { CommandBus } from '../adapters/command-bus'
import type { Finding } from '../core/types'
import { collectEvidence } from '../evidence/collect'
import { collectCockpitData } from '../ui/cockpit'

export interface IdeWorkspaceView {
  project: string
  phase: string
  cycle: number
  bundleId: string | null
  diffHash: string | null
  findings: Finding[]
  evidenceVerdict: string
  canApprove: boolean
}

export type IdeAction =
  | { kind: 'request_second_review' }
  | { kind: 'ask_developer_to_fix'; message: string }

export class IdeBridgeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdeBridgeError'
  }
}

export async function readIdeWorkspace(root: string, nowIso: string): Promise<IdeWorkspaceView> {
  ensureBetweenWorkspace(root)
  const [cockpit, evidence] = await Promise.all([
    collectCockpitData(root, nowIso),
    collectEvidence(root, nowIso),
  ])
  if (!cockpit) throw new IdeBridgeError(`No .between/ found in ${root}`)
  return {
    project: cockpit.project,
    phase: cockpit.phase,
    cycle: cockpit.cycle,
    bundleId: cockpit.bundleId,
    diffHash: evidence?.bundle?.diff_hash ?? null,
    findings: evidence?.findings.items ?? [],
    evidenceVerdict: cockpit.verdict,
    canApprove: cockpit.evidenceTrust === 'real' && Boolean(cockpit.bundleId),
  }
}

export async function submitIdeAction(root: string, action: IdeAction): Promise<void> {
  ensureBetweenWorkspace(root)
  const bus = new CommandBus(root)
  switch (action.kind) {
    case 'request_second_review':
      await bus.submit({ kind: 'review_now' })
      return
    case 'ask_developer_to_fix':
      await bus.submit({ kind: 'goal', goal: action.message })
      return
  }
}

function ensureBetweenWorkspace(root: string): void {
  if (!existsSync(betweenPaths(root).dir)) {
    throw new IdeBridgeError(`No .between/ found in ${root}`)
  }
}
