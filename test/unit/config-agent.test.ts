import { describe, it, expect } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { DEFAULT_CONFIG, parseConfig, defaultConfigYaml } from '../../src/core/config-schema'

describe('config agent-embedding keys', () => {
  it('defaults to the zero-risk file mode', () => {
    expect(DEFAULT_CONFIG.agent_mode).toBe('file')
    expect(DEFAULT_CONFIG.developer_command).toContain('fake-agent.mjs')
    expect(DEFAULT_CONFIG.reviewer_command).toContain('reviewer')
    expect(DEFAULT_CONFIG.agent_pane_visible_rows).toBeGreaterThan(0)
    expect(DEFAULT_CONFIG.builder_agent_count).toBe(1)
    expect(DEFAULT_CONFIG.reviewer_agent_count).toBe(1)
    expect(DEFAULT_CONFIG.ide_cli_rules_mode).toBe('project_only')
    expect(DEFAULT_CONFIG.ide_cli_profile_dir).toBe('.between/ide-profile')
    expect(DEFAULT_CONFIG.ide_permission_mode).toBe('guard')
    expect(DEFAULT_CONFIG.ide_working_folder).toBe('.')
    expect(DEFAULT_CONFIG.ide_followup_mode).toBe('steer')
  })

  it('accepts the agent_mode enum and rejects unknown modes', () => {
    expect(parseConfig({ agent_mode: 'oneshot' }).agent_mode).toBe('oneshot')
    expect(parseConfig({ agent_mode: 'pty' }).agent_mode).toBe('pty')
    expect(() => parseConfig({ agent_mode: 'telepathy' })).toThrow()
  })

  it('still validates a pre-existing config that omits the new keys (.strict + defaults)', () => {
    const old = { schema_version: 1, watch_interval_seconds: 6, diff_debounce_seconds: 25 }
    expect(() => parseConfig(old)).not.toThrow()
    expect(parseConfig(old).agent_mode).toBe('file')
  })

  it('writes the new keys into the documented default YAML', () => {
    const parsed = parseYaml(defaultConfigYaml())
    expect(() => parseConfig(parsed)).not.toThrow()
    expect(parseConfig(parsed).agent_mode).toBe('file')
    expect(parseConfig(parsed).developer_command).toContain('fake-agent.mjs')
    expect(parseConfig(parsed).builder_agent_count).toBe(1)
    expect(parseConfig(parsed).reviewer_agent_count).toBe(1)
    expect(parseConfig(parsed).ide_cli_rules_mode).toBe('project_only')
    expect(parseConfig(parsed).ide_cli_profile_dir).toBe('.between/ide-profile')
    expect(parseConfig(parsed).ide_permission_mode).toBe('guard')
    expect(parseConfig(parsed).ide_working_folder).toBe('.')
    expect(parseConfig(parsed).ide_followup_mode).toBe('steer')
  })

  it('validates per-project IDE agent topology, rules profile, and task controls', () => {
    const cfg = parseConfig({
      builder_agent_count: 3,
      reviewer_agent_count: 2,
      ide_cli_rules_mode: 'inherit_global',
      ide_cli_profile_dir: '.between/ide-profile/codex-local',
      ide_permission_mode: 'read_only',
      ide_working_folder: 'packages/app',
      ide_followup_mode: 'queue',
    })

    expect(cfg.builder_agent_count).toBe(3)
    expect(cfg.reviewer_agent_count).toBe(2)
    expect(cfg.ide_cli_rules_mode).toBe('inherit_global')
    expect(cfg.ide_cli_profile_dir).toBe('.between/ide-profile/codex-local')
    expect(cfg.ide_permission_mode).toBe('read_only')
    expect(cfg.ide_working_folder).toBe('packages/app')
    expect(cfg.ide_followup_mode).toBe('queue')
    expect(() => parseConfig({ builder_agent_count: 0 })).toThrow(/builder_agent_count/)
    expect(() => parseConfig({ reviewer_agent_count: 17 })).toThrow(/reviewer_agent_count/)
    expect(() => parseConfig({ ide_cli_rules_mode: 'unsafe' })).toThrow(/ide_cli_rules_mode/)
    expect(() => parseConfig({ ide_cli_profile_dir: '../outside' })).toThrow(/ide_cli_profile_dir/)
    expect(() => parseConfig({ ide_cli_profile_dir: 'C:\\Users\\lg\\.codex' })).toThrow(
      /ide_cli_profile_dir/,
    )
    expect(() => parseConfig({ ide_permission_mode: 'root' })).toThrow(/ide_permission_mode/)
    expect(() => parseConfig({ ide_working_folder: '../outside' })).toThrow(/ide_working_folder/)
    expect(() => parseConfig({ ide_working_folder: 'C:\\Users\\lg\\repo' })).toThrow(
      /ide_working_folder/,
    )
    expect(() => parseConfig({ ide_followup_mode: 'overwrite' })).toThrow(/ide_followup_mode/)
  })
})
