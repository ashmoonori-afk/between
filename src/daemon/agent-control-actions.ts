import type { DaemonContext } from './context'

export async function abortActiveAgents(ctx: DaemonContext, reason: string): Promise<void> {
  try {
    await ctx.deps.agentControl.abortActive(reason)
  } catch (e) {
    await ctx.emit('agent_control_failed', {
      detail: { action: 'abort', reason, message: errorMessage(e) },
    })
  }
}

export async function steerActiveAgents(ctx: DaemonContext, goal: string): Promise<void> {
  try {
    await ctx.deps.agentControl.steerActive(goal)
  } catch (e) {
    await ctx.emit('agent_control_failed', {
      detail: { action: 'steer', message: errorMessage(e) },
    })
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
