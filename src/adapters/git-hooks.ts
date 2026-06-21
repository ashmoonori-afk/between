import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MARKER = 'between-verify-push'

const VERIFY_PUSH_SCRIPT = `import { readFileSync } from 'node:fs'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'

const root = process.cwd()
function rd(p) { try { return readFileSync(join(root, p), 'utf8') } catch { return null } }
const raw = rd('.between/state.json')
if (!raw) process.exit(0)
let state
try { state = JSON.parse(raw) } catch { process.exit(0) }

const configRaw = rd('.between/config.yaml') || ''
const configUsesFakeAgent = /(?:^|\\s|[\\\\/])fake-agent\\.mjs(?:\\s|$)/.test(configRaw)
if (state.evidence_trust === 'simulated' || configUsesFakeAgent) {
  process.stderr.write('between: refusing push -- SIMULATION project (fake agent); reviews are not real verification. Run: between init --agent claude|codex.\\n')
  process.exit(1)
}

const secret = process.env.BETWEEN_APPROVAL_SECRET || ''
const ap = state.approval
const phase = state.workflow && state.workflow.phase

if (ap && ap.scope !== 'merge') {
  process.stderr.write('between: refusing push -- only a merge approval authorizes a push (got ' + ap.scope + ').\\n')
  process.exit(1)
}

function valid(a) {
  if (!secret || !a || !a.sig) return false
  const payload = a.scope + ':' + (a.diff_hash || '') + ':' + a.cycle + ':' + (a.bundle_id || '') + ':' + a.expires_at
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  if (a.sig.length !== expected.length) return false
  try { return timingSafeEqual(Buffer.from(a.sig), Buffer.from(expected)) } catch { return false }
}

if (ap && !valid(ap)) {
  process.stderr.write('between: refusing push -- recorded approval failed signature verification.\\n')
  process.exit(1)
}
if (ap && valid(ap)) {
  const d = state.diff || {}
  const wf = state.workflow || {}
  let stale = null
  if (ap.diff_hash !== (d.hash ?? null)) stale = 'diff hash changed'
  else if (ap.cycle !== wf.cycle) stale = 'cycle changed'
  else if (ap.bundle_id !== (d.bundle_id ?? null)) stale = 'review bundle changed'
  else if (!(Date.parse(ap.expires_at) > Date.now())) stale = 'approval expired'
  if (stale) {
    process.stderr.write('between: refusing push -- approval no longer valid (' + stale + '). Re-approve the current diff.\\n')
    process.exit(1)
  }
}
if (!ap && phase === 'human_gate') {
  process.stderr.write('between: refusing push -- human approval is pending (run: between approve merge).\\n')
  process.exit(1)
}
process.exit(0)
`

const HOOK = `#!/bin/sh
# ${MARKER} (installed by 'between init'). Remove this file to disable the push gate.
exec node "$(git rev-parse --git-dir)/${MARKER}.mjs"
`

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
      if (!cur.includes(MARKER)) return null
    }
    writeFileSync(hookPath, HOOK, 'utf8')
    try {
      chmodSync(hookPath, 0o755)
    } catch {
      return hookPath
    }
    return hookPath
  } catch {
    return null
  }
}
