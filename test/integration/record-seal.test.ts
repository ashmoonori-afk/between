import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeClock } from '../../src/core/clock'
import { initProject } from '../../src/adapters/init-project'
import { buildDaemon } from '../../src/runtime'
import { CommandBus } from '../../src/adapters/command-bus'
import { AckStore } from '../../src/adapters/ack-store'
import { EventsLog } from '../../src/adapters/events-log'
import { buildSignal } from '../../src/adapters/signal-transport'
import { APPROVAL_SECRET_ENV, resolveApprovalSecret } from '../../src/adapters/approval-secret'
import { signApproval, approvalExpiry } from '../../src/core/approval'
import { StateRepository } from '../../src/adapters/state-repository'
import {
  absoluteRecordDenyRules,
  claudeAbsolutePath,
  resolveAgentCommandPaths,
  withDeveloperDenyRules,
} from '../../src/adapters/agent-execution'
import { FAKE_AGENT_SOURCE } from '../../src/agents/fake-agent'
import { realpathSync } from 'node:fs'
import { LEGACY_SHA256, upgradePristineAgentScripts } from '../../src/agents/generated-scripts'
import { toApiError } from '../../src/api/errors'
import { collectEvidence } from '../../src/evidence/collect'
import { betweenPaths, reviewPath, verifyPath } from '../../src/adapters/paths'
import {
  RECORD_SEALED_EVENT,
  RecordIntegrityError,
  findRecordSeal,
  makeRecordReadOnly,
  readRecordBytes,
  sealMac,
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

      const secret = resolveApprovalSecret(dir)
      expect(await sealedEvents()).toEqual([
        {
          record: 'review',
          sha256: sha256(review),
          path: '.between/reviews/cycle-0001.json',
          mac: sealMac(secret, 'review', 1, sha256(review)),
        },
        {
          record: 'verify',
          sha256: sha256(verify),
          path: '.between/verify/cycle-0001.json',
          mac: sealMac(secret, 'verify', 1, sha256(verify)),
        },
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

  it('reads and seals an ordinary regular record', async () => {
    const path = join(dir, 'record.json')
    const raw = JSON.stringify({ cycle: 1, diff_hash: 'a'.repeat(64) })
    await writeFile(path, raw)
    try {
      expect(await readRecordBytes(path)).toEqual({ status: 'ok', raw, sha256: sha256(raw) })
      expect(await makeRecordReadOnly(path, sha256(raw))).toBe(true)
    } finally {
      await chmod(path, 0o644).catch(() => {})
    }
  })

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

  it(
    'refuses a sealed review swapped for a symlink to identical bytes',
    async (ctx) => {
      const { d, hash } = await reachReviewing()
      const path = reviewPath(betweenPaths(dir), 1)
      await writeFile(path, reviewJson(hash))
      await d.tick()
      await d.tick()
      const copy = join(dir, 'review-copy.json')
      await writeFile(copy, await readFile(path))
      await rm(path, { force: true })
      try {
        await symlink(copy, path, 'file')
      } catch (e) {
        // Windows without Developer Mode / admin cannot create symlinks at all
        if ((e as NodeJS.ErrnoException).code === 'EPERM') ctx.skip()
        throw e
      }
      expect((await readRecordBytes(path)).status).toBe('not_regular')

      await d.tick()
      expect(d.state.workflow.error?.code).toBe('record_tampered')
    },
    TIMEOUT_MS,
  )

  it.skipIf(process.platform === 'win32')(
    'refuses a sealed review swapped for a FIFO without blocking',
    async () => {
      const { d, hash } = await reachReviewing()
      const path = reviewPath(betweenPaths(dir), 1)
      await writeFile(path, reviewJson(hash))
      await d.tick()
      await d.tick()
      await rm(path, { force: true })
      await execa('mkfifo', [path])
      expect((await readRecordBytes(path)).status).toBe('not_regular')

      await d.tick()
      expect(d.state.workflow.error?.code).toBe('record_tampered')
    },
    TIMEOUT_MS,
  )

  it(
    'ignores a well-chained forged seal appended after the pinned head',
    async () => {
      const { d, hash } = await reachReviewing()
      const path = reviewPath(betweenPaths(dir), 1)
      await writeFile(path, reviewJson(hash))
      await d.tick()
      await d.tick()
      const forged = reviewJson(hash, 'forged but resealed')
      await overwrite(path, forged)
      await new EventsLog(dir).append({
        ts: '2026-09-28T00:00:00.000Z',
        cycle: 1,
        phase: 'review_written',
        event: RECORD_SEALED_EVENT,
        detail: { record: 'review', sha256: sha256(forged) },
      })
      await expect(collectEvidence(dir, '2026-09-28T00:00:00.000Z')).rejects.toThrow(
        /content changed after it was sealed/,
      )
      await d.tick()
      expect(d.state.workflow.error?.code).toBe('record_tampered')
    },
    TIMEOUT_MS,
  )

  it(
    'rejects an unauthenticated seal even when the state pin is moved over it',
    async () => {
      const { d, hash } = await reachReviewing()
      const path = reviewPath(betweenPaths(dir), 1)
      await writeFile(path, reviewJson(hash))
      await d.tick()
      await d.tick()
      const forged = reviewJson(hash, 'forged and pinned')
      await overwrite(path, forged)
      const log = new EventsLog(dir)
      await log.append({
        ts: '2026-09-28T00:00:00.000Z',
        cycle: 1,
        phase: 'review_written',
        event: RECORD_SEALED_EVENT,
        detail: { record: 'review', sha256: sha256(forged) },
      })
      const repo = new StateRepository(dir)
      await repo.write({ ...(await repo.read())!, journal: log.head() })
      await expect(collectEvidence(dir, '2026-09-28T00:00:00.000Z')).rejects.toThrow(
        /journal seal is not authenticated/,
      )
      const events = await log.read()
      expect(() => findRecordSeal(events, 'review', 1, resolveApprovalSecret(dir))).toThrow(
        /journal seal is not authenticated/,
      )
    },
    TIMEOUT_MS,
  )

  it(
    'refuses a non-merge approval over a tampered sealed record',
    async () => {
      const { d, hash } = await reachReviewing()
      const p = betweenPaths(dir)
      await writeFile(reviewPath(p, 1), reviewJson(hash))
      await writeFile(verifyPath(p, 1), JSON.stringify({ diff_hash: hash, passed: true }))
      await d.tick()
      await d.tick()
      expect(d.state.workflow.phase).toBe('human_gate')
      await overwrite(verifyPath(p, 1), JSON.stringify({ diff_hash: hash, passed: true, x: 1 }))

      const st = d.state
      const expiresAt = approvalExpiry(Date.now())
      await new CommandBus(dir).submit({
        kind: 'approve',
        scope: 'promote_rule',
        sig: signApproval(resolveApprovalSecret(dir), {
          scope: 'promote_rule',
          diff_hash: st.diff.hash,
          cycle: st.workflow.cycle,
          bundle_id: st.diff.bundle_id,
          expires_at: expiresAt,
        }),
        bundle_id: st.diff.bundle_id,
        expires_at: expiresAt,
      })
      await d.tick()
      expect(d.state.approval).toBeNull()
      const rejected = (await new EventsLog(dir).read()).find(
        (e) => e.event === 'approval_rejected',
      )
      expect(String(rejected?.detail?.reason)).toMatch(/verify record for cycle 1/)
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

  it(
    'the running daemon still catches a journal rebuilt without its seals and re-pinned on disk',
    async () => {
      const { d, hash } = await reachReviewing()
      const p = betweenPaths(dir)
      await writeFile(reviewPath(p, 1), reviewJson(hash))
      await d.tick()
      await d.tick()
      expect(d.state.workflow.phase).toBe('review_written')

      // rebuild a perfectly chained journal that simply never sealed anything
      const kept = (await new EventsLog(dir).read()).filter((e) => e.event !== RECORD_SEALED_EVENT)
      await rm(p.events)
      const rebuilt = new EventsLog(dir)
      for (const e of kept) {
        const {
          v: _v,
          seq: _s,
          prev_hash: _p,
          hash: _h,
          ...rest
        } = e as unknown as Record<string, unknown>
        await rebuilt.append(rest as never)
      }
      expect((await rebuilt.verify()).valid).toBe(true)
      await overwrite(reviewPath(p, 1), reviewJson(hash, 'forged after unsealing'))
      const repo = new StateRepository(dir)
      const st = (await repo.read())!

      await repo.write({ ...st, journal: rebuilt.head() })

      // the daemon's pin lives in memory, so the rewritten journal no longer matches it
      await d.tick()
      expect(d.state.workflow.phase).toBe('error')
      expect(d.state.workflow.error?.code).toBe('record_tampered')
      expect(d.state.workflow.error?.message).toMatch(/journal integrity check failed/)
    },
    TIMEOUT_MS,
  )
})

describe('restarted daemon and sealing races', () => {
  it(
    'a restarted daemon does not adopt a forged suffix appended after it loaded (no secret)',
    async () => {
      const { d, hash } = await reachReviewing()
      const path = reviewPath(betweenPaths(dir), 1)
      await writeFile(path, reviewJson(hash))
      await d.tick()
      await d.tick()
      delete process.env[APPROVAL_SECRET_ENV]
      const fc = new FakeClock(Date.UTC(2026, 8, 28, 1, 0, 0))
      const restarted = await buildDaemon(dir, fc)
      await restarted.load()
      expect(restarted.state.workflow.phase).toBe('review_written')

      const forged = reviewJson(hash, 'forged after restart')
      await overwrite(path, forged)
      await new EventsLog(dir).append({
        ts: fc.nowIso(),
        cycle: 1,
        phase: 'review_written',
        event: RECORD_SEALED_EVENT,
        detail: { record: 'review', sha256: sha256(forged) },
      })
      // any broker event before the next record read (here: a refused stale command)
      await new CommandBus(dir).submit({
        kind: 'finding_action',
        action: 'accept',
        finding_id: 'f1',
        cycle: 99,
        diff_hash: 'stale',
      })
      await restarted.tick()
      expect(restarted.state.workflow.phase).toBe('error')
      expect(restarted.state.workflow.error?.code).toBe('record_tampered')
    },
    TIMEOUT_MS,
  )

  it('never makes the target of a swapped-in symlink read-only', async (ctx) => {
    const target = join(dir, 'unrelated.txt')
    await writeFile(target, 'unrelated')
    await chmod(target, 0o644)
    const link = join(dir, 'record.json')
    try {
      await symlink(target, link, 'file')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EPERM') ctx.skip()
      throw e
    }
    expect(await makeRecordReadOnly(link, sha256('unrelated'))).toBe(false)
    expect((await stat(target)).mode & 0o200).not.toBe(0)
  })

  it('does not seal a record whose bytes changed after they were read', async () => {
    const file = join(dir, 'record.json')
    await writeFile(file, 'v2')
    expect(await makeRecordReadOnly(file, sha256('v1'))).toBe(false)
    expect((await stat(file)).mode & 0o200).not.toBe(0)
    expect(await makeRecordReadOnly(file, sha256('v2'))).toBe(true)
    expect((await stat(file)).mode & 0o222).toBe(0)
  })
})

describe('bundled fake agent', () => {
  const hash = 'e'.repeat(64)
  const malformed: Array<[string, unknown]> = [
    ['missing fields', { diff_hash: hash }],
    ['a malformed finding', { cycle: 1, diff_hash: hash, findings: [{}], complete: true }],
    [
      'a finding for another hash',
      {
        cycle: 1,
        diff_hash: hash,
        findings: [{ id: 'f', severity: 'blocking', summary: 's', target_hash: 'old' }],
        complete: true,
      },
    ],
    [
      'a non-string agent',
      {
        cycle: 1,
        diff_hash: hash,
        findings: [{ id: 'f', severity: 'blocking', summary: 's', target_hash: hash, agent: 7 }],
        complete: true,
      },
    ],
  ]
  for (const [name, stale] of malformed) {
    it(`replaces a schema-invalid record (${name}) instead of keeping it`, async () => {
      const between = join(dir, '.between')
      await mkdir(join(between, 'reviews'), { recursive: true })
      await writeFile(
        join(between, 'state.json'),
        JSON.stringify({ workflow: { cycle: 1 }, diff: { hash } }),
      )
      await writeFile(join(between, 'reviews', 'cycle-0001.json'), JSON.stringify(stale))
      const script = join(dir, 'fake-agent.mjs')
      await writeFile(script, FAKE_AGENT_SOURCE)
      await execa('node', [script, 'reviewer'], { input: '', env: { BETWEEN_ROOT: dir } })
      const review = JSON.parse(await readFile(join(between, 'reviews', 'cycle-0001.json'), 'utf8'))
      expect(review).toEqual({ cycle: 1, diff_hash: hash, findings: [], complete: true })
    })
  }
})

describe('developer write access to review records', () => {
  it('the claude wrapper denies developer edits under .between/reviews and .between/verify', () => {
    expect(CLAUDE_AGENT_SOURCE).toContain(
      `if (role === 'developer') args.push(...["--disallowedTools","Edit(/.between/reviews/**)","Edit(/.between/verify/**)"])`,
    )
    expect(CODEX_AGENT_SOURCE).not.toContain('--disallowedTools')
  })

  it('adds absolute deny rules when the developer command is the Claude CLI itself', () => {
    const rules = absoluteRecordDenyRules(dir)
    const abs = claudeAbsolutePath(realpathSync.native(dir))
    expect(rules).toContain(`Edit(/${abs}/.between/reviews/**)`)
    expect(rules).toContain(`Edit(/${abs}/.between/verify/**)`)
    expect(rules.every((r) => r.startsWith('Edit(//'))).toBe(true)
    expect(resolveAgentCommandPaths(dir, { file: 'claude', args: [] }, 'developer').args).toEqual([
      '--disallowedTools',
      ...rules,
    ])
    expect(withDeveloperDenyRules('C:\\npm\\claude.cmd', ['--model', 'x'], dir)).toEqual([
      '--model',
      'x',
      '--disallowedTools',
      ...rules,
    ])
    expect(resolveAgentCommandPaths(dir, { file: 'claude', args: [] }, 'reviewer').args).toEqual([])
    expect(withDeveloperDenyRules('node', ['.between/agents/claude-agent.mjs'], dir)).toEqual([
      '.between/agents/claude-agent.mjs',
    ])
  })

  it('merges the rules into an existing --disallowedTools list', () => {
    const rules = absoluteRecordDenyRules(dir)
    expect(
      withDeveloperDenyRules('claude', ['--disallowedTools', 'Bash', '--model', 'x'], dir),
    ).toEqual(['--disallowedTools', ...rules, 'Bash', '--model', 'x'])
    expect(withDeveloperDenyRules('claude', ['--disallowed-tools', 'Bash'], dir)).toEqual([
      '--disallowed-tools',
      ...rules,
      'Bash',
    ])
  })

  it('writes Windows paths in the POSIX form Claude matches and escapes glob characters', () => {
    expect(claudeAbsolutePath('C:\\Users\\me\\repo')).toBe('/c/Users/me/repo')
    expect(claudeAbsolutePath('/home/me/re[po]*')).toBe('/home/me/re\\[po\\]\\*')
  })

  it('upgrades a pristine older generated wrapper and keeps a customized one', async () => {
    const agents = join(dir, 'agents')
    await mkdir(agents)
    const legacy = '// older generated wrapper\n'
    await writeFile(join(agents, 'claude-agent.mjs'), legacy)
    await writeFile(join(agents, 'codex-agent.mjs'), '// customized by the user\n')
    const upgraded = await upgradePristineAgentScripts(agents, {
      'claude-agent.mjs': [sha256(legacy)],
      'codex-agent.mjs': [sha256('// the stock text\n')],
    })
    expect(upgraded).toEqual([join(agents, 'claude-agent.mjs')])
    expect(await readFile(join(agents, 'claude-agent.mjs'), 'utf8')).toBe(CLAUDE_AGENT_SOURCE)
    expect(await readFile(join(agents, 'codex-agent.mjs'), 'utf8')).toBe(
      '// customized by the user\n',
    )
    expect(Object.values(LEGACY_SHA256).flat()).not.toContain(sha256(CLAUDE_AGENT_SOURCE))
  })

  it('maps a record integrity failure to the integrity_error API code', () => {
    expect(toApiError(new RecordIntegrityError('review', 1, 'x')).code).toBe('integrity_error')
  })
})
