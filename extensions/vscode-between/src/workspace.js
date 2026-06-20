import { createHmac, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildFindingModel } from './finding-model.js'

export const APPROVAL_TTL_MS = 3_600_000

export class BetweenWorkspaceError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BetweenWorkspaceError'
  }
}

export function findWorkspaceRoot(vscodeApi) {
  return vscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
}

export async function readBetweenWorkspace(root, nowIso = new Date().toISOString()) {
  const state = await readJson(requiredPath(root, '.between', 'state.json'))
  const cycle = Number(state.workflow?.cycle ?? 0)
  const diffHash = state.diff?.hash ?? null
  const bundleId = state.diff?.bundle_id ?? null
  const review = await readOptionalJson(root, '.between', 'reviews', cycleName(cycle) + '.json')
  const bundle = bundleId
    ? await readOptionalJson(root, '.between', 'bundles', `${bundleId}.json`)
    : null
  const sealedBundle = isMatchingBundle(bundle, bundleId, diffHash)
  const findings = Array.isArray(review?.findings) ? review.findings : []
  return {
    root,
    generatedAt: nowIso,
    project: state.project?.name ?? 'Between',
    phase: state.workflow?.phase ?? 'unknown',
    cycle,
    bundleId,
    diffHash,
    evidenceTrust: state.evidence_trust ?? 'simulated',
    developer: state.developer?.name ?? 'developer',
    reviewer: state.reviewer?.name ?? 'reviewer',
    approval: state.approval ?? null,
    review,
    bundle,
    evidenceVerdict: deriveEvidenceVerdict(state, findings),
    canApprove: state.evidence_trust === 'real' && sealedBundle,
    model: buildFindingModel({
      diffHash,
      trackedDiff: bundle?.diff?.tracked ?? '',
      findings,
    }),
  }
}

export function buildEvidenceMarkdown(view) {
  const lines = [
    `# Evidence - ${view.project} | cycle ${view.cycle}`,
    '',
    `- **Verdict:** ${view.evidenceVerdict}`,
    `- **Phase:** ${view.phase}`,
    `- **Agents:** developer ${view.developer} | reviewer ${view.reviewer}`,
    `- **Generated:** ${view.generatedAt}`,
    '',
    '## Review object (immutable bundle)',
  ]
  if (view.bundleId) {
    lines.push(`- bundle_id: \`${view.bundleId}\``)
    lines.push(`- diff_hash: \`${view.diffHash ?? '-'}\``)
    lines.push(
      `- head: \`${view.bundle?.repository?.head_sha ?? '-'}\` on \`${view.bundle?.repository?.branch ?? '-'}\``,
    )
  } else {
    lines.push('- _no bundle sealed yet_')
  }
  lines.push('', '## Findings')
  if (view.model.findings.length === 0) lines.push('- _none_')
  for (const item of view.model.findings) {
    lines.push(`- [${item.finding.severity}] ${item.finding.summary}`)
  }
  lines.push('', '## Approval')
  lines.push(
    view.approval
      ? `- ${view.approval.scope} | signed=${Boolean(view.approval.sig)} | expires ${view.approval.expires_at}`
      : '- _not approved_',
  )
  return lines.join('\n') + '\n'
}

export async function submitBetweenAction(root, action, nowMs = Date.now()) {
  switch (action.kind) {
    case 'request_second_review':
      await writeCommand(root, { kind: 'review_now' })
      return { ok: true }
    case 'ask_developer_to_fix':
      await writeCommand(root, { kind: 'goal', goal: action.message })
      return { ok: true }
    case 'approve_exact_bundle':
      return submitApproveExactBundle(root, nowMs)
    default:
      throw new BetweenWorkspaceError(`Unsupported action: ${action.kind}`)
  }
}

async function submitApproveExactBundle(root, nowMs) {
  const state = await readJson(requiredPath(root, '.between', 'state.json'))
  const bundleId = state.diff?.bundle_id ?? null
  if (state.evidence_trust !== 'real') {
    throw new BetweenWorkspaceError('Exact bundle approval requires real evidence.')
  }
  if (!bundleId) throw new BetweenWorkspaceError('No immutable review bundle is available.')
  const bundle = await readOptionalJson(root, '.between', 'bundles', `${bundleId}.json`)
  if (!isMatchingBundle(bundle, bundleId, state.diff?.hash ?? null)) {
    throw new BetweenWorkspaceError('Exact bundle approval requires the current sealed bundle.')
  }
  const expiresAt = new Date(nowMs + APPROVAL_TTL_MS).toISOString()
  const claim = {
    scope: 'merge',
    diff_hash: state.diff?.hash ?? null,
    cycle: Number(state.workflow?.cycle ?? 0),
    bundle_id: bundleId,
    expires_at: expiresAt,
  }
  const secret = await resolveApprovalSecret(root)
  await writeCommand(root, {
    kind: 'approve',
    scope: 'merge',
    sig: secret ? signApproval(secret, claim) : undefined,
    bundle_id: bundleId,
    expires_at: expiresAt,
  })
  return { ok: true, signed: Boolean(secret), bundleId }
}

async function writeCommand(root, command) {
  const dir = join(root, '.between', 'commands')
  await mkdir(dir, { recursive: true })
  const name = `${String(Date.now()).padStart(16, '0')}-${process.hrtime.bigint()}-${randomUUID()}.json`
  const file = join(dir, name)
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(command), 'utf8')
  await rename(tmp, file)
}

async function resolveApprovalSecret(root) {
  if (process.env.BETWEEN_APPROVAL_SECRET) return process.env.BETWEEN_APPROVAL_SECRET
  const path = join(root, '.git', 'between-approval.key')
  if (!existsSync(path)) return ''
  return (await readFile(path, 'utf8')).trim()
}

function signApproval(secret, claim) {
  return createHmac('sha256', secret)
    .update(
      `${claim.scope}:${claim.diff_hash ?? ''}:${claim.cycle}:${claim.bundle_id ?? ''}:${claim.expires_at}`,
    )
    .digest('hex')
}

function deriveEvidenceVerdict(state, findings) {
  if (state.evidence_trust === 'simulated') return 'simulated'
  if (state.approval?.scope === 'merge') return 'approved'
  if (findings.some((finding) => finding.severity === 'blocking')) return 'blocked'
  return 'pending'
}

function isMatchingBundle(bundle, bundleId, diffHash) {
  return (
    bundle !== null &&
    bundle.bundle_id === bundleId &&
    (diffHash === null || bundle.diff_hash === diffHash)
  )
}

async function readOptionalJson(root, ...segments) {
  const path = join(root, ...segments)
  if (!existsSync(path)) return null
  return JSON.parse(await readFile(path, 'utf8'))
}

async function readJson(path) {
  if (!existsSync(path)) throw new BetweenWorkspaceError(`No .between workspace at ${path}`)
  return JSON.parse(await readFile(path, 'utf8'))
}

function requiredPath(root, ...segments) {
  return join(root, ...segments)
}

function cycleName(cycle) {
  return `cycle-${String(cycle).padStart(4, '0')}`
}
