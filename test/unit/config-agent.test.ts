import { describe, it, expect } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { DEFAULT_CONFIG, parseConfig, defaultConfigYaml } from '../../src/core/config-schema'

describe('config agent-embedding keys', () => {
  it('defaults to the zero-risk file mode', () => {
    expect(DEFAULT_CONFIG.agent_mode).toBe('file')
    expect(DEFAULT_CONFIG.developer_command).toContain('fake-agent.mjs')
    expect(DEFAULT_CONFIG.reviewer_command).toContain('reviewer')
    expect(DEFAULT_CONFIG.agent_pane_visible_rows).toBeGreaterThan(0)
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
  })
})
