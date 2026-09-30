import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventsLog } from '../../src/adapters/events-log'
import { StateRepository } from '../../src/adapters/state-repository'
import { betweenPaths } from '../../src/adapters/paths'
import {
  FileJournalAnchor,
  JournalRollbackError,
  KeychainJournalAnchor,
  anchorDir,
  anchorId,
  defaultJournalAnchor,
  type AnchorRunner,
  type JournalAnchor,
} from '../../src/adapters/journal-anchor'
import { readRecoverableState } from '../../src/daemon/recover-state'
import { inspectJournal, replayState, resetJournalAnchor } from '../../src/api/records'
import { initialState, pinJournal } from '../../src/core/state'
import { FakeClock } from '../../src/core/clock'
import { toApiError } from '../../src/api/errors'

let dir: string
let anchors: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-anchor-'))
  anchors = await mkdtemp(join(tmpdir(), 'between-anchor-store-'))
  await mkdir(join(dir, '.between'), { recursive: true })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
  await rm(anchors, { recursive: true, force: true }).catch(() => {})
})

const fileAnchor = () => new FileJournalAnchor(anchors, anchorId(dir))

/** Append `n` events and pin the head in state.json, the way the daemon does. */
async function appendPinned(log: EventsLog, n: number, from = 0): Promise<void> {
  const repo = new StateRepository(dir)
  const base =
    (await repo.read()) ??
    initialState(
      { project: { name: 'p', root: dir, obsidian_project_path: null } },
      new FakeClock(0),
    )
  for (let i = from; i < from + n; i++) {
    await log.append({ ts: `t${i}`, cycle: 0, phase: 'idle', event: `e${i}` })
  }
  await repo.write(pinJournal(base, log.head()))
}

/** Copy the journal + state aside (an "older authentic snapshot") and return a restore fn. */
async function snapshot(): Promise<() => Promise<void>> {
  const p = betweenPaths(dir)
  const saved = join(anchors, 'saved')
  await mkdir(saved, { recursive: true })
  await copyFile(p.events, join(saved, 'events.jsonl'))
  await copyFile(p.state, join(saved, 'state.json'))
  return async () => {
    await copyFile(join(saved, 'events.jsonl'), p.events)
    await copyFile(join(saved, 'state.json'), p.state)
    await rm(p.stateBak, { force: true })
  }
}

describe('journal anchor outside .between/ (rollback detection)', () => {
  it('anchors the newest head outside the workspace as events are appended', async () => {
    const log = new EventsLog(dir, { anchor: fileAnchor() })
    await appendPinned(log, 3)
    expect(await fileAnchor().read()).toEqual(log.head())
    expect(join(anchors, `${anchorId(dir)}.json`).startsWith(dir)).toBe(false)
  })

  it('restoring an older authentic journal + state.json fails closed on load', async () => {
    await appendPinned(new EventsLog(dir, { anchor: fileAnchor() }), 3)
    const restore = await snapshot()
    await appendPinned(new EventsLog(dir, { anchor: fileAnchor() }), 2, 3)
    await restore() // both files consistent with each other, chain + pin valid on their own

    // without the anchor the rollback is invisible (the documented gap this closes)
    const unanchored = new EventsLog(dir, { anchor: null })
    const state = await new StateRepository(dir).read()
    expect((await unanchored.verifyAll(state!.journal)).valid).toBe(true)

    const events = new EventsLog(dir, { anchor: fileAnchor() })
    await expect(readRecoverableState(new StateRepository(dir), events)).rejects.toBeInstanceOf(
      JournalRollbackError,
    )
    await expect(events.prime()).rejects.toBeInstanceOf(JournalRollbackError)
    const verified = await events.verifyAll(state!.journal)
    expect(verified.valid).toBe(false)
    expect(verified.anchor.ok).toBe(false)
  })

  it('deleting the journal and state behind the anchor fails closed', async () => {
    await appendPinned(new EventsLog(dir, { anchor: fileAnchor() }), 2)
    await rm(betweenPaths(dir).events)
    const events = new EventsLog(dir, { anchor: fileAnchor() })
    await expect(events.prime()).rejects.toThrow(/rolled back/)
  })

  it('a journal that grew past the anchor still verifies (crash between append and anchor)', async () => {
    await appendPinned(new EventsLog(dir, { anchor: fileAnchor() }), 2)
    await appendPinned(new EventsLog(dir, { anchor: null }), 2, 2) // anchor lags behind
    const events = new EventsLog(dir, { anchor: fileAnchor() })
    await expect(events.prime()).resolves.toBeUndefined()
    const state = await new StateRepository(dir).read()
    expect((await events.verifyAll(state!.journal)).valid).toBe(true)
  })

  it('never moves the anchor backwards', async () => {
    await appendPinned(new EventsLog(dir, { anchor: fileAnchor() }), 4)
    const before = await fileAnchor().read()
    // a second writer that seeded from the same journal appends more: anchor advances
    const log = new EventsLog(dir, { anchor: fileAnchor() })
    await appendPinned(log, 1, 4)
    expect((await fileAnchor().read())!.count).toBe(before!.count + 1)
  })

  it('a failed anchor read never lets a rolled-back journal overwrite the stored head', async () => {
    await appendPinned(new EventsLog(dir, { anchor: fileAnchor() }), 3)
    const restore = await snapshot()
    await appendPinned(new EventsLog(dir, { anchor: fileAnchor() }), 2, 3)
    await restore()
    const stored = await fileAnchor().read()
    expect(stored!.count).toBe(5)

    const store = fileAnchor()
    let failReads = 1
    const flaky: JournalAnchor = {
      kind: store.kind,
      describe: () => store.describe(),
      read: async () => {
        if (failReads-- > 0) throw new Error('keychain locked')
        return store.read()
      },
      write: (head) => store.write(head),
      clear: () => store.clear(),
    }
    const log = new EventsLog(dir, { anchor: flaky })
    await log.append({ ts: 't', cycle: 0, phase: 'idle', event: 'after-rollback' })

    expect(await fileAnchor().read()).toEqual(stored)
    await expect(new EventsLog(dir, { anchor: fileAnchor() }).prime()).rejects.toBeInstanceOf(
      JournalRollbackError,
    )
  })

  describe('API surfaces (default anchor from the environment)', () => {
    const saved: Record<string, string | undefined> = {}
    beforeEach(() => {
      for (const k of ['BETWEEN_JOURNAL_ANCHOR', 'BETWEEN_ANCHOR_DIR']) saved[k] = process.env[k]
      process.env.BETWEEN_JOURNAL_ANCHOR = 'file'
      process.env.BETWEEN_ANCHOR_DIR = anchors
    })
    afterEach(() => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    })

    it('journal --verify reports tampered and replay --verify maps to integrity_error', async () => {
      await appendPinned(new EventsLog(dir), 3)
      const restore = await snapshot()
      await appendPinned(new EventsLog(dir), 2, 3)
      await restore()

      const report = await inspectJournal(dir, { verify: true })
      expect(report.integrity?.status).toBe('tampered')
      expect(report.integrity && 'reason' in report.integrity && report.integrity.reason).toMatch(
        /anchor/,
      )
      const err = await replayState(dir, { verify: true }).catch((e: unknown) => e)
      expect(toApiError(err).code).toBe('integrity_error')
    })

    it('reset-anchor re-anchors to the current journal after an intentional restore', async () => {
      await appendPinned(new EventsLog(dir), 3)
      const restore = await snapshot()
      await appendPinned(new EventsLog(dir), 2, 3)
      await restore()

      const reset = await resetJournalAnchor(dir)
      expect(reset).toMatchObject({ entries: 3, anchor: 'file' })
      expect((await inspectJournal(dir, { verify: true })).integrity?.status).toBe('verified')
    })
  })
})

describe('anchor stores', () => {
  it('file store round-trips and clears', async () => {
    const a = fileAnchor()
    expect(await a.read()).toBeNull()
    await a.write({ hash: 'a'.repeat(64), count: 7 })
    expect(await a.read()).toEqual({ hash: 'a'.repeat(64), count: 7 })
    await a.clear()
    expect(await a.read()).toBeNull()
  })

  it('file store treats a corrupt anchor as an error, not as "no anchor"', async () => {
    const a = fileAnchor()
    await a.write({ hash: 'b'.repeat(64), count: 1 })
    const path = join(anchors, `${anchorId(dir)}.json`)
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ count: 1 })
    await (await import('node:fs/promises')).writeFile(path, '{"hash":"x"}')
    await expect(a.read()).rejects.toThrow(/anchor/)
  })

  it('keychain store drives /usr/bin/security with a fixed service and the root id', async () => {
    const calls: string[][] = []
    let stored: string | null = null
    const run: AnchorRunner = async (file, args) => {
      calls.push([file, ...args])
      if (args[0] === 'add-generic-password') {
        stored = args[args.indexOf('-w') + 1]!
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      if (args[0] === 'find-generic-password') {
        return stored === null
          ? { exitCode: 44, stdout: '', stderr: 'could not be found' }
          : { exitCode: 0, stdout: `${stored}\n`, stderr: '' }
      }
      stored = null
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    const a = new KeychainJournalAnchor('id123', run)
    expect(await a.read()).toBeNull()
    await a.write({ hash: 'c'.repeat(64), count: 3 })
    expect(await a.read()).toEqual({ hash: 'c'.repeat(64), count: 3 })
    await a.clear()
    expect(calls[0]).toEqual([
      '/usr/bin/security',
      'find-generic-password',
      '-s',
      'between-dev.journal-anchor',
      '-a',
      'id123',
      '-w',
    ])
    expect(calls[1]!.slice(0, 7)).toEqual([
      '/usr/bin/security',
      'add-generic-password',
      '-U',
      '-s',
      'between-dev.journal-anchor',
      '-a',
      'id123',
    ])
    expect(calls.at(-1)!.slice(0, 2)).toEqual(['/usr/bin/security', 'delete-generic-password'])
  })

  it('keychain store surfaces a real failure (locked keychain) as an error', async () => {
    const run: AnchorRunner = async () => ({ exitCode: 36, stdout: '', stderr: 'locked' })
    await expect(new KeychainJournalAnchor('id', run).read()).rejects.toThrow(/keychain/)
  })

  it('resolves the per-user anchor directory per OS', () => {
    expect(anchorDir({ platform: 'darwin', env: {}, home: '/Users/u' })).toBe(
      join('/Users/u', 'Library', 'Application Support', 'between', 'anchors'),
    )
    expect(anchorDir({ platform: 'linux', env: {}, home: '/home/u' })).toBe(
      join('/home/u', '.local', 'state', 'between', 'anchors'),
    )
    expect(anchorDir({ platform: 'linux', env: { XDG_STATE_HOME: '/xdg' }, home: '/home/u' })).toBe(
      join('/xdg', 'between', 'anchors'),
    )
    expect(anchorDir({ platform: 'linux', env: { XDG_STATE_HOME: 'rel' }, home: '/home/u' })).toBe(
      join('/home/u', '.local', 'state', 'between', 'anchors'),
    )
    expect(
      anchorDir({
        platform: 'win32',
        env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' },
        home: 'C:\\Users\\u',
      }),
    ).toBe(join('C:\\Users\\u\\AppData\\Local', 'between', 'anchors'))
    expect(anchorDir({ platform: 'win32', env: { BETWEEN_ANCHOR_DIR: '/x' }, home: '/h' })).toBe(
      '/x',
    )
  })

  it('picks the keychain on macOS, a per-user file elsewhere, and nothing when off', () => {
    const home = '/h'
    expect(defaultJournalAnchor(dir, { platform: 'darwin', env: {}, home })?.kind).toBe('keychain')
    expect(defaultJournalAnchor(dir, { platform: 'linux', env: {}, home })?.kind).toBe('file')
    expect(defaultJournalAnchor(dir, { platform: 'win32', env: {}, home })?.kind).toBe('file')
    expect(
      defaultJournalAnchor(dir, {
        platform: 'darwin',
        env: { BETWEEN_JOURNAL_ANCHOR: 'file' },
        home,
      })?.kind,
    ).toBe('file')
    expect(
      defaultJournalAnchor(dir, {
        platform: 'linux',
        env: { BETWEEN_JOURNAL_ANCHOR: 'off' },
        home,
      }),
    ).toBeNull()
  })

  it('derives a stable id from the canonical project root', () => {
    expect(anchorId(dir)).toMatch(/^[a-f0-9]{32}$/)
    expect(anchorId(dir)).toBe(anchorId(join(dir, '.')))
    expect(anchorId(dir)).not.toBe(anchorId(anchors))
  })
})
