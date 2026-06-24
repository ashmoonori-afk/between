import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseConfig } from '../../src/core/config-schema'
import {
  buildIdeCliInvocation,
  buildIdeProfile,
  formatIdeCliInvocation,
  formatIdeProfile,
} from '../../src/ide/profile'

describe('IDE profile', () => {
  it('builds stable tmux-like pane targets from project-local agent counts', () => {
    const profile = buildIdeProfile(
      parseConfig({ builder_agent_count: 3, reviewer_agent_count: 2 }),
    )

    expect(profile.builderAgentCount).toBe(3)
    expect(profile.reviewerAgentCount).toBe(2)
    expect(profile.panes.map((pane) => pane.target)).toEqual([
      'builder:1',
      'builder:2',
      'builder:3',
      'reviewer:1',
      'reviewer:2',
    ])
  })

  it('prints an IDE-only CLI invocation that bypasses global agent rules without bypassing broker policy', () => {
    const cfg = parseConfig({
      developer_command: 'claude',
      reviewer_command: 'node .between/agents/codex-agent.mjs reviewer',
      ide_cli_rules_mode: 'project_only',
      ide_permission_mode: 'guard',
      ide_working_folder: 'workspaces/demo',
      ide_followup_mode: 'queue',
    })

    const builderInvocation = buildIdeCliInvocation('C:/repo/demo', 'builder', cfg)
    const reviewerInvocation = buildIdeCliInvocation('C:/repo/demo', 'reviewer:1', cfg)

    expect(builderInvocation.command).toBe('claude')
    expect(builderInvocation.target).toBe('builder:1')
    expect(builderInvocation.env.BETWEEN_IDE).toBe('1')
    expect(builderInvocation.env.BETWEEN_IDE_TARGET).toBe('builder:1')
    expect(builderInvocation.env.BETWEEN_IDE_RULES).toBe('project_only')
    expect(builderInvocation.env.BETWEEN_IDE_PERMISSION_MODE).toBe('guard')
    expect(builderInvocation.env.BETWEEN_IDE_WORKING_FOLDER).toBe('workspaces/demo')
    expect(builderInvocation.env.BETWEEN_IDE_FOLLOWUP_MODE).toBe('queue')
    expect(builderInvocation.bypassesGlobalRules).toBe(true)
    expect(builderInvocation.bypassesBrokerPolicy).toBe(false)
    expect(reviewerInvocation.command).toBe('node .between/agents/codex-agent.mjs reviewer')
    expect(reviewerInvocation.target).toBe('reviewer:1')
    expect(reviewerInvocation.env.CODEX_HOME).toBe(
      join('C:/repo/demo', '.between/ide-profile', 'codex'),
    )
    expect(reviewerInvocation.bypassesBrokerPolicy).toBe(false)
    expect(formatIdeCliInvocation(builderInvocation)).toContain('command: claude')
    expect(formatIdeCliInvocation(builderInvocation)).toContain('BETWEEN_IDE_RULES="project_only"')
    expect(formatIdeCliInvocation(builderInvocation)).toContain(
      'BETWEEN_IDE_PERMISSION_MODE="guard"',
    )
    expect(formatIdeCliInvocation(builderInvocation)).toContain(
      'BETWEEN_IDE_WORKING_FOLDER="workspaces/demo"',
    )
    expect(formatIdeCliInvocation(builderInvocation)).toContain('BETWEEN_IDE_FOLLOWUP_MODE="queue"')
    expect(formatIdeProfile(buildIdeProfile(cfg))).toContain('global rules bypassed')
    expect(formatIdeProfile(buildIdeProfile(cfg))).toContain('Permission mode: guard')
    expect(formatIdeProfile(buildIdeProfile(cfg))).toContain('Working folder:  workspaces/demo')
    expect(formatIdeProfile(buildIdeProfile(cfg))).toContain('Follow-up mode:  queue')
  })

  it('also isolates direct Codex commands', () => {
    const cfg = parseConfig({ reviewer_command: 'codex exec' })

    const reviewerInvocation = buildIdeCliInvocation('C:/repo/demo', 'reviewer', cfg)

    expect(reviewerInvocation.env.CODEX_HOME).toBe(
      join('C:/repo/demo', '.between/ide-profile', 'codex'),
    )
  })

  it('rejects unknown IDE targets before producing a CLI invocation', () => {
    const cfg = parseConfig({ builder_agent_count: 1, reviewer_agent_count: 1 })

    expect(() => buildIdeCliInvocation('C:/repo/demo', 'builder:2', cfg)).toThrow(
      /Unknown IDE target/,
    )
  })
})
