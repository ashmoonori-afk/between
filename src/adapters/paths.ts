import { join } from 'node:path'
import { cycleName } from '../core/cycle'

/** All filesystem locations under a target repo's `.between/` directory. */
export interface BetweenPaths {
  root: string
  dir: string
  config: string
  state: string
  stateBak: string
  events: string
  owner: string
  lock: string
  snapshots: string
  signals: string
  acks: string
  reviews: string
  verify: string
  commands: string
  cycles: string
  agents: string
}

export function betweenPaths(root: string): BetweenPaths {
  const dir = join(root, '.between')
  return {
    root,
    dir,
    config: join(dir, 'config.yaml'),
    state: join(dir, 'state.json'),
    stateBak: join(dir, 'state.json.bak'),
    events: join(dir, 'events.jsonl'),
    owner: join(dir, 'owner.json'),
    lock: join(dir, 'broker.lock'),
    snapshots: join(dir, 'snapshots'),
    signals: join(dir, 'signals'),
    acks: join(dir, 'acks'),
    reviews: join(dir, 'reviews'),
    verify: join(dir, 'verify'),
    commands: join(dir, 'commands'),
    cycles: join(dir, 'cycles'),
    agents: join(dir, 'agents'),
  }
}

/** Directories created by `between init`. */
export function betweenSubdirs(p: BetweenPaths): string[] {
  return [
    p.dir,
    p.snapshots,
    p.signals,
    p.acks,
    p.reviews,
    p.verify,
    p.commands,
    p.cycles,
    p.agents,
  ]
}

export function agentScriptPath(p: BetweenPaths): string {
  return join(p.agents, 'fake-agent.mjs')
}

export function snapshotPath(p: BetweenPaths, cycle: number): string {
  return join(p.snapshots, `${cycleName(cycle)}.diff.gz`)
}

export function reviewPath(p: BetweenPaths, cycle: number): string {
  return join(p.reviews, `${cycleName(cycle)}.json`)
}

export function verifyPath(p: BetweenPaths, cycle: number): string {
  return join(p.verify, `${cycleName(cycle)}.json`)
}

export function signalPath(p: BetweenPaths, target: string): string {
  return join(p.signals, `${target}.json`)
}

export function ackPath(p: BetweenPaths, signalId: string): string {
  return join(p.acks, `${signalId}.json`)
}
