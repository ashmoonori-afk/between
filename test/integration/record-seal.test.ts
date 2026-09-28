import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '../../src/core/clock'
import { initProject } from '../../src/adapters/init-project'
import { buildDaemon } from '../../src/runtime'
import { CommandBus } from '../../src/adapters/command-bus'
import { AckStore } from '../../src/adapters/ack-store'
import { EventsLog } from '../../src/adapters/events-log'
import { buildSignal } from '../../src/adapters/signal-transport'
import { APPROVAL_SECRET_ENV } from '../../src/adapters/approval-secret'
import { collectEvidence } from '../../src/evidence/collect'
import { betweenPaths, reviewPath, verifyPath } from '../../src/adapters/paths'
import {
  RECORD_SEALED_EVENT,
  RecordIntegrityError,
  readRecordBytes,
} from '../../src/review/record-seal'
import { CLAUDE_AGENT_SOURCE, CODEX_AGENT_SOURCE } from '../../src/agents/real-agents'

type Daemon = Awaited<ReturnType<typeof buildDaemon>>

let dir: string
const TIMEOUT_MS = 90_000
const priorSecret = process.env[APPROVAL_SECRET_ENV]

async function git(args: string[]): Promise<void> {
  await execa('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir })
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

async function reachReviewing(): Promise<{ d: Daemon; fc: FakeClock; hash: string }> {
  const fc = new FakeClock(Date.UTC(2026, 8, 28, 0, 0, 0))
  await initProject(dir, { developer: 'claude', reviewer: 'codex' }, fc)
  const d = await buildDaemon(dir, fc)
  await d.load()
  await new CommandBus(dir).submit({ kind: 'goal', goal: 'seal review records' })
  await d.tick()
  await writeFile(join(dir, 'app.txt'), 'v2\n')
  await d.tick()
  fc.advance(26_000)
  await d.tick()
  const hash = d.state.diff.hash!
  const id = buildSignal('reviewer', 1, hash, '', '').id
  await new AckStore(dir).write({
    signal_id: id,
    target: 'reviewer',
    cycle: 1,
    diff_hash: hash,
    acked_at: fc.nowIso(),
  })
  await d.tick()
  expect(d.state.workflow.phase).toBe('reviewing')
  return { d, fc, hash }
}

function reviewJson(hash: string, summary = 'clean'): string {
  return JSON.stringify({
    cycle: 1,
    diff_hash: hash,
    findings: [{ id: 'f1', severity: 'non-blocking', summary, target_hash: hash }],
    complete: true,
  })
}

async function sealedEvents(): Promise<Array<Record<string, unknown>>> {
  return (await new EventsLog(dir).read())
    .filter((e) => e.event === RECORD_SEALED_EVENT)
    .map((e) => e.detail ?? {})
}

async function overwrite(path: string, text: string): Promise<void> {
  await chmod(path, 0o644)
  await writeFile(path, text)
}

beforeEach(async () => {
  process.env[APPROVAL_SECRET_ENV] = 'record-seal-secret'
  dir = await mkdtemp(join(tmpdir(), 'between-seal-'))
  await git(['init', '-b', 'main'])
  await git(['config', 'user.email', 't@example.com'])
  await git(['config', 'user.name', 'Tester'])
  await writeFile(join(dir, 'app.txt'), 'v1\n')
  await git(['add', '-A'])
  await git(['commit', '-m', 'init'])
})

afterEach(async () => {
  if (priorSecret === undefined) delete process.env[APPROVAL_SECRET_ENV]
  else process.env[APPROVAL_SECRET_ENV] = priorSecret
  try {
    await rm(dir, { recursive: true, force: true })
  } catch {
    // Windows can hold a handle briefly after a git child exits; cleanup is best-effort
  }
})

describe('review/verify record sealing', () => {
  it(
    'seals accepted records (read-only + journal hash) and a normal cycle still completes',
    async () => {
      const { d, hash } = await reachReviewing()
      const p = betweenPaths(dir)
      const review = reviewJson(hash)
      const verify = JSON.stringify({ diff_hash: hash, passed: true, summary: 'ok' })
      await writeFile(reviewPath(p, 1), review)
      await writeFile(verifyPath(p, 1), verify)
      await d.tick()
      expect(d.state.workflow.phase).toBe('review_written')
      await d.tick()
      expect(d.state.workflow.phase).toBe('human_gate')

      expect(await sealedEvents()).toEqual([
        { record: 'review', sha256: sha256(review), path: '.between/reviews/cycle-0001.json' },
        { record: 'verify', sha256: sha256(verify), path: '.between/verify/cycle-0001.json' },
      ])
      for (const path of [reviewPath(p, 1), verifyPath(p, 1)]) {
        expect((await stat(path)).mode & 0o222).toBe(0)
      }
      expect((await new EventsLog(dir).verify()).valid).toBe(true)
      const ev = await collectEvidence(dir, '2026-09-28T00:00:00.000Z')
      expect(ev?.findings.items.map((f) => f.summary)).toEqual(['clean'])
      expect(ev?.verify?.passed).toBe(true)
    },
    TIMEOUT_MS,
  )

  it(
    'a reviewer may still rewrite its record BEFORE the broker accepts it',
    async () => {
      const { d, hash } = await reachReviewing()
      const p = betweenPaths(dir)
      await writeFile(reviewPath(p, 1), '{"partial":')
      await d.tick()
      expect(d.state.workflow.phase).toBe('reviewing')
      expect(await sealedEvents()).toEqual([])
      await writeFile(reviewPath(p, 1), reviewJson(hash))
      await d.tick()
      expect(d.state.workflow.phase).toBe('review_written')
    },
    TIMEOUT_MS,
  )

  const tampers: Array<{ name: string; run: (path: string, hash: string) => Promise<void> }> = [
    {
      name: 'overwrite in place',
      run: (path, hash) => overwrite(path, reviewJson(hash, 'looks fine, ship it')),
    },
    {
      name: 'atomic replace via rename',
      run: async (path, hash) => {
        await chmod(path, 0o644) // Windows refuses to rename over a read-only file
        await writeFile(`${path}.tmp`, reviewJson(hash, 'replaced'))
        await rename(`${path}.tmp`, path)
      },
    },
    {
      name: 'delete and recreate',
      run: async (path, hash) => {
        await rm(path, { force: true })
        await writeFile(path, reviewJson(hash, 'recreated'))
      },
    },
    { name: 'delete', run: (path) => rm(path, { force: true }) },
  ]

  for (const tamper of tampers) {
    it(
      `fails the cycle closed on a sealed review: ${tamper.name}`,
      async () => {
        const { d, hash } = await reachReviewing()
        const path = reviewPath(betweenPaths(dir), 1)
        await writeFile(path, reviewJson(hash))
        await d.tick()
        await d.tick() // clean review, verify still missing: waits in review_written
        expect(d.state.workflow.phase).toBe('review_written')

        await tamper.run(path, hash)
        await d.tick()
        expect(d.state.workflow.phase).toBe('error')
        expect(d.state.workflow.error?.code).toBe('record_tampered')
        expect(d.state.workflow.error?.recoverable).toBe(false)
        await expect(collectEvidence(dir, '2026-09-28T00:00:00.000Z')).rejects.toBeInstanceOf(
          RecordIntegrityError,
        )
      },
      TIMEOUT_MS,
    )
  }

  it.skipIf(process.platform === 'win32')(
    'refuses a sealed review swapped for a symlink to identical bytes',
    async () => {
      const { d, hash } = await reachReviewing()
      const path = reviewPath(betweenPaths(dir), 1)
      await writeFile(path, reviewJson(hash))
      await d.tick()
      await d.tick()
      const copy = join(dir, 'review-copy.json')
      await writeFile(copy, await readFile(path))
      await rm(path, { force: true })
      await symlink(copy, path)
      expect((await readRecordBytes(path)).status).toBe('not_regular')

      await d.tick()
      expect(d.state.workflow.error?.code).toBe('record_tampered')
    },
    TIMEOUT_MS,
  )

  it(
    'refuses evidence built from a sealed failed verify that was flipped to passed',
    async () => {
      const { d, hash } = await reachReviewing()
      const p = betweenPaths(dir)
      await writeFile(reviewPath(p, 1), reviewJson(hash))
      await writeFile(
        verifyPath(p, 1),
        JSON.stringify({ diff_hash: hash, passed: false, summary: 'tests fail' }),
      )
      // a failed verify sends the cycle back to developing; forge a passing one instead
      await d.tick()
      await d.tick()
      expect(d.state.workflow.phase).toBe('developing')
      await overwrite(
        verifyPath(p, 1),
        JSON.stringify({ diff_hash: hash, passed: true, summary: 'ok' }),
      )
      await expect(collectEvidence(dir, '2026-09-28T00:00:00.000Z')).rejects.toThrow(
        /verify record for cycle 1 failed integrity check: content changed/,
      )
    },
    TIMEOUT_MS,
  )

  it(
    'does not trust a seal from a journal whose chain was edited',
    async () => {
      const { d, hash } = await reachReviewing()
      const p = betweenPaths(dir)
      await writeFile(reviewPath(p, 1), reviewJson(hash))
      await d.tick()
      const log = p.events
      const lines = (await readFile(log, 'utf8')).split('\n').filter(Boolean)
      // drop the seal entry so the record would look unsealed (and freely rewritable)
      await writeFile(
        log,
        lines.filter((l) => !l.includes(`"event":"${RECORD_SEALED_EVENT}"`)).join('\n') + '\n',
      )
      await overwrite(reviewPath(p, 1), reviewJson(hash, 'forged'))
      await expect(collectEvidence(dir, '2026-09-28T00:00:00.000Z')).rejects.toThrow(
        /journal integrity check failed/,
      )
    },
    TIMEOUT_MS,
  )
})

describe('developer write access to review records', () => {
  it('the claude wrapper denies developer edits under .between/reviews and .between/verify', () => {
    expect(CLAUDE_AGENT_SOURCE).toContain(
      `if (role === 'developer') args.push(...["--disallowedTools","Edit(/.between/reviews/**)","Edit(/.between/verify/**)"])`,
    )
    expect(CODEX_AGENT_SOURCE).not.toContain('--disallowedTools')
  })
})
