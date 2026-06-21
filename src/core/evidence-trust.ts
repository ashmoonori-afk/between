import type { BetweenConfig } from './config-schema'

export function usesSimulatedEvidence(
  stateTrust: 'simulated' | 'real',
  config: Pick<BetweenConfig, 'developer_command' | 'reviewer_command'>,
): boolean {
  return (
    stateTrust === 'simulated' ||
    commandUsesFakeAgent(config.developer_command) ||
    commandUsesFakeAgent(config.reviewer_command)
  )
}

export function commandUsesFakeAgent(command: string): boolean {
  return /(?:^|\s|[\\/])fake-agent\.mjs(?:\s|$)/.test(command)
}
