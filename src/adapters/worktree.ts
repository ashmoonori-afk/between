import { execa } from 'execa'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { makeTreeWritable } from './sandbox'

const PINNED_ENV = { GIT_PAGER: 'cat', LC_ALL: 'C', TZ: 'UTC' } as const
/** Pin git config so the isolated checkout is deterministic across machines (matches GitAdapter). */
const PIN = ['-c', 'core.autocrlf=false', '-c', 'core.quotepath=false', '-c', 'core.fileMode=false']

/**
 * B1: hands out isolated git worktrees so the developer, reviewer, and verifier operate on
 * separate checkouts of the same repo instead of fighting over one working tree. Worktrees live
 * under `.between/worktrees/<name>` (gitignored). This is the isolation primitive; sandbox
 * sealing and stripped agent env are layered by `materializeBundle`.
 */
export class WorktreeProvider {
  constructor(private readonly root: string) {}

  rootDir(): string {
    return this.root
  }

  private dir(name: string): string {
    return join(resolve(this.root), '.between', 'worktrees', name)
  }

  private run(args: string[]) {
    return execa('git', [...PIN, ...args], { cwd: this.root, reject: false, env: PINNED_ENV })
  }

  /** Create a detached, isolated worktree at `ref` under `.between/worktrees/<name>`. */
  async create(name: string, ref: string): Promise<string> {
    const path = this.dir(name)
    if (existsSync(path)) await this.remove(name)
    const r = await this.run(['worktree', 'add', '--detach', '--force', path, ref])
    if (r.exitCode !== 0) throw new Error(`git worktree add failed: ${r.stderr.trim()}`)
    return path
  }

  /** Remove the worktree + prune git's bookkeeping (best-effort, idempotent). */
  async remove(name: string): Promise<void> {
    const path = this.dir(name)
    await makeTreeWritable(path)
    await this.run(['worktree', 'remove', '--force', path])
    if (existsSync(path)) await rm(path, { recursive: true, force: true }).catch(() => {})
    await this.run(['worktree', 'prune'])
  }

  /** Absolute paths of all worktrees git currently tracks (incl. the main one). */
  async list(): Promise<string[]> {
    const r = await this.run(['worktree', 'list', '--porcelain'])
    if (r.exitCode !== 0) return []
    return r.stdout
      .split('\n')
      .filter((l) => l.startsWith('worktree '))
      .map((l) => l.slice('worktree '.length).trim())
  }
}
