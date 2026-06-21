import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '../../src/core/clock'
import { initProject } from '../../src/adapters/init-project'
import { buildDaemon, loadConfig } from '../../src/runtime'
import { OneShotTransport } from '../../src/adapters/pty-transport'
import { CommandBus } from '../../src/adapters/command-bus'
import { buildSignal } from '../../src/adapters/signal-transport'
import { betweenPaths, ackPath } from '../../src/adapters/paths'
import { REVIEWER_WORKTREE } from '../../src/review/materialize'

let dir: string
const INTEGRATION_TIMEOUT_MS = 90_000

async function git(args: string[]): Promise<void> {
  await execa('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir })
}

async function waitFor(pred: () => boolean, timeoutMs = 10_000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return false
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-oneshot-'))
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
    // Windows can hold a handle briefly after a child exits — cleanup is best-effort
  }
})

describe('oneshot embed (real fake-agent drives the loop)', () => {
  it(
    'init bundles the fake-agent and a real invocation advances cycle 1 to human_gate',
    async () => {
      const fc = new FakeClock(Date.UTC(2026, 5, 19, 0, 0, 0))
      const res = await initProject(dir, {}, fc)
      // the bundled demo agent is written so the embed is self-contained
      expect(existsSync(join(dir, '.between', 'agents', 'fake-agent.mjs'))).toBe(true)
      // re-init is idempotent (no duplicate agent entry)
      const res2 = await initProject(dir, {}, fc)
      expect(res2.created).not.toContain(join(dir, '.between', 'agents', 'fake-agent.mjs'))
      expect(res.project.name).toBeTruthy()

      const config = await loadConfig(dir)
      const transport = new OneShotTransport(dir, {
        developerCommand: config.developer_command,
        reviewerCommand: config.reviewer_command,
        cwd: dir,
      })
      const d = await buildDaemon(dir, fc, transport)
      await d.load()

      const bus = new CommandBus(dir)
      await bus.submit({ kind: 'goal', goal: 'ship with a real agent' })
      await d.tick() // -> developing
      await writeFile(join(dir, 'app.txt'), 'v2 by the developer\n')
      await d.tick() // -> debouncing
      fc.advance(26_000)
      await d.tick() // -> review_requested + spawns `node .between/agents/fake-agent.mjs reviewer`
      expect(d.state.workflow.phase).toBe('review_requested')

      const hash = d.state.diff.hash!
      const id = buildSignal('reviewer', 1, hash, '', '').id
      const ackFile = ackPath(betweenPaths(dir), id)
      // the REAL fake-agent process writes the ack (+ review + verify) — wait for it
      expect(await waitFor(() => existsSync(ackFile))).toBe(true)

      await d.tick() // ack present -> reviewing
      expect(d.state.workflow.phase).toBe('reviewing')
      await d.tick() // review record present -> review_written
      await d.tick() // clean review + passing verify -> human_gate
      expect(d.state.workflow.phase).toBe('human_gate')
      expect(d.state.workflow.reviewed_hashes).toContain(hash)
    },
    INTEGRATION_TIMEOUT_MS,
  )

  it(
    'launches the reviewer in a sealed reviewer worktree with sandbox env',
    async () => {
      const fc = new FakeClock(Date.UTC(2026, 5, 19, 0, 0, 0))
      await initProject(dir, {}, fc)
      const reviewerScript = join(dir, 'capture-reviewer.mjs')
      await writeFile(
        reviewerScript,
        [
          "import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'",
          "import { join } from 'node:path'",
          "const role = 'reviewer'",
          'const root = process.env.BETWEEN_ROOT',
          "if (!root) throw new Error('BETWEEN_ROOT missing')",
          "const dir = join(root, '.between')",
          "const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'))",
          'const cycle = state.workflow.cycle',
          'const hash = state.diff.hash',
          "const id = role + '-' + String(cycle).padStart(4, '0') + '-' + String(hash).slice(0, 12)",
          "writeFileSync(join(dir, 'reviewer-cwd.txt'), process.cwd())",
          "writeFileSync(join(dir, 'reviewer-env.json'), JSON.stringify({",
          '  BETWEEN_SANDBOX_ROLE: process.env.BETWEEN_SANDBOX_ROLE,',
          '  BETWEEN_NETWORK_DISABLED: process.env.BETWEEN_NETWORK_DISABLED,',
          '  GIT_TERMINAL_PROMPT: process.env.GIT_TERMINAL_PROMPT,',
          '  BETWEEN_REVIEW_WORKTREE: process.env.BETWEEN_REVIEW_WORKTREE,',
          '}, null, 2))',
          "mkdirSync(join(dir, 'acks'), { recursive: true })",
          "mkdirSync(join(dir, 'reviews'), { recursive: true })",
          "mkdirSync(join(dir, 'verify'), { recursive: true })",
          "writeFileSync(join(dir, 'acks', id + '.json'), JSON.stringify({ signal_id: id, target: role, cycle, diff_hash: hash, acked_at: new Date().toISOString() }, null, 2))",
          "const name = 'cycle-' + String(cycle).padStart(4, '0')",
          "writeFileSync(join(dir, 'reviews', name + '.json'), JSON.stringify({ cycle, diff_hash: hash, findings: [], complete: true }, null, 2))",
          "writeFileSync(join(dir, 'verify', name + '.json'), JSON.stringify({ diff_hash: hash, passed: true, summary: 'sandbox reviewer ok' }, null, 2))",
          '',
        ].join('\n'),
        'utf8',
      )

      const config = await loadConfig(dir)
      const transport = new OneShotTransport(dir, {
        developerCommand: config.developer_command,
        reviewerCommand: `node ${reviewerScript} reviewer`,
        cwd: dir,
      })
      const d = await buildDaemon(dir, fc, transport)
      await d.load()

      await new CommandBus(dir).submit({ kind: 'goal', goal: 'review in sealed worktree' })
      await d.tick()
      await writeFile(join(dir, 'app.txt'), 'v2 by the developer\n')
      await d.tick()
      fc.advance(26_000)
      await d.tick()

      const hash = d.state.diff.hash!
      const id = buildSignal('reviewer', 1, hash, '', '').id
      expect(await waitFor(() => existsSync(ackPath(betweenPaths(dir), id)))).toBe(true)

      const reviewerCwd = await readFile(join(dir, '.between', 'reviewer-cwd.txt'), 'utf8')
      const expectedWorktree = join(dir, '.between', 'worktrees', REVIEWER_WORKTREE)
      expect(reviewerCwd).toBe(expectedWorktree)
      const env = JSON.parse(await readFile(join(dir, '.between', 'reviewer-env.json'), 'utf8'))
      expect(env).toMatchObject({
        BETWEEN_SANDBOX_ROLE: 'reviewer',
        BETWEEN_NETWORK_DISABLED: '1',
        GIT_TERMINAL_PROMPT: '0',
        BETWEEN_REVIEW_WORKTREE: expectedWorktree,
      })
    },
    INTEGRATION_TIMEOUT_MS,
  )
})
