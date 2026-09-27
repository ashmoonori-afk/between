import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

const MARKER = 'between-verify-push'

// Standalone pre-push gate (no dependency on the between package at push time). It mirrors
// `verifyPush` in src/api/checks.ts; test/integration/protected-push.test.ts runs both against
// the same scenarios. Pushes to protected branches need a signed, fresh merge approval whose
// signed tree equals the pushed commit's tree; other branches are not gated.
const VERIFY_PUSH_SCRIPT = `import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'

const root = process.cwd()
function rd(p) { try { return readFileSync(join(root, p), 'utf8') } catch { return null } }
function refuse(msg) {
  process.stderr.write('between: refusing push -- ' + msg + '\\n')
  process.exit(1)
}

const raw = rd('.between/state.json')
if (raw === null) process.exit(0)
let state = null
try { state = JSON.parse(raw) } catch { state = null }
const configRaw = rd('.between/config.yaml')

function protectedBranches(text) {
  if (text === null) return ['main']
  const lines = text.split(/\\r?\\n/)
  const i = lines.findIndex((l) => l.startsWith('protected_branches:'))
  if (i < 0) return ['main']
  const clean = (s) => s.trim().replace(/^['"]|['"]$/g, '')
  const inline = lines[i].slice('protected_branches:'.length).replace(/#.*$/, '').trim()
  if (inline.startsWith('[')) {
    return inline.slice(1, inline.indexOf(']')).split(',').map(clean).filter(Boolean)
  }
  const out = []
  for (const line of lines.slice(i + 1)) {
    const m = /^\\s+-\\s*([^#]+)/.exec(line)
    if (!m) break
    out.push(clean(m[1]))
  }
  return out.filter(Boolean)
}

// async read: readFileSync(0) throws EAGAIN when stdin is a non-blocking pipe
let input = ''
if (!process.stdin.isTTY) {
  for await (const chunk of process.stdin) input += chunk
}
const updates = input.split(/\\r?\\n/).map((l) => l.trim().split(/\\s+/)).filter((p) => p.length === 4)
const prot = new Set(protectedBranches(configRaw))
const targets = updates.filter((p) => p[2].startsWith('refs/heads/') && prot.has(p[2].slice(11)))
if (targets.length === 0) process.exit(0)
const names = targets.map((p) => p[2].slice(11)).join(', ')

for (const p of targets) {
  if (/^0+$/.test(p[1])) refuse('deleting protected branch ' + p[2].slice(11) + ' is not allowed.')
}
if (!state) refuse('.between/state.json is unreadable.')

const configUsesFakeAgent = /(?:^|\\s|[\\\\/])fake-agent\\.mjs(?:\\s|$)/.test(configRaw || '')
if (state.evidence_trust === 'simulated' || configUsesFakeAgent) {
  refuse('SIMULATION project (fake agent); reviews are not real verification. Run: between init --agent claude|codex.')
}

const secret = process.env.BETWEEN_APPROVAL_SECRET || ''
const ap = state.approval
if (!ap) refuse('a push to ' + names + ' needs a merge approval (run: between approve merge).')
if (ap.scope !== 'merge') refuse('only a merge approval authorizes a push (got ' + ap.scope + ').')
if (!secret) refuse('BETWEEN_APPROVAL_SECRET is not set, so the approval cannot be verified.')

function valid(a) {
  if (!a.sig) return false
  let payload = a.scope + ':' + (a.diff_hash || '') + ':' + a.cycle + ':' + (a.bundle_id || '') + ':' + a.expires_at
  if (a.tree) payload += ':tree=' + a.tree
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  if (a.sig.length !== expected.length) return false
  try { return timingSafeEqual(Buffer.from(a.sig), Buffer.from(expected)) } catch { return false }
}
if (!valid(ap)) refuse('recorded approval failed signature verification.')

const d = state.diff || {}
const wf = state.workflow || {}
let stale = null
if (ap.diff_hash !== (d.hash ?? null)) stale = 'diff hash changed'
else if (ap.cycle !== wf.cycle) stale = 'cycle changed'
else if (ap.bundle_id !== (d.bundle_id ?? null)) stale = 'review bundle changed'
else if (!(Date.parse(ap.expires_at) > Date.now())) stale = 'approval expired'
if (stale) refuse('approval no longer valid (' + stale + '). Re-approve the current diff.')

if (!ap.tree) refuse('approval is not bound to a tree; re-approve with: between approve merge.')
for (const p of targets) {
  let tree = ''
  try {
    tree = execFileSync('git', ['rev-parse', '--verify', '-q', p[1] + '^{tree}'], { cwd: root, encoding: 'utf8' }).trim()
  } catch { tree = '' }
  if (tree !== ap.tree) {
    refuse('pushed tree for ' + p[2].slice(11) + ' does not match the approved tree (approved ' + ap.tree.slice(0, 12) + ', pushing ' + (tree.slice(0, 12) || 'unknown') + ').')
  }
}
process.exit(0)
`

const HOOK = `#!/bin/sh
# ${MARKER} (installed by 'between init'). Remove this file to disable the push gate.
exec node "$(git rev-parse --git-common-dir)/${MARKER}.mjs"
`

/**
 * Where git actually looks for this checkout's hooks, and the repository's common git dir.
 * `--git-path hooks` honors `core.hooksPath` and linked worktrees (where `.git` is a file);
 * the common dir is shared by all worktrees, so one gate script serves every checkout.
 * Null when `root` is not the top of a git work tree.
 */
function gitHookLocations(root: string): { hooksDir: string; commonDir: string } | null {
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  try {
    if (realpathSync.native(git('rev-parse', '--show-toplevel')) !== realpathSync.native(root)) {
      return null
    }
    return {
      hooksDir: resolve(root, git('rev-parse', '--git-path', 'hooks')),
      commonDir: resolve(root, git('rev-parse', '--git-common-dir')),
    }
  } catch {
    return null
  }
}

export type PrePushHookInstallResult =
  | { kind: 'installed'; path: string }
  | { kind: 'already_installed'; path: string }
  | { kind: 'not_git_repo' }
  | { kind: 'conflict'; path: string }
  | { kind: 'failed'; reason: string }

export function installPrePushHookDetailed(root: string): PrePushHookInstallResult {
  const locations = gitHookLocations(root)
  if (!locations) return { kind: 'not_git_repo' }
  const { hooksDir, commonDir } = locations
  try {
    mkdirSync(hooksDir, { recursive: true })
    writeFileSync(join(commonDir, `${MARKER}.mjs`), VERIFY_PUSH_SCRIPT, 'utf8')
    const hookPath = join(hooksDir, 'pre-push')
    let alreadyInstalled = false
    if (existsSync(hookPath)) {
      const cur = readFileSync(hookPath, 'utf8')
      if (!cur.includes(MARKER)) return { kind: 'conflict', path: hookPath }
      alreadyInstalled = true
    }
    writeFileSync(hookPath, HOOK, 'utf8')
    try {
      chmodSync(hookPath, 0o755)
    } catch {
      return { kind: alreadyInstalled ? 'already_installed' : 'installed', path: hookPath }
    }
    return { kind: alreadyInstalled ? 'already_installed' : 'installed', path: hookPath }
  } catch (e) {
    return { kind: 'failed', reason: e instanceof Error ? e.message : String(e) }
  }
}

export function installPrePushHook(root: string): string | null {
  const result = installPrePushHookDetailed(root)
  return result.kind === 'installed' || result.kind === 'already_installed' ? result.path : null
}
