import type { AgentHost, AgentHostMap } from './agent-host'

export interface AgentControl {
  abortActive(reason: string): Promise<void>
  steerActive(goal: string): Promise<void>
}

export const NOOP_AGENT_CONTROL: AgentControl = {
  async abortActive() {},
  async steerActive() {},
}

export function createHostAgentControl(hosts: AgentHostMap): AgentControl {
  return {
    async abortActive(reason) {
      await Promise.all(activeHosts(hosts).map((host) => abortHost(host, reason)))
    },
    async steerActive(goal) {
      await Promise.all(activeHosts(hosts).map((host) => steerHost(host, goal)))
    },
  }
}

export function steerInstruction(goal: string): string {
  return `Between steer requested. New goal: ${goal}\n`
}

function activeHosts(hosts: AgentHostMap): AgentHost[] {
  return (['developer', 'reviewer'] as const)
    .map((role) => hosts[role])
    .filter((host): host is AgentHost => Boolean(host?.snapshot().alive))
}

async function abortHost(host: AgentHost, reason: string): Promise<void> {
  host.feed(`[between] abort requested: ${reason}\n`)
  await host.stop()
}

async function steerHost(host: AgentHost, goal: string): Promise<void> {
  host.feed(`[between] steer requested: ${goal}\n`)
  await host.deliver(steerInstruction(goal))
}
