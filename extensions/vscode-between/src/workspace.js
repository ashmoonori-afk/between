import { createHmac, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
import { buildFindingModel } from './finding-model.js'
import { BetweenWorkspaceError } from './workspace-errors.js'
import { configureTopology, readIdeProfile } from './workspace-topology.js'

export const APPROVAL_TTL_MS = 3_600_000

/** git config pinned so the tree snapshot is deterministic across machines. */
const GIT_PIN = [
  '-c',
  'core.autocrlf=false',
  '-c',
  'core.quotepath=false',
  '-c',
  'core.fileMode=false',
]
/** Kill-switch env for the tree snapshot; the process env is never mutated. */
const GIT_PINNED_ENV = { ...process.env, GIT_PAGER: 'cat', LC_ALL: 'C', TZ: 'UTC' }
export { BetweenWorkspaceError } from './workspace-errors.js'

export function findWorkspaceRoot(vscodeApi) {
  return vscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
}

export async function readBetweenWorkspace(root, nowIso = new Date().toISOString()) {
  const state = await readJson(requiredPath(root, '.between', 'state.json'))
  const ideProfile = await readIdeProfile(root)
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
    developerStatus: state.developer?.status ?? 'unknown',
    reviewer: state.reviewer?.name ?? 'reviewer',
    reviewerStatus: state.reviewer?.status ?? 'unknown',
    waitingOn: state.workflow?.waiting_on ?? null,
    cyclesThisGoal: Number(state.workflow?.cycles_this_goal ?? 0),
    changedFiles: Number(state.diff?.changed_files ?? 0),
    approval: state.approval ?? null,
    review,
    bundle,
    evidenceVerdict: deriveEvidenceVerdict(state, findings),
    canApprove: state.evidence_trust === 'real' && sealedBundle,
    ideProfile,
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
    case 'broker_input':
      return submitBrokerInput(root, action.message)
    case 'request_second_review':
      await writeCommand(root, { kind: 'review_now' })
      return { ok: true }
    case 'ask_developer_to_fix':
      await writeCommand(root, { kind: 'goal', goal: action.message })
      return { ok: true }
    case 'approve_exact_bundle':
      return submitApproveExactBundle(root, nowMs)
    case 'configure_topology':
      return configureTopology(root, action)
    default:
      throw new BetweenWorkspaceError(`Unsupported action: ${action.kind}`)
  }
}

export async function submitBrokerInput(root, message) {
  const state = await readJson(requiredPath(root, '.between', 'state.json'))
  const command = buildBrokerInputCommand(state, message)
  if (!command) return { ok: false, reason: 'empty' }
  await writeCommand(root, command)
  return { ok: true, command }
}

export function buildBrokerInputCommand(state, message) {
  const text = String(message ?? '').trim()
  if (!text) return null
  const normalized = text.startsWith('/') ? text.slice(1).trim() : text
  const [verb = '', ...rest] = normalized.split(/\s+/)
  const key = verb.toLowerCase()
  const arg = rest.join(' ').trim()
  switch (key) {
    case 'goal':
      return arg ? { kind: 'goal', goal: arg } : null
    case 'steer':
      return arg ? { kind: 'steer_goal', goal: arg } : null
    case 'review':
    case 'review-now':
      return { kind: 'review_now' }
    case 'abort':
    case 'interrupt':
      return { kind: 'interrupt' }
    case 'pause':
      return { kind: 'pause' }
    case 'resume':
      return { kind: 'resume' }
    case 'stop':
      return { kind: 'stop' }
    case 'quit':
    case 'q':
      return null
    default:
      return isFreshGoalPhase(state.workflow?.phase)
        ? { kind: 'goal', goal: text }
        : { kind: 'steer_goal', goal: text }
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
  // A protected push is only authorized when the pushed commit's tree equals the approved tree
  // (see the installed pre-push hook), so the approval must bind the exact working tree. Fail
  // closed: an approval that cannot be bound to a tree must not be queued at all.
  const tree = await resolveWorktreeTree(root)
  if (!tree) {
    throw new BetweenWorkspaceError(
      'Exact bundle approval requires the working tree (git write-tree failed).',
    )
  }
  const expiresAt = new Date(nowMs + APPROVAL_TTL_MS).toISOString()
  const claim = {
    scope: 'merge',
    diff_hash: state.diff?.hash ?? null,
    cycle: Number(state.workflow?.cycle ?? 0),
    bundle_id: bundleId,
    expires_at: expiresAt,
    tree,
  }
  const secret = resolveApprovalSecret()
  await writeCommand(root, {
    kind: 'approve',
    scope: 'merge',
    sig: secret ? signApproval(secret, claim) : undefined,
    bundle_id: bundleId,
    expires_at: expiresAt,
    tree,
  })
  return { ok: true, signed: Boolean(secret), bundleId, tree }
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

/** The env-only human approval secret; a repository key file is NOT trusted as a signature. */
function resolveApprovalSecret() {
  return process.env.BETWEEN_APPROVAL_SECRET ?? ''
}

function signApproval(secret, claim) {
  const base = `${claim.scope}:${claim.diff_hash ?? ''}:${claim.cycle}:${claim.bundle_id ?? ''}:${claim.expires_at}`
  const payload = claim.tree ? `${base}:tree=${claim.tree}` : base
  return createHmac('sha256', secret).update(payload).digest('hex')
}

/**
 * Tree OID of the whole working tree as `git add -A` would commit it (tracked + untracked,
 * honoring .gitignore), built in a throwaway index so the user's index is never touched. Mirrors
 * the daemon adapter's algorithm: resolve the real Git directory (linked worktrees use a file),
 * copy the real index when present so already-staged-but-unchanged content is preserved, then
 * `add -A` + `write-tree`. Returns null when it cannot be computed (no repo, no git, failure).
 */
async function resolveWorktreeTree(root) {
  let gitDir
  try {
    gitDir = await resolveGitDir(root)
  } catch {
    return null
  }
  if (!gitDir) return null
  const tempIndex = join(gitDir, `between-approval-index-${randomUUID()}`)
  const env = { ...GIT_PINNED_ENV, GIT_INDEX_FILE: tempIndex }
  const git = (args) => execFileAsync('git', [...GIT_PIN, ...args], { cwd: root, env })
  try {
    const realIndex = join(gitDir, 'index')
    if (existsSync(realIndex)) await copyFile(realIndex, tempIndex)
    await git(['add', '-A'])
    const { stdout } = await git(['write-tree'])
    const tree = String(stdout).trim()
    return tree || null
  } catch {
    return null
  } finally {
    await rm(tempIndex, { force: true }).catch(() => {})
  }
}

/** Absolute Git directory for `root`, resolving a linked-worktree `.git` file; null when not a repo. */
async function resolveGitDir(root) {
  const { stdout } = await execFileAsync('git', [...GIT_PIN, 'rev-parse', '--git-dir'], {
    cwd: root,
    env: GIT_PINNED_ENV,
  })
  const dir = String(stdout).trim()
  if (!dir) return null
  return isAbsolute(dir) ? dir : join(root, dir)
}

function deriveEvidenceVerdict(state, findings) {
  if (state.evidence_trust === 'simulated') return 'simulated'
  if (state.approval?.scope === 'merge') return 'approved'
  if (findings.some((finding) => finding.severity === 'blocking')) return 'blocked'
  return 'pending'
}

function isFreshGoalPhase(phase) {
  return phase === 'idle' || phase === 'done'
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
