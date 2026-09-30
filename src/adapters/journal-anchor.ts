import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { execa } from 'execa'
import writeFileAtomic from 'write-file-atomic'
import type { ChainHead } from '../core/journal'

/**
 * Journal anchor: a copy of the newest journal head kept OUTSIDE the agent-writable `.between/`.
 *
 * The chain + the head pinned in `state.json` detect edits and truncation, but both files live in
 * the workspace, so restoring an older authentic copy of `events.jsonl` + `state.json` together is
 * self-consistent and invisible. The anchor records how far the journal had got; a journal that no
 * longer contains the anchored entry at its position was rolled back (or deleted) and fails closed.
 *
 * Stores: the macOS login keychain (via /usr/bin/security) on darwin; a per-user state directory on
 * other platforms. A process running as the same OS user outside any sandbox can still rewrite
 * either store; the anchor stops workspace-confined writers (sandboxed agents, a restore of the
 * repository directory) and makes a rollback a deliberate out-of-workspace act.
 */
export interface JournalAnchor {
  readonly kind: 'keychain' | 'file'
  read(): Promise<ChainHead | null>
  write(head: ChainHead): Promise<void>
  clear(): Promise<void>
  describe(): string
}

export class JournalRollbackError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JournalRollbackError'
  }
}

export interface AnchorRunResult {
  exitCode: number
  stdout: string
  stderr: string
}
export type AnchorRunner = (file: string, args: string[]) => Promise<AnchorRunResult>

const SECURITY = '/usr/bin/security'
const KEYCHAIN_SERVICE = 'between-dev.journal-anchor'
const KEYCHAIN_NOT_FOUND = 44

function parseHead(raw: string, where: string): ChainHead {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error(`journal anchor in ${where} is not valid JSON`)
  }
  const v = value as Partial<ChainHead> | null
  if (
    !v ||
    typeof v.hash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(v.hash) ||
    typeof v.count !== 'number' ||
    !Number.isInteger(v.count) ||
    v.count < 1
  ) {
    throw new Error(`journal anchor in ${where} is malformed`)
  }
  return { hash: v.hash, count: v.count }
}

const serialize = (head: ChainHead): string =>
  JSON.stringify({ hash: head.hash, count: head.count })

export class FileJournalAnchor implements JournalAnchor {
  readonly kind = 'file' as const
  private readonly path: string

  constructor(
    private readonly dir: string,
    id: string,
  ) {
    this.path = join(dir, `${id}.json`)
  }

  async read(): Promise<ChainHead | null> {
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
    return parseHead(raw, this.path)
  }

  async write(head: ChainHead): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    await writeFileAtomic(this.path, serialize(head), { mode: 0o600 })
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true })
  }

  describe(): string {
    return this.path
  }
}

const defaultRunner: AnchorRunner = async (file, args) => {
  const r = await execa(file, args, { reject: false, stdin: 'ignore', timeout: 10_000 })
  return {
    exitCode: typeof r.exitCode === 'number' ? r.exitCode : -1,
    stdout: String(r.stdout ?? ''),
    stderr: String(r.stderr ?? ''),
  }
}

export class KeychainJournalAnchor implements JournalAnchor {
  readonly kind = 'keychain' as const

  constructor(
    private readonly id: string,
    private readonly run: AnchorRunner = defaultRunner,
  ) {}

  async read(): Promise<ChainHead | null> {
    const r = await this.run(SECURITY, [
      'find-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
      '-a',
      this.id,
      '-w',
    ])
    if (r.exitCode === KEYCHAIN_NOT_FOUND) return null
    if (r.exitCode !== 0) throw this.failure('read', r)
    return parseHead(r.stdout.trim(), this.describe())
  }

  async write(head: ChainHead): Promise<void> {
    const r = await this.run(SECURITY, [
      'add-generic-password',
      '-U',
      '-s',
      KEYCHAIN_SERVICE,
      '-a',
      this.id,
      '-l',
      'Between journal anchor',
      '-w',
      serialize(head),
    ])
    if (r.exitCode !== 0) throw this.failure('write', r)
  }

  async clear(): Promise<void> {
    const r = await this.run(SECURITY, [
      'delete-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
      '-a',
      this.id,
    ])
    if (r.exitCode !== 0 && r.exitCode !== KEYCHAIN_NOT_FOUND) throw this.failure('clear', r)
  }

  describe(): string {
    return `the macOS keychain (service ${KEYCHAIN_SERVICE}, account ${this.id})`
  }

  private failure(op: string, r: AnchorRunResult): Error {
    const detail = r.stderr.trim().split('\n')[0] || `exit ${r.exitCode}`
    return new Error(`journal anchor keychain ${op} failed: ${detail}`)
  }
}

/** Stable per-project id: sha256 of the canonical project root (first 32 hex chars). */
export function anchorId(root: string): string {
  let canonical = resolve(root)
  try {
    canonical = realpathSync.native(canonical)
  } catch {
    // a root that does not exist yet keeps its resolved spelling
  }
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32)
}

export interface AnchorPlatform {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  home?: string
}

/** Per-user directory for file anchors, outside any project. `BETWEEN_ANCHOR_DIR` overrides. */
export function anchorDir(opts: AnchorPlatform = {}): string {
  const env = opts.env ?? process.env
  const platform = opts.platform ?? process.platform
  const home = opts.home ?? homedir()
  if (env.BETWEEN_ANCHOR_DIR) return env.BETWEEN_ANCHOR_DIR
  if (platform === 'win32') {
    return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'between', 'anchors')
  }
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'between', 'anchors')
  }
  return join(env.XDG_STATE_HOME || join(home, '.local', 'state'), 'between', 'anchors')
}

/**
 * The anchor store for `root`, chosen by `BETWEEN_JOURNAL_ANCHOR`:
 * `auto` (default: keychain on macOS, file elsewhere) | `keychain` | `file` | `off`.
 */
export function defaultJournalAnchor(
  root: string,
  opts: AnchorPlatform & { run?: AnchorRunner } = {},
): JournalAnchor | null {
  const env = opts.env ?? process.env
  const platform = opts.platform ?? process.platform
  const mode = (env.BETWEEN_JOURNAL_ANCHOR || 'auto').toLowerCase()
  if (mode === 'off') return null
  const id = anchorId(root)
  if (mode === 'keychain' || (mode === 'auto' && platform === 'darwin')) {
    return new KeychainJournalAnchor(id, opts.run)
  }
  return new FileJournalAnchor(anchorDir({ ...opts, env, platform }), id)
}
