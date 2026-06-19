import { describe, it, expect } from 'vitest'
import {
  APPROVAL_SCOPES,
  AGENT_PRESETS,
  GATEWAY_CHANNELS,
  PRESET_SCRIPT,
} from '../../src/core/constants'
import { parseConfig } from '../../src/core/config-schema'

describe('shared constants stay in sync with the config schema', () => {
  it('every GATEWAY_CHANNELS value is a valid gateway_channel', () => {
    for (const channel of GATEWAY_CHANNELS) {
      expect(parseConfig({ gateway_channel: channel }).gateway_channel).toBe(channel)
    }
    // a value outside the set must be rejected (guards drift)
    expect(() => parseConfig({ gateway_channel: 'sms' })).toThrow()
  })

  it('PRESET_SCRIPT covers exactly the AGENT_PRESETS', () => {
    expect(Object.keys(PRESET_SCRIPT).sort()).toEqual([...AGENT_PRESETS].sort())
    for (const preset of AGENT_PRESETS) {
      expect(PRESET_SCRIPT[preset]).toMatch(/-agent\.mjs$/)
    }
  })

  it('APPROVAL_SCOPES are the three human-gated actions', () => {
    expect(APPROVAL_SCOPES).toEqual(['merge', 'deploy', 'promote_rule'])
  })
})
