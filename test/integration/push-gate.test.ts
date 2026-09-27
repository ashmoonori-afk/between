import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '../../src/core/clock'
import { initProject } from '../../src/adapters/init-project'
import { signApproval, approvalExpiry } from '../../src/core/approval'
import { APPROVAL_SECRET_ENV } from '../../src/adapters/approval-secret'
import { parsePrePushInput, verifyPush } from '../../src/api/checks'

let dir: string
let head: string
let tree: string
const key = 'push-gate-human-secret'
const ZERO = '0'.repeat(40)
const OTHER_TREE = 'f'.repeat(40)
const priorApprovalSecret = process.env[APPROVAL_SECRET_ENV]

async function git(args: string[]): Promise<string> {
  const r = await execa('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir })
  return r.stdout.trim()
}

beforeEach(async () => {
  process.env[APPROVAL_SECRET_ENV] = key
  dir = realpathSync.native(await mkdtemp(join(tmpdir(), 'between-pushgate-')))
  await git(['init', '-q', '-b', 'main'])
  await git(['config', 'user.email', 't@t.t'])
  await git(['config', 'user.name', 't'])
  // a real preset so evidence_trust is 'real' (a simulation would be blocked first)
  await initProject(dir, { developer: 'claude', reviewer: 'codex' }, new FakeClock(0))
  expect(existsSync(join(dir, '.git', 'between-approval.key'))).toBe(false)
  // a permissive policy so the API's policy stage cannot mask approval/tree results
  await writeFile(
    join(dir, '.between', 'policy.yaml'),
    [
      'version: 1',
      'gates:',
      '  high: []',
      '  normal: []',
      'approvals:',
      '  high: { reviewers: 1, local_human_required: false }',
      '  normal: { reviewers: 1, local_human_required: false }',
      '',
    ].join('\n'),
  )
  await writeFile(join(dir, 'app.txt'), 'reviewed\n')
  await git(['add', '-A'])
  await git(['commit', '-q', '-m', 'reviewed change'])
  head = await git(['rev-parse', 'HEAD'])
  tree = await git(['rev-parse', 'HEAD^{tree}'])
})
afterEach(async () => {
  if (priorApprovalSecret === undefined) delete process.env[APPROVAL_SECRET_ENV]
  else process.env[APPROVAL_SECRET_ENV] = priorApprovalSecret
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

interface StateOptions {
  scope?: 'merge' | 'deploy' | 'promote_rule'
  /** tree covered by the signature; null = an approval without a tree */
  signedTree?: string | null
  /** tree stored in state (defaults to signedTree) */
  storedTree?: string | null
  stateHash?: string
  tamperBundle?: boolean
  expired?: boolean
  noApproval?: boolean
  phase?: string
}

/** Write a state.json (based on the initialized one) with a signed approval. */
async function writeState(o: StateOptions = {}): Promise<void> {
  const statePath = join(dir, '.between', 'state.json')
  const state = JSON.parse(await readFile(statePath, 'utf8'))
  const scope = o.scope ?? 'merge'
  const signedTree = o.signedTree === undefined ? tree : o.signedTree
  const expiresAt = o.expired ? approvalExpiry(-3_600_000) : approvalExpiry(Date.now())
  const sig = signApproval(key, {
    scope,
    diff_hash: 'X',
    cycle: 1,
    bundle_id: null,
    expires_at: expiresAt,
    tree: signedTree,
  })
  state.workflow = { ...state.workflow, phase: o.phase ?? 'done', cycle: 1 }
  state.diff = { ...state.diff, hash: o.stateHash ?? 'X', bundle_id: null }
  state.evidence_trust = 'real'
  state.approval = o.noApproval
    ? null
    : {
        actor: 'human',
        scope,
        diff_hash: 'X',
        cycle: 1,
        granted_at: new Date().toISOString(),
        sig,
        bundle_id: o.tamperBundle ? 'TAMPERED' : null,
        expires_at: expiresAt,
        tree: o.storedTree === undefined ? signedTree : o.storedTree,
      }
  await writeFile(statePath, JSON.stringify(state, null, 2))
}

function pushLine(branch: string, sha = head): string {
  return `refs/heads/local ${sha} refs/heads/${branch} ${ZERO}`
}

/** Run the installed hook and the core API on the same push; both verdicts must agree. */
async function gate(line: string): Promise<{ allowed: boolean; reason: string }> {
  const hook = await execa('node', ['.git/between-verify-push.mjs'], {
    cwd: dir,
    reject: false,
    input: `${line}\n`,
    env: { ...process.env },
  })
  const api = await verifyPush(dir, parsePrePushInput(line))
  expect(api.allowed).toBe(hook.exitCode === 0)
  return { allowed: api.allowed, reason: `${hook.stderr}\n${api.message ?? ''}` }
}

async function expectRefused(line: string, reason: RegExp): Promise<void> {
  const r = await gate(line)
  expect(r.allowed).toBe(false)
  expect(r.reason).toMatch(reason)
}

describe('protected-branch push gate (hook and api agree)', () => {
  it('allows a protected push whose tree matches the signed approval', async () => {
    await writeState()
    expect((await gate(pushLine('main'))).allowed).toBe(true)
  })

  it('leaves feature-branch pushes open, even with no approval', async () => {
    await writeState({ noApproval: true })
    expect((await gate(pushLine('feature/x'))).allowed).toBe(true)
  })

  it('refuses a protected push after steer cleared the approval (Astra finding #1)', async () => {
    await writeState({ noApproval: true, phase: 'developing' })
    await expectRefused(pushLine('main'), /needs a merge approval/)
  })

  it('refuses a push of a different tree than the approved one', async () => {
    await writeState({ signedTree: OTHER_TREE })
    await expectRefused(pushLine('main'), /does not match the approved tree/)
  })

  it('refuses when the stored tree was tampered after signing', async () => {
    await writeState({ storedTree: OTHER_TREE })
    await expectRefused(pushLine('main'), /signature verification/)
  })

  it('refuses an approval that is not bound to a tree', async () => {
    await writeState({ signedTree: null })
    await expectRefused(pushLine('main'), /not bound to a tree/)
  })

  it('refuses deleting a protected branch', async () => {
    await writeState()
    await expectRefused(pushLine('main', ZERO), /deleting protected branch main/)
  })

  it('refuses a protected push when the approval secret is not set', async () => {
    await writeState()
    delete process.env[APPROVAL_SECRET_ENV]
    await expectRefused(pushLine('main'), /BETWEEN_APPROVAL_SECRET is not set/)
  })

  it('F2: refuses a signed DEPLOY or PROMOTE_RULE approval', async () => {
    await writeState({ scope: 'deploy' })
    await expectRefused(pushLine('main'), /only a merge approval/)
    await writeState({ scope: 'promote_rule' })
    await expectRefused(pushLine('main'), /only a merge approval/)
  })

  it('F1: refuses a merge approval whose bundle_id was tampered after signing', async () => {
    await writeState({ tamperBundle: true })
    await expectRefused(pushLine('main'), /signature verification/)
  })

  it('A2: refuses once the current diff moved on, and once expired', async () => {
    await writeState({ stateHash: 'Y' })
    await expectRefused(pushLine('main'), /no longer valid/)
    await writeState({ expired: true })
    await expectRefused(pushLine('main'), /no longer valid/)
  })

  it('refuses a protected push when the config points at the fake agent', async () => {
    await writeState()
    const cfgPath = join(dir, '.between', 'config.yaml')
    const cfg = await readFile(cfgPath, 'utf8')
    await writeFile(
      cfgPath,
      cfg
        .replace(
          /^developer_command:.*$/m,
          "developer_command: 'node .between/agents/fake-agent.mjs developer'",
        )
        .replace(
          /^reviewer_command:.*$/m,
          "reviewer_command: 'node .between/agents/fake-agent.mjs reviewer'",
        ),
    )
    await expectRefused(pushLine('main'), /SIMULATION/)
    expect((await gate(pushLine('feature/x'))).allowed).toBe(true)
  })

  it('honors configured protected_branches in flow and block form', async () => {
    await writeState({ noApproval: true })
    const cfgPath = join(dir, '.between', 'config.yaml')
    const cfg = await readFile(cfgPath, 'utf8')
    expect(cfg).toMatch(/^protected_branches: \[main\]/m)

    await writeFile(
      cfgPath,
      cfg.replace(/^protected_branches:.*$/m, "protected_branches: [release, 'prod']"),
    )
    expect((await gate(pushLine('main'))).allowed).toBe(true)
    await expectRefused(pushLine('release'), /needs a merge approval/)
    await expectRefused(pushLine('prod'), /needs a merge approval/)

    await writeFile(
      cfgPath,
      cfg.replace(/^protected_branches:.*$/m, 'protected_branches:\n  - main\n  - release # rc'),
    )
    await expectRefused(pushLine('main'), /needs a merge approval/)
    await expectRefused(pushLine('release'), /needs a merge approval/)
    expect((await gate(pushLine('feature/x'))).allowed).toBe(true)
  })
})

describe('pre-push hook fail-closed paths', () => {
  it('refuses a protected push when state.json is unreadable', async () => {
    await writeFile(join(dir, '.between', 'state.json'), '{not json')
    const r = await execa('node', ['.git/between-verify-push.mjs'], {
      cwd: dir,
      reject: false,
      input: `${pushLine('main')}\n`,
    })
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toMatch(/unreadable/)
  })
})
