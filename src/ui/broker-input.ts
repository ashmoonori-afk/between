import type { Command } from '../adapters/command-bus'
import type { BetweenState } from '../core/types'

export type BrokerInputAction =
  | { readonly kind: 'submit'; readonly label: string; readonly command: Command }
  | { readonly kind: 'quit' }
  | { readonly kind: 'noop'; readonly message: string }

export function parseBrokerInput(value: string, state: BetweenState): BrokerInputAction {
  const text = value.trim()
  if (text.length === 0) return { kind: 'noop', message: 'empty input' }

  const normalized = text.startsWith('/') ? text.slice(1).trim() : text
  const [verb, ...rest] = normalized.split(/\s+/u)
  const arg = rest.join(' ').trim()
  const key = verb?.toLowerCase() ?? ''

  switch (key) {
    case 'goal':
      return arg.length > 0
        ? { kind: 'submit', label: 'goal queued', command: { kind: 'goal', goal: arg } }
        : { kind: 'noop', message: 'usage: goal <text>' }
    case 'steer':
      return arg.length > 0
        ? { kind: 'submit', label: 'steer queued', command: { kind: 'steer_goal', goal: arg } }
        : { kind: 'noop', message: 'usage: steer <text>' }
    case 'review':
    case 'review-now':
      return { kind: 'submit', label: 'review queued', command: { kind: 'review_now' } }
    case 'abort':
    case 'interrupt':
      return { kind: 'submit', label: 'abort queued', command: { kind: 'interrupt' } }
    case 'pause':
      return { kind: 'submit', label: 'pause queued', command: { kind: 'pause' } }
    case 'resume':
      return { kind: 'submit', label: 'resume queued', command: { kind: 'resume' } }
    case 'stop':
      return { kind: 'submit', label: 'stop queued', command: { kind: 'stop' } }
    case 'quit':
    case 'q':
      return { kind: 'quit' }
    default:
      return state.workflow.phase === 'idle' || state.workflow.phase === 'done'
        ? { kind: 'submit', label: 'goal queued', command: { kind: 'goal', goal: text } }
        : { kind: 'submit', label: 'steer queued', command: { kind: 'steer_goal', goal: text } }
  }
}
