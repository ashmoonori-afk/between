import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'

const MARKER = 'between-verify-push'

/**
 * A standalone, stdlib-only verifier dropped into `.git/`. It blocks a push when a recorded
 * approval fails signature verification (forged `state.json`) or when a human gate is pending
 * without approval (P1-5). It needs no Between install — only Node + the approval secret
 * (`BETWEEN_APPROVAL_SECRET` env or the `.git/between-approval.key`).
 */
const VERIFY_PUSH_SCRIPT = `import { readFileSync, existsSync } from 'node:fs'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'

const root = process.cwd()
function rd(p) { try { return readFileSync(join(root, p), 'utf8') } catch { return null } }
const raw = rd('.between/state.json')
if (!raw) process.exit(0) // not a Between target -> never block
let state
try { state = JSON.parse(raw) } catch { process.exit(0) }

const keyFile = join(root, '.git', 'between-approval.key')
const secret = process.env.BETWEEN_APPROVAL_SECRET || (existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : '')
const ap = state.approval
const phase = state.workflow && state.workflow.phase

function valid(a) {
  if (!secret || !a || !a.sig) return false
  const payload = a.scope + ':' + (a.diff_hash || '') + ':' + a.cycle
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  if (a.sig.length !== expected.length) return false
  try { return timingSafeEqual(Buffer.from(a.sig), Buffer.from(expected)) } catch { return false }
}

if (ap && !valid(ap)) {
  process.stderr.write('between: refusing push — recorded approval failed signature verification.\\n')
  process.exit(1)
}
// A2: a valid signature is necessary but not sufficient — the approval must still match the
// current diff/cycle/bundle and not be expired, or a stale approval could push new content.
if (ap && valid(ap)) {
  const d = state.diff || {}
  const wf = state.workflow || {}
  let stale = null
  if (ap.diff_hash !== (d.hash ?? null)) stale = 'diff hash changed'
  else if (ap.cycle !== wf.cycle) stale = 'cycle changed'
  else if (ap.bundle_id !== (d.bundle_id ?? null)) stale = 'review bundle changed'
  else if (!(Date.parse(ap.expires_at) > Date.now())) stale = 'approval expired'
  if (stale) {
    process.stderr.write('between: refusing push — approval no longer valid (' + stale + '). Re-approve the current diff.\\n')
    process.exit(1)
  }
}
if (!ap && phase === 'human_gate') {
  process.stderr.write('between: refusing push — human approval is pending (run: between approve merge).\\n')
  process.exit(1)
}
process.exit(0)
`

const HOOK = `#!/bin/sh
# ${MARKER} (installed by 'between init'). Remove this file to disable the push gate.
exec node "$(git rev-parse --git-dir)/${MARKER}.mjs"
`

/**
 * Install the pre-push approval gate. Returns the hook path if written, null if skipped
 * (no `.git/hooks`, or a non-Between pre-push hook already exists — we never clobber it).
 */
export function installPrePushHook(root: string): string | null {
  const gitDir = join(root, '.git')
  const hooksDir = join(gitDir, 'hooks')
  if (!existsSync(gitDir)) return null
  try {
    mkdirSync(hooksDir, { recursive: true })
    writeFileSync(join(gitDir, `${MARKER}.mjs`), VERIFY_PUSH_SCRIPT, 'utf8')
    const hookPath = join(hooksDir, 'pre-push')
    if (existsSync(hookPath)) {
      const cur = readFileSync(hookPath, 'utf8')
      if (!cur.includes(MARKER)) return null // respect a user's existing hook
    }
    writeFileSync(hookPath, HOOK, 'utf8')
    try {
      chmodSync(hookPath, 0o755)
    } catch {
      // exec bit is irrelevant on Windows (git runs hooks via sh)
    }
    return hookPath
  } catch {
    return null
  }
}
