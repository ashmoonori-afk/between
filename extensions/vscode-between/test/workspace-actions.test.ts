import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'
import { promisify } from 'node:util'
import { verifyApproval, type ApprovalClaim } from '../../../src/core/approval.js'
import {
  buildBrokerInputCommand,
  buildEvidenceMarkdown,
  readBetweenWorkspace,
  submitBetweenAction,
} from '../src/workspace.js'
import { readCommands, seedWorkspace } from './workspace-fixtures'

const execFileAsync = promisify(execFile)
const GIT_ENV = { ...process.env, GIT_PAGER: 'cat', LC_ALL: 'C', TZ: 'UTC' }

function gitIn(cwd: string, args: string[]) {
  return execFileAsync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, env: GIT_ENV })
}

async function headTree(root: string): Promise<string> {
  const { stdout } = await gitIn(root, ['rev-parse', 'HEAD^{tree}'])
  return stdout.trim()
}

async function expectedWorktreeTree(root: string): Promise<string> {
  const { stdout: gitDirOut } = await gitIn(root, ['rev-parse', '--absolute-git-dir'])
  const tempIndex = join(gitDirOut.trim(), `between-expected-index-${Date.now()}`)
  const env = { ...GIT_ENV, GIT_INDEX_FILE: tempIndex }
  try {
    await execFileAsync('git', ['-c', 'core.autocrlf=false', 'add', '-A'], { cwd: root, env })
    const { stdout } = await execFileAsync('git', ['write-tree'], { cwd: root, env })
    return stdout.trim()
  } finally {
    await execFileAsync('git', ['-c', 'core.autocrlf=false', 'update-index', '--refresh'], {
      cwd: root,
      env,
    }).catch(() => {})
  }
}

async function stagedEntry(root: string): Promise<string> {
  const { stdout } = await gitIn(root, ['ls-files', '-s'])
  return stdout.trim()
}

describe('workspace actions', () => {
  it('reads current cockpit findings from .between state, review, and bundle', async () => {
    const root = await seedWorkspace()

    const view = await readBetweenWorkspace(root, '2026-06-20T00:00:00.000Z')

    expect(view.project).toBe('demo')
    expect(view.model.findings).toHaveLength(2)
    expect(view.model.findings[0].linked).toBe(true)
    expect(view.model.findings[1].stale).toBe(true)
    expect(view.canApprove).toBe(true)
    expect(view.ideProfile.panes.map((pane) => pane.target)).toEqual(['builder:1', 'reviewer:1'])
    expect(view.ideProfile.permissionMode).toBe('guard')
    expect(view.ideProfile.workingFolder).toBe('packages/app')
    expect(view.ideProfile.followupMode).toBe('steer')
    expect(buildEvidenceMarkdown(view)).toMatch(/bundle_id: `b{64}`/)
  })

  it('writes daemon command files for review, fix, and exact bundle approval', async () => {
    const root = await seedWorkspace()
    await gitIn(root, ['init', '-q'])
    await gitIn(root, ['config', 'user.email', 'test@example.com'])
    await gitIn(root, ['config', 'user.name', 'Test'])
    await writeFile(join(root, '.gitignore'), '.between/\n', 'utf8')
    await writeFile(join(root, 'app.ts'), 'const a = 1\n', 'utf8')
    await gitIn(root, ['add', '-A'])
    const expiresAt = new Date(Date.parse('2026-06-20T00:00:00.000Z') + 3_600_000).toISOString()
    const previousSecret = process.env.BETWEEN_APPROVAL_SECRET
    process.env.BETWEEN_APPROVAL_SECRET = 'ide-secret'
    const expectedTree = await expectedWorktreeTree(root)

    try {
      await submitBetweenAction(root, { kind: 'request_second_review' })
      await submitBetweenAction(root, { kind: 'ask_developer_to_fix', message: 'fix F1' })
      await submitBetweenAction(root, {
        kind: 'configure_topology',
        builderAgentCount: 4,
        reviewerAgentCount: 2,
        permissionMode: 'full_access',
        workingFolder: 'packages/worker',
        followupMode: 'queue',
      })
      await submitBetweenAction(root, { kind: 'broker_input', message: 'keep broker-only IDE' })
      await submitBetweenAction(
        root,
        { kind: 'approve_exact_bundle' },
        Date.parse('2026-06-20T00:00:00.000Z'),
      )
    } finally {
      if (previousSecret === undefined) delete process.env.BETWEEN_APPROVAL_SECRET
      else process.env.BETWEEN_APPROVAL_SECRET = previousSecret
    }

    const commands = await readCommands(root)
    expect(commands.map((command) => command.kind)).toEqual([
      'review_now',
      'goal',
      'steer_goal',
      'approve',
    ])
    expect(commands[1]).toEqual({ kind: 'goal', goal: 'fix F1' })
    expect(commands[2]).toEqual({ kind: 'steer_goal', goal: 'keep broker-only IDE' })
    expect(commands[3].bundle_id).toBe('b'.repeat(64))
    expect(commands[3].expires_at).toBe(expiresAt)
    expect(commands[3].tree).toBe(expectedTree)
    expect(commands[3].sig).toBe(
      createHmac('sha256', 'ide-secret')
        .update(`merge:${'d'.repeat(64)}:1:${'b'.repeat(64)}:${expiresAt}:tree=${expectedTree}`)
        .digest('hex'),
    )
    const config = await readFile(join(root, '.between', 'config.yaml'), 'utf8')
    expect(config).toContain('builder_agent_count: 4')
    expect(config).toContain('reviewer_agent_count: 2')
    expect(config).toContain('ide_permission_mode: full_access')
    expect(config).toContain('ide_working_folder: "packages/worker"')
    expect(config).toContain('ide_followup_mode: queue')
  })

  it('signs exact bundle approval for the working tree without changing the index', async () => {
    const root = await seedWorkspace()
    await gitIn(root, ['init', '-q'])
    await gitIn(root, ['config', 'user.email', 'test@example.com'])
    await gitIn(root, ['config', 'user.name', 'Test'])
    await writeFile(join(root, '.gitignore'), '.between/\n', 'utf8')
    await writeFile(join(root, 'head.txt'), 'head\n', 'utf8')
    await gitIn(root, ['add', 'head.txt'])
    await gitIn(root, ['commit', '-q', '-m', 'head'])
    const head = await headTree(root)
    await writeFile(join(root, 'app.ts'), 'const a = 1\nconst staged = true\n', 'utf8')
    await gitIn(root, ['add', 'app.ts'])
    await writeFile(join(root, 'app.ts'), 'const a = 1\nconst staged = true\nconst unstaged = 2\n', 'utf8')
    await writeFile(join(root, 'untracked.txt'), 'brand new\n', 'utf8')
    const indexBefore = await stagedEntry(root)
    const expected = await expectedWorktreeTree(root)
    expect(expected).not.toBe(head)

    const previousSecret = process.env.BETWEEN_APPROVAL_SECRET
    process.env.BETWEEN_APPROVAL_SECRET = 'ide-secret'
    let command: Record<string, unknown>
    try {
      await submitBetweenAction(
        root,
        { kind: 'approve_exact_bundle' },
        Date.parse('2026-06-20T00:00:00.000Z'),
      )
      command = (await readCommands(root))[0]
    } finally {
      if (previousSecret === undefined) delete process.env.BETWEEN_APPROVAL_SECRET
      else process.env.BETWEEN_APPROVAL_SECRET = previousSecret
    }

    expect(command.tree).toBe(expected)
    expect(await stagedEntry(root)).toBe(indexBefore)

    const claim: ApprovalClaim = {
      scope: 'merge',
      diff_hash: 'd'.repeat(64),
      cycle: 1,
      bundle_id: 'b'.repeat(64),
      expires_at: command.expires_at as string,
      tree: command.tree as string,
    }
    expect(verifyApproval('ide-secret', String(command.sig), claim)).toBe(true)
    expect(verifyApproval('ide-secret', String(command.sig), { ...claim, tree: head })).toBe(false)
  })

  it('ignores repository approval keys without an environment secret', async () => {
    const root = await seedWorkspace()
    await writeFile(join(root, '.git', 'between-approval.key'), 'ide-secret\n', 'utf8')
    await gitIn(root, ['init', '-q'])
    await gitIn(root, ['config', 'user.email', 'test@example.com'])
    await gitIn(root, ['config', 'user.name', 'Test'])
    await writeFile(join(root, '.gitignore'), '.between/\n', 'utf8')
    await writeFile(join(root, 'app.ts'), 'const a = 1\n', 'utf8')
    await gitIn(root, ['add', '-A'])
    const previousSecret = process.env.BETWEEN_APPROVAL_SECRET
    delete process.env.BETWEEN_APPROVAL_SECRET

    try {
      await submitBetweenAction(
        root,
        { kind: 'approve_exact_bundle' },
        Date.parse('2026-06-20T00:00:00.000Z'),
      )
    } finally {
      if (previousSecret === undefined) delete process.env.BETWEEN_APPROVAL_SECRET
      else process.env.BETWEEN_APPROVAL_SECRET = previousSecret
    }

    const [command] = await readCommands(root)
    expect(command.kind).toBe('approve')
    expect(command.sig).toBeUndefined()
  })

  it('does not queue approval when the tree cannot be computed', async () => {
    const root = await seedWorkspace()
    const previousSecret = process.env.BETWEEN_APPROVAL_SECRET
    process.env.BETWEEN_APPROVAL_SECRET = 'ide-secret'

    try {
      await expect(
        submitBetweenAction(root, { kind: 'approve_exact_bundle' }),
      ).rejects.toThrow(/working tree/)
    } finally {
      if (previousSecret === undefined) delete process.env.BETWEEN_APPROVAL_SECRET
      else process.env.BETWEEN_APPROVAL_SECRET = previousSecret
    }

    await expect(readCommands(root).catch(() => [])).resolves.toEqual([])
  })

  it('rejects invalid topology values without changing config', async () => {
    const root = await seedWorkspace()
    await submitBetweenAction(root, {
      kind: 'configure_topology',
      builderAgentCount: 3,
      reviewerAgentCount: 2,
    })
    const before = await readFile(join(root, '.between', 'config.yaml'), 'utf8')

    await expect(
      submitBetweenAction(root, {
        kind: 'configure_topology',
        builderAgentCount: 0,
        reviewerAgentCount: 2,
      }),
    ).rejects.toThrow(/builderAgentCount/)

    expect(await readFile(join(root, '.between', 'config.yaml'), 'utf8')).toBe(before)
  })

  it('refuses exact bundle approval in simulated evidence mode', async () => {
    const root = await seedWorkspace({ evidenceTrust: 'simulated' })

    await expect(submitBetweenAction(root, { kind: 'approve_exact_bundle' })).rejects.toThrow(
      /requires real evidence/,
    )
  })

  it('requires the current sealed bundle before exposing or writing approval', async () => {
    const root = await seedWorkspace({ writeBundle: false })

    const view = await readBetweenWorkspace(root)

    expect(view.canApprove).toBe(false)
    await expect(submitBetweenAction(root, { kind: 'approve_exact_bundle' })).rejects.toThrow(
      /requires the current sealed bundle/,
    )
  })

  it('parses broker IDE input into command-bus messages', () => {
    expect(buildBrokerInputCommand({ workflow: { phase: 'idle' } }, 'ship it')).toEqual({
      kind: 'goal',
      goal: 'ship it',
    })
    expect(buildBrokerInputCommand({ workflow: { phase: 'human_gate' } }, 'adjust it')).toEqual({
      kind: 'steer_goal',
      goal: 'adjust it',
    })
    expect(buildBrokerInputCommand({ workflow: { phase: 'human_gate' } }, '/review')).toEqual({
      kind: 'review_now',
    })
    expect(buildBrokerInputCommand({ workflow: { phase: 'human_gate' } }, '/abort')).toEqual({
      kind: 'interrupt',
    })
    expect(buildBrokerInputCommand({ workflow: { phase: 'human_gate' } }, '/q')).toBeNull()
  })
})
