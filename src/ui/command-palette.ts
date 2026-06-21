import type { Command } from '../adapters/command-bus'
import { CommandBus } from '../adapters/command-bus'
import type { BetweenState, Phase } from '../core/types'

export type DashboardCommandId = 'review_now' | 'interrupt' | 'pause' | 'resume' | 'stop'

export interface DashboardCommandItem {
  id: DashboardCommandId
  key: string
  label: string
  hint: string
  enabled: boolean
  command: Command
}

export interface DashboardCommandPaletteState {
  open: boolean
  selectedIndex: number
  lastMessage: string | null
}

const REVIEWABLE_PHASES = new Set<Phase>(['developing', 'applying_review', 'debouncing'])
const INTERRUPTIBLE_PHASES = new Set<Phase>([
  'goal_locked',
  'developing',
  'diff_detected',
  'debouncing',
  'review_requested',
  'reviewing',
  'review_written',
  'applying_review',
  'verifying',
  'human_gate',
  'repo_busy',
  'error',
])

export function buildDashboardCommandItems(state: BetweenState): DashboardCommandItem[] {
  const canReviewNow = REVIEWABLE_PHASES.has(state.workflow.phase) && Boolean(state.diff.hash)
  const paused = state.workflow.phase === 'paused'
  return [
    {
      id: 'review_now',
      key: 'r',
      label: 'review now',
      hint: canReviewNow ? 'queue reviewer signal' : 'needs active diff',
      enabled: canReviewNow,
      command: { kind: 'review_now' },
    },
    {
      id: 'interrupt',
      key: 'esc',
      label: 'abort agents',
      hint: 'abort agents + pause',
      enabled: INTERRUPTIBLE_PHASES.has(state.workflow.phase),
      command: { kind: 'interrupt' },
    },
    {
      id: paused ? 'resume' : 'pause',
      key: 'p',
      label: paused ? 'resume' : 'pause',
      hint: paused ? 'resume broker loop' : 'pause broker loop',
      enabled: true,
      command: { kind: paused ? 'resume' : 'pause' },
    },
    {
      id: 'stop',
      key: 's',
      label: 'stop broker',
      hint: 'request broker stop',
      enabled: true,
      command: { kind: 'stop' },
    },
  ]
}

export function commandItemForKey(
  items: readonly DashboardCommandItem[],
  input: string,
): DashboardCommandItem | null {
  const key = input.toLowerCase() === 'escape' ? 'esc' : input.toLowerCase()
  return items.find((item) => item.enabled && item.key === key) ?? null
}

export function clampCommandIndex(
  items: readonly DashboardCommandItem[],
  selectedIndex: number,
): number {
  if (items.length === 0) return 0
  const bounded = Math.min(Math.max(selectedIndex, 0), items.length - 1)
  if (items[bounded]?.enabled) return bounded
  return selectEnabledCommand(items, bounded, 1)
}

export function selectEnabledCommand(
  items: readonly DashboardCommandItem[],
  selectedIndex: number,
  direction: 1 | -1,
): number {
  if (items.length === 0) return 0
  for (let offset = 1; offset <= items.length; offset++) {
    const index = (selectedIndex + direction * offset + items.length) % items.length
    if (items[index]?.enabled) return index
  }
  return 0
}

export async function submitDashboardCommand(
  root: string,
  item: DashboardCommandItem,
): Promise<void> {
  if (!item.enabled) return
  await new CommandBus(root).submit(item.command)
}
