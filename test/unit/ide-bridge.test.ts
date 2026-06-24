import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { FakeClock } from '../../src/core/clock'
import { initialState, withProjection } from '../../src/core/state'
import { initProject } from '../../src/adapters/init-project'
import { StateRepository } from '../../src/adapters/state-repository'
import { CommandBus } from '../../src/adapters/command-bus'
import { betweenPaths, reviewPath } from '../../src/adapters/paths'
import { buildBundle } from '../../src/review/bundle'
import { writeBundle } from '../../src/review/store'
import { readIdeWorkspace, submitIdeAction } from '../../src/ide/bridge'

let dir: string
const now = '2026-06-20T00:00:00.000Z'

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-ide-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

describe('readIdeWorkspace', () => {
  it('reads local Between state, evidence findings, and approval availability', async () => {
    const hash = 'a'.repeat(64)
    await seedWorkspace(hash, { builderAgentCount: 2, reviewerAgentCount: 3 })

    const view = await readIdeWorkspace(dir, now)

    expect(view.project).toBe(basename(dir))
    expect(view.phase).toBe('human_gate')
    expect(view.findings).toHaveLength(2)
    expect(view.bundleId).toMatch(/^[a-f0-9]{64}$/)
    expect(view.canApprove).toBe(true)
    expect(view.ideProfile.panes.map((pane) => pane.target)).toEqual([
      'builder:1',
      'builder:2',
      'reviewer:1',
      'reviewer:2',
      'reviewer:3',
    ])
  })

  it('refuses a non-Between workspace', async () => {
    await expect(readIdeWorkspace(dir, now)).rejects.toThrow(/No \.between\/ found/)
  })
})

describe('submitIdeAction', () => {
  it('queues existing command-bus actions without writing state directly', async () => {
    await seedWorkspace('b'.repeat(64))

    await submitIdeAction(dir, { kind: 'request_second_review' })
    await submitIdeAction(dir, { kind: 'ask_developer_to_fix', message: 'please fix F1' })
    await submitIdeAction(dir, { kind: 'broker_input', message: 'keep the IDE broker-only' })
    await submitIdeAction(dir, { kind: 'broker_input', message: '/review' })
    await submitIdeAction(dir, { kind: 'broker_input', message: '/abort' })
    const drained = await new CommandBus(dir).drain()

    expect(drained.map((entry) => entry.command)).toEqual([
      { kind: 'review_now' },
      { kind: 'goal', goal: 'please fix F1' },
      { kind: 'steer_goal', goal: 'keep the IDE broker-only' },
      { kind: 'review_now' },
      { kind: 'interrupt' },
    ])
  })

  it('rejects quit input from the IDE bridge without writing a command', async () => {
    await seedWorkspace('c'.repeat(64))

    await expect(submitIdeAction(dir, { kind: 'broker_input', message: '/q' })).rejects.toThrow(
      /cannot quit/,
    )
    expect(await new CommandBus(dir).drain()).toEqual([])
  })
})

async function seedWorkspace(
  hash: string,
  options: { readonly builderAgentCount?: number; readonly reviewerAgentCount?: number } = {},
): Promise<void> {
  const clock = new FakeClock(Date.parse(now))
  await initProject(dir, {}, clock)
  if (options.builderAgentCount !== undefined || options.reviewerAgentCount !== undefined) {
    await writeFile(
      betweenPaths(dir).config,
      `schema_version: 1
builder_agent_count: ${options.builderAgentCount ?? 1}
reviewer_agent_count: ${options.reviewerAgentCount ?? 1}
ide_cli_rules_mode: project_only
ide_cli_profile_dir: .between/ide-profile
`,
    )
  }
  const bundle = buildBundle({
    diff: { tracked: 'diff --git a/app.ts b/app.ts\n', trackedRaw: '', untracked: [] },
    repository: { head_sha: 'c'.repeat(40), branch: 'main', index_tree: 'tree' },
    environment: { between_version: '0.1.0', git_version: 'git', attributes_hash: '' },
  })
  await writeBundle(dir, bundle)
  const base = initialState(
    {
      project: { name: basename(dir), root: dir, obsidian_project_path: null },
      evidenceTrust: 'real',
    },
    clock,
  )
  const state = withProjection({
    ...base,
    workflow: { ...base.workflow, phase: 'human_gate', cycle: 1, cycles_this_goal: 1 },
    diff: {
      ...base.diff,
      hash,
      changed_files: 1,
      insertions: 3,
      deletions: 1,
      bundle_id: bundle.bundle_id,
      bundle_path: `.between/bundles/${bundle.bundle_id}.json`,
    },
  })
  await new StateRepository(dir).write(state)
  const p = betweenPaths(dir)
  await mkdir(p.reviews, { recursive: true })
  await writeFile(
    reviewPath(p, 1),
    JSON.stringify({
      cycle: 1,
      diff_hash: hash,
      complete: true,
      findings: [
        { id: 'F1', severity: 'non-blocking', summary: 'First note', target_hash: hash },
        { id: 'F2', severity: 'non-blocking', summary: 'Second note', target_hash: hash },
      ],
    }),
  )
}
