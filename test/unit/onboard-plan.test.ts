import { describe, it, expect } from 'vitest'
import { planOnboarding, setYamlScalar, applyConfigPatch, TOKEN_ENV } from '../../src/onboard/plan'

describe('planOnboarding', () => {
  it('echo channel needs no token, no smoke, no warnings', () => {
    const plan = planOnboarding({ channel: 'echo', agent: 'fake', hasTokenEnv: false })
    expect(plan.configPatch).toEqual([['gateway_channel', 'echo']])
    expect(plan.envVarNeeded).toBeNull()
    expect(plan.smoke).toBeNull()
    expect(plan.warnings).toEqual([])
  })

  it('telegram persists chat id (not the token) and asks for the env var', () => {
    const plan = planOnboarding({
      channel: 'telegram',
      agent: 'fake',
      chatId: '1170346056',
      hasTokenEnv: false,
    })
    expect(plan.configPatch).toContainEqual(['gateway_channel', 'telegram'])
    expect(plan.configPatch).toContainEqual(['telegram_chat_id', '"1170346056"'])
    // the token itself must never appear in the config patch
    expect(JSON.stringify(plan.configPatch)).not.toMatch(/token/i)
    expect(plan.envVarNeeded).toBe('BETWEEN_TELEGRAM_TOKEN')
    expect(plan.smoke).toBe('telegram')
    expect(plan.warnings.join(' ')).toMatch(/BETWEEN_TELEGRAM_TOKEN/)
  })

  it('discord with token already in env -> no warning, still smokes', () => {
    const plan = planOnboarding({
      channel: 'discord',
      agent: 'fake',
      chatId: '42',
      hasTokenEnv: true,
    })
    expect(plan.configPatch).toContainEqual(['discord_channel_id', '"42"'])
    expect(plan.envVarNeeded).toBe('BETWEEN_DISCORD_TOKEN')
    expect(plan.smoke).toBe('discord')
    expect(plan.warnings).toEqual([])
  })

  it('non-fake agent switches to oneshot mode with preset commands', () => {
    const plan = planOnboarding({ channel: 'echo', agent: 'claude', hasTokenEnv: false })
    expect(plan.configPatch).toContainEqual(['agent_mode', 'oneshot'])
    expect(plan.configPatch).toContainEqual([
      'developer_command',
      '"node .between/agents/claude-agent.mjs developer"',
    ])
  })

  it('TOKEN_ENV maps live channels to env var names', () => {
    expect(TOKEN_ENV.telegram).toBe('BETWEEN_TELEGRAM_TOKEN')
    expect(TOKEN_ENV.discord).toBe('BETWEEN_DISCORD_TOKEN')
  })
})

describe('setYamlScalar', () => {
  it('replaces a value but preserves the trailing comment', () => {
    const out = setYamlScalar(
      'gateway_channel: echo            # echo | telegram | discord',
      'gateway_channel',
      'telegram',
    )
    expect(out).toBe('gateway_channel: telegram            # echo | telegram | discord')
  })

  it('replaces without a comment', () => {
    expect(setYamlScalar('vault_path: ', 'vault_path', '"/tmp/v"')).toBe('vault_path: "/tmp/v"')
  })

  it('appends the key when absent', () => {
    expect(setYamlScalar('a: 1\n', 'b', '2')).toBe('a: 1\nb: 2\n')
  })

  it('only touches the matched key', () => {
    const text = 'telegram_chat_id: ""\ndiscord_channel_id: ""'
    const out = setYamlScalar(text, 'telegram_chat_id', '"5"')
    expect(out).toBe('telegram_chat_id: "5"\ndiscord_channel_id: ""')
  })

  it('escapes regex metacharacters in the key (no false matches)', () => {
    // a dotted key must match literally, not as a regex wildcard
    const text = 'vaultXpath: old\nvault.path: keep\n'
    const out = setYamlScalar(text, 'vault.path', 'new')
    expect(out).toBe('vaultXpath: old\nvault.path: new\n')
  })
})

describe('applyConfigPatch', () => {
  it('applies an ordered patch over a yaml body', () => {
    const body = 'gateway_channel: echo\ntelegram_chat_id: ""\n'
    const out = applyConfigPatch(body, [
      ['gateway_channel', 'telegram'],
      ['telegram_chat_id', '"7"'],
    ])
    expect(out).toBe('gateway_channel: telegram\ntelegram_chat_id: "7"\n')
  })
})
