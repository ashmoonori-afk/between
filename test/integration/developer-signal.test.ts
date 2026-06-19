import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '../../src/core/clock'
import { initProject } from '../../src/adapters/init-project'
import { buildDaemon } from '../../src/runtime'
import { CommandBus } from '../../src/adapters/command-bus'
import { AckStore } from '../../src/adapters/ack-store'
import { EventsLog } from '../../src/adapters/events-log'
import { buildSignal } from '../../src/adapters/signal-transport'
import { betweenPaths, reviewPath, signalPath } from '../../src/adapters/paths'
import type { Ack } from '../../src/core/types'

let dir: string

async function git(args: string[]): Promise<void> {
  await execa('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir })
}
async function ack(cycle: number, hash: string, fc: FakeClock): Promise<void> {
  const id = buildSignal('reviewer', cycle, hash, '', '').id
  const a: Ack = {
    signal_id: id,
    target: 'reviewer',
    cycle,
    diff_hash: hash,
    acked_at: fc.nowIso(),
  }
  await new AckStore(dir).write(a)
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-devsig-'))
  await git(['init', '-b', 'main'])
  await git(['config', 'user.email', 't@example.com'])
  await git(['config', 'user.name', 'Tester'])
  await writeFile(join(dir, 'app.txt'), 'v1\n')
  await git(['add', '-A'])
  await git(['commit', '-m', 'init'])
})
afterEach(async () => {
  try {
    await rm(dir, { recursive: true, force: true })
  } catch {
    /* best-effort on Windows */
  }
})

describe('blocking review -> developer signal (P1-1)', () => {
  it('sends a developer signal on blocking findings and the next developer diff opens cycle 2', async () => {
    const fc = new FakeClock(Date.UTC(2026, 5, 19, 0, 0, 0))
    await initProject(dir, {}, fc)
    const d = await buildDaemon(dir, fc)
    await d.load()
    const bus = new CommandBus(dir)
    const p = betweenPaths(dir)

    await bus.submit({ kind: 'goal', goal: 'g' })
    await d.tick() // developing
    await writeFile(join(dir, 'app.txt'), 'v2\n')
    await d.tick() // debouncing
    fc.advance(26_000)
    await d.tick() // review_requested, cycle 1
    const hash = d.state.diff.hash!
    await ack(1, hash, fc)
    await d.tick() // reviewing

    // reviewer writes a BLOCKING review (no passing verify)
    await writeFile(
      reviewPath(p, 1),
      JSON.stringify({
        cycle: 1,
        diff_hash: hash,
        findings: [{ id: 'f1', severity: 'blocking', summary: 'token leak', target_hash: hash }],
        complete: true,
      }),
    )
    await d.tick() // reviewing -> review_written
    expect(d.state.workflow.phase).toBe('review_written')
    await d.tick() // review_written -> sendDeveloperSignal -> applying_review

    expect(d.state.workflow.phase).toBe('applying_review')
    expect(existsSync(signalPath(p, 'developer'))).toBe(true)
    const sig = JSON.parse(readFileSync(signalPath(p, 'developer'), 'utf8'))
    expect(sig.target).toBe('developer')
    expect(sig.cycle).toBe(1)
    expect(sig.diff_hash).toBe(hash)
    expect(sig.id).toBe(buildSignal('developer', 1, hash, '', '').id)
    // a blocking (not yet passing) hash is NOT committed as reviewed
    expect(d.state.workflow.reviewed_hashes).not.toContain(hash)
    const events = (await new EventsLog(dir).read()).filter((e) => e.event === 'signal_sent')
    expect(events.some((e) => e.target === 'developer')).toBe(true)

    // no developer ACK is required: the developer's next change opens cycle 2 (no deadlock)
    await writeFile(join(dir, 'app.txt'), 'v3 fixed the leak\n')
    await d.tick() // debouncing
    fc.advance(26_000)
    await d.tick() // review_requested, cycle 2
    expect(d.state.workflow.phase).toBe('review_requested')
    expect(d.state.workflow.cycle).toBe(2)
    expect(existsSync(signalPath(p, 'reviewer'))).toBe(true)
  }, 30_000)
})
