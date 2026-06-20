import { execa } from 'execa'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { DiffInput, DiffSummary, UntrackedEntry } from '../core/types'

/** The well-known empty-tree object, used as the diff base when HEAD does not exist. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** git config pinned so diff text is deterministic across machines (I15). */
const PIN = ['-c', 'core.autocrlf=false', '-c', 'core.quotepath=false', '-c', 'core.fileMode=false']

/** Flags pinned so diff output is stable and review-friendly (I15). */
const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '--no-renames']

/** Exclude the broker's own tree even if `.between/` was accidentally git-tracked (P2-8 / I22). */
const TRACKED_EXCLUDE = ['--', ':(exclude).between/**']

const PINNED_ENV = { GIT_PAGER: 'cat', LC_ALL: 'C', TZ: 'UTC' } as const

export interface RepoState {
  busy: boolean
  reason: string | null
}

/**
 * A git command that feeds the review object failed (A4). The daemon must treat this as an
 * error, NOT as an empty diff — a git failure silently becoming "no change" would let a broken
 * repo state slip past review.
 */
export class GitError extends Error {
  constructor(
    message: string,
    readonly stderr = '',
  ) {
    super(message)
    this.name = 'GitError'
  }
}

export interface DiffInputOptions {
  reviewUntracked: boolean
  /** untracked paths matching none of these are dropped when the list is non-empty */
  untrackedGlobs: string[]
}

export class GitAdapter {
  constructor(private readonly root: string) {}

  private run(args: string[]) {
    return execa('git', [...PIN, ...args], {
      cwd: this.root,
      reject: false,
      env: PINNED_ENV,
      stripFinalNewline: false,
    })
  }

  async isRepo(): Promise<boolean> {
    const r = await this.run(['rev-parse', '--is-inside-work-tree'])
    return r.exitCode === 0 && r.stdout.trim() === 'true'
  }

  async hasHead(): Promise<boolean> {
    const r = await this.run(['rev-parse', '-q', '--verify', 'HEAD'])
    return r.exitCode === 0
  }

  private async base(): Promise<string> {
    return (await this.hasHead()) ? 'HEAD' : EMPTY_TREE
  }

  private async gitDir(): Promise<string> {
    const r = await this.run(['rev-parse', '--git-dir'])
    const dir = r.stdout.trim() || '.git'
    return isAbsolute(dir) ? dir : join(this.root, dir)
  }

  /** Detect abnormal states that must NOT produce a review object (I21). */
  async repoState(): Promise<RepoState> {
    const gitDir = await this.gitDir()
    const markers: Array<[string, string]> = [
      ['MERGE_HEAD', 'merge in progress'],
      ['rebase-merge', 'rebase in progress'],
      ['rebase-apply', 'rebase/am in progress'],
      ['CHERRY_PICK_HEAD', 'cherry-pick in progress'],
      ['REVERT_HEAD', 'revert in progress'],
      ['BISECT_LOG', 'bisect in progress'],
    ]
    for (const [file, reason] of markers) {
      if (existsSync(join(gitDir, file))) return { busy: true, reason }
    }
    // unmerged paths (conflict) via porcelain status
    const status = await this.run(['status', '--porcelain'])
    if (status.exitCode === 0) {
      const hasConflict = status.stdout.split('\n').some((l) => /^(DD|AU|UD|UA|DU|AA|UU) /.test(l))
      if (hasConflict) return { busy: true, reason: 'unmerged paths (conflict)' }
    }
    return { busy: false, reason: null }
  }

  /** `git diff <base>` (tracked, staging-invariant) with pinned flags. Fail-closed (A4). */
  private async trackedDiff(): Promise<string> {
    const r = await this.run(['diff', await this.base(), ...DIFF_FLAGS, ...TRACKED_EXCLUDE])
    if (r.exitCode !== 0) throw new GitError('git diff failed', r.stderr)
    return r.stdout
  }

  private async trackedRaw(): Promise<string> {
    // --no-renames so a rename emits delete+add (one path per line) instead of an R record with
    // two tab-separated paths, which downstream raw parsers (policy changedPathsFromRaw) misread.
    const r = await this.run([
      'diff',
      await this.base(),
      '--raw',
      '--abbrev=40',
      '--no-renames',
      ...TRACKED_EXCLUDE,
    ])
    if (r.exitCode !== 0) throw new GitError('git diff --raw failed', r.stderr)
    return r.stdout
  }

  /** numstat summary -> changed files / insertions / deletions. */
  async summary(): Promise<DiffSummary> {
    const r = await this.run(['diff', await this.base(), '--numstat', ...TRACKED_EXCLUDE])
    if (r.exitCode !== 0) throw new GitError('git diff --numstat failed', r.stderr) // fail-closed (A4)
    let changed = 0
    let ins = 0
    let del = 0
    for (const line of r.stdout.split('\n')) {
      if (line.trim() === '') continue
      changed += 1
      const [a, b] = line.split('\t')
      if (a && a !== '-') ins += Number(a) || 0
      if (b && b !== '-') del += Number(b) || 0
    }
    return { changed_files: changed, insertions: ins, deletions: del }
  }

  private async untracked(opts: DiffInputOptions): Promise<UntrackedEntry[]> {
    if (!opts.reviewUntracked) return []
    const list = await this.run(['ls-files', '--others', '--exclude-standard', '-z'])
    // F3 / A4: when untracked review is ON, a git failure must NOT silently drop untracked files
    // from the review object — fail closed so the daemon surfaces an error instead.
    if (list.exitCode !== 0) throw new GitError('git ls-files (untracked) failed', list.stderr)
    const files = list.stdout
      .split('\0')
      .map((f) => f.trim())
      .filter((f) => f.length > 0 && !f.startsWith('.between/'))
      .filter((f) => matchesGlobs(f, opts.untrackedGlobs))
    if (files.length === 0) return []
    // Chunk hash-object so a long file list can't blow the OS command-line length limit.
    const CHUNK = 100
    const oids: string[] = []
    for (let i = 0; i < files.length; i += CHUNK) {
      const hashed = await this.run(['hash-object', '--', ...files.slice(i, i + CHUNK)])
      if (hashed.exitCode !== 0)
        throw new GitError('git hash-object (untracked) failed', hashed.stderr)
      oids.push(...hashed.stdout.split('\n').filter((l) => l.trim().length > 0))
    }
    if (oids.length !== files.length) {
      throw new GitError('git hash-object returned an unexpected oid count', '')
    }
    return files.map((path, i) => ({ path, oid: oids[i] ?? '' }))
  }

  async diffInput(opts: DiffInputOptions): Promise<DiffInput> {
    const [tracked, trackedRaw, untracked] = await Promise.all([
      this.trackedDiff(),
      this.trackedRaw(),
      this.untracked(opts),
    ])
    return { tracked, trackedRaw, untracked }
  }

  // --- review-bundle provenance (A1) — read-only metadata for the immutable Review Object ---

  /** HEAD commit sha, or null when the repo has no commit yet. */
  async headSha(): Promise<string | null> {
    const r = await this.run(['rev-parse', 'HEAD'])
    return r.exitCode === 0 ? r.stdout.trim() : null
  }

  /** Current branch name, or null when detached / unborn. */
  async branch(): Promise<string | null> {
    const r = await this.run(['rev-parse', '--abbrev-ref', 'HEAD'])
    const name = r.stdout.trim()
    return r.exitCode === 0 && name && name !== 'HEAD' ? name : null
  }

  /** `git write-tree` OID of the current index (repo-state fingerprint); '' when unavailable. */
  async indexTree(): Promise<string> {
    const r = await this.run(['write-tree'])
    return r.exitCode === 0 ? r.stdout.trim() : ''
  }

  /** `git --version` string. */
  async gitVersion(): Promise<string> {
    const r = await this.run(['--version'])
    return r.exitCode === 0 ? r.stdout.trim() : ''
  }

  /** Raw `.gitattributes` content at the repo root (affects diff normalization), or '' if none. */
  async attributesText(): Promise<string> {
    const file = join(this.root, '.gitattributes')
    if (!existsSync(file)) return ''
    try {
      return await readFile(file, 'utf8')
    } catch {
      return ''
    }
  }
}

/** Minimal glob match: empty list = match all; supports a trailing/leading `*`. */
function matchesGlobs(path: string, globs: string[]): boolean {
  if (globs.length === 0) return true
  return globs.some((g) => {
    if (g === '*' || g === '**') return true
    if (g.startsWith('*')) return path.endsWith(g.slice(1))
    if (g.endsWith('*')) return path.startsWith(g.slice(0, -1))
    return path === g
  })
}
