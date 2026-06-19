import { describe, it, expect } from 'vitest'
import { parse as parseYaml } from 'yaml'
import {
  DEFAULT_CONFIG,
  parseConfig,
  defaultConfigYaml,
  ConfigSchema,
} from '../../src/core/config-schema'

describe('config-schema', () => {
  it('exposes fully-defaulted config', () => {
    expect(DEFAULT_CONFIG.watch_interval_seconds).toBe(6)
    expect(DEFAULT_CONFIG.diff_debounce_seconds).toBe(25)
    expect(DEFAULT_CONFIG.max_cycles_per_goal).toBe(8)
    expect(DEFAULT_CONFIG.review_untracked).toBe(false)
    expect(DEFAULT_CONFIG.auto_promote_rules).toBe(false)
  })

  it('applies defaults when parsing an empty object', () => {
    expect(parseConfig({})).toEqual(DEFAULT_CONFIG)
  })

  it('rejects unknown keys (fail fast, I10)', () => {
    expect(() => parseConfig({ nope: true })).toThrow(/Invalid config\.yaml/)
  })

  it('rejects an invalid value type', () => {
    expect(() => parseConfig({ watch_interval_seconds: 'soon' })).toThrow(/Invalid config\.yaml/)
  })

  it('rejects a non-positive number', () => {
    expect(() => parseConfig({ watch_interval_seconds: 0 })).toThrow()
  })

  it('round-trips the documented default YAML body', () => {
    const parsed = parseYaml(defaultConfigYaml())
    expect(() => parseConfig(parsed)).not.toThrow()
    expect(parseConfig(parsed).diff_debounce_seconds).toBe(25)
  })

  it('accepts the same_hash_review_policy enum', () => {
    expect(ConfigSchema.parse({ same_hash_review_policy: 'always' }).same_hash_review_policy).toBe(
      'always',
    )
    expect(() => parseConfig({ same_hash_review_policy: 'maybe' })).toThrow()
  })
})
