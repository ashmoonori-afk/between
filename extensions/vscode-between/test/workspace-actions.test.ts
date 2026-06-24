import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'
import {
  buildBrokerInputCommand,
  buildEvidenceMarkdown,
  readBetweenWorkspace,
  submitBetweenAction,
} from '../src/workspace.js'
import { readCommands, seedWorkspace } from './workspace-fixtures'

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
    const expiresAt = new Date(Date.parse('2026-06-20T00:00:00.000Z') + 3_600_000).toISOString()
    const previousSecret = process.env.BETWEEN_APPROVAL_SECRET
    delete process.env.BETWEEN_APPROVAL_SECRET

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
    expect(commands[3].sig).toBe(
      createHmac('sha256', 'ide-secret')
        .update(`merge:${'d'.repeat(64)}:1:${'b'.repeat(64)}:${expiresAt}`)
        .digest('hex'),
    )
    const config = await readFile(join(root, '.between', 'config.yaml'), 'utf8')
    expect(config).toContain('builder_agent_count: 4')
    expect(config).toContain('reviewer_agent_count: 2')
    expect(config).toContain('ide_permission_mode: full_access')
    expect(config).toContain('ide_working_folder: "packages/worker"')
    expect(config).toContain('ide_followup_mode: queue')
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
