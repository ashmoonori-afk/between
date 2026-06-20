import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'
import {
  buildEvidenceMarkdown,
  readBetweenWorkspace,
  submitBetweenAction,
} from '../src/workspace.js'

describe('workspace actions', () => {
  it('reads current cockpit findings from .between state, review, and bundle', async () => {
    const root = await seedWorkspace()

    const view = await readBetweenWorkspace(root, '2026-06-20T00:00:00.000Z')

    expect(view.project).toBe('demo')
    expect(view.model.findings).toHaveLength(2)
    expect(view.model.findings[0].linked).toBe(true)
    expect(view.model.findings[1].stale).toBe(true)
    expect(view.canApprove).toBe(true)
    expect(buildEvidenceMarkdown(view)).toMatch(/bundle_id: `b{64}`/)
  })

  it('writes daemon command files for review, fix, and exact bundle approval', async () => {
    const root = await seedWorkspace()
    const expiresAt = new Date(Date.parse('2026-06-20T00:00:00.000Z') + 3_600_000).toISOString()
    const previousSecret = process.env.BETWEEN_APPROVAL_SECRET
    delete process.env.BETWEEN_APPROVAL_SECRET

    try {
      await submitBetweenAction(root, { kind: 'request_second_review' })
      await submitBetweenAction(root, { kind: 'ask_developer_to_fix', message: 'fix F1' })
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
    expect(commands.map((command) => command.kind)).toEqual(['review_now', 'goal', 'approve'])
    expect(commands[1]).toEqual({ kind: 'goal', goal: 'fix F1' })
    expect(commands[2].bundle_id).toBe('b'.repeat(64))
    expect(commands[2].expires_at).toBe(expiresAt)
    expect(commands[2].sig).toBe(
      createHmac('sha256', 'ide-secret')
        .update(`merge:${'d'.repeat(64)}:1:${'b'.repeat(64)}:${expiresAt}`)
        .digest('hex'),
    )
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
})

async function readCommands(root: string): Promise<Array<Record<string, unknown>>> {
  const dir = join(root, '.between', 'commands')
  const names = (await import('node:fs/promises')).readdir(dir)
  return Promise.all(
    (await names).sort().map(async (name) => JSON.parse(await readFile(join(dir, name), 'utf8'))),
  )
}

async function seedWorkspace(
  options: { evidenceTrust?: 'real' | 'simulated'; writeBundle?: boolean } = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'between-vscode-workspace-'))
  await mkdir(join(root, '.git'), { recursive: true })
  await mkdir(join(root, '.between', 'reviews'), { recursive: true })
  await mkdir(join(root, '.between', 'bundles'), { recursive: true })
  await writeFile(join(root, '.git', 'between-approval.key'), 'ide-secret\n')
  await writeFile(join(root, 'app.ts'), 'const a = 1\nconst b = 2\n')
  await writeFile(
    join(root, '.between', 'state.json'),
    JSON.stringify({
      project: { name: 'demo', root, obsidian_project_path: null },
      workflow: { phase: 'human_gate', cycle: 1 },
      diff: { hash: 'd'.repeat(64), bundle_id: 'b'.repeat(64) },
      evidence_trust: options.evidenceTrust ?? 'real',
      developer: { name: 'claude' },
      reviewer: { name: 'codex' },
      approval: null,
    }),
  )
  await writeFile(
    join(root, '.between', 'reviews', 'cycle-0001.json'),
    JSON.stringify({
      cycle: 1,
      diff_hash: 'd'.repeat(64),
      complete: true,
      findings: [
        {
          id: 'F1',
          severity: 'blocking',
          summary: '[app.ts:2] missing guard',
          target_hash: 'd'.repeat(64),
        },
        { id: 'F2', severity: 'non-blocking', summary: '[app.ts:3] old note', target_hash: 'old' },
      ],
    }),
  )
  if (options.writeBundle !== false) {
    await writeFile(
      join(root, '.between', 'bundles', `${'b'.repeat(64)}.json`),
      JSON.stringify({
        bundle_id: 'b'.repeat(64),
        diff_hash: 'd'.repeat(64),
        repository: { head_sha: 'a'.repeat(40), branch: 'main' },
        diff: {
          tracked: 'diff --git a/app.ts b/app.ts\n@@ -1,1 +1,2 @@\n const a = 1\n+const b = 2\n',
        },
      }),
    )
  }
  return root
}
