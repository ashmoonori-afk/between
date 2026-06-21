import { BaseAgentHost, tokenizeCommand, type AgentHostKind, type AgentRole } from './agent-host'
import { prepareAgentExecution, resolveAgentCommandPaths } from './agent-execution'

/** Minimal structural type for the (optional) node-pty module — we ship no @types for it. */
interface IPtyLike {
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}
interface PtyModule {
  spawn(
    file: string,
    args: string[],
    opts: {
      name?: string
      cols?: number
      rows?: number
      cwd?: string
      env?: Record<string, string | undefined>
    },
  ): IPtyLike
}

export class PtyUnavailableError extends Error {
  constructor(message = 'No prebuilt node-pty binary could be loaded') {
    super(message)
    this.name = 'PtyUnavailableError'
  }
}

/**
 * Lazy-load a PTY backend via an INDIRECT specifier so tsc/tsup never statically resolve
 * the native module (same seam as cli.ts doctor). Tries the prebuilt @lydell fork first,
 * then upstream node-pty. Throws PtyUnavailableError when neither loads.
 */
export async function loadPty(): Promise<PtyModule> {
  const specs = ['@lydell/node-pty', 'node-pty']
  for (const spec of specs) {
    try {
      const mod = (await import(spec)) as { spawn?: PtyModule['spawn']; default?: PtyModule }
      if (typeof mod.spawn === 'function') return mod as PtyModule
      if (mod.default && typeof mod.default.spawn === 'function') return mod.default
    } catch {
      // try the next candidate
    }
  }
  throw new PtyUnavailableError()
}

export interface PtyAgentOptions {
  command: string
  root: string
  cwd: string
  cols?: number
  rows?: number
}

/**
 * Active host backed by a real ConPTY/forkpty process. Shows AND signals (keystrokes).
 * Optional: `start()` rejects with PtyUnavailableError when no prebuilt binary loads, which
 * the start orchestrator catches to degrade to pipe + one-shot.
 */
export class PtyAgentHost extends BaseAgentHost {
  readonly kind: AgentHostKind = 'pty'
  private proc: IPtyLike | null = null

  constructor(
    role: AgentRole,
    scrollback: number,
    private readonly opts: PtyAgentOptions,
  ) {
    super(role, scrollback)
  }

  async start(): Promise<void> {
    if (this.proc) await this.stop()
    const pty = await loadPty()
    const { file, args } = resolveAgentCommandPaths(
      this.opts.root,
      tokenizeCommand(this.opts.command),
    )
    const launch = await prepareAgentExecution(this.opts.root, this.role, this.opts.cwd, {
      FORCE_COLOR: '1',
    })
    this.markStart()
    if (launch.reviewerWorktree)
      this.feed(`[between] reviewer worktree ${launch.reviewerWorktree}\n`)
    const proc = pty.spawn(file, args, {
      name: 'xterm-color',
      cols: this.opts.cols ?? 80,
      rows: this.opts.rows ?? 24,
      cwd: launch.cwd,
      env: launch.env,
    })
    this.proc = proc
    proc.onData((d) => this.feed(d))
    proc.onExit(({ exitCode }) => {
      if (this.proc !== proc) return
      this.markExit(exitCode)
      this.proc = null
    })
  }

  async deliver(body: string): Promise<void> {
    // deliver the signal as keystrokes; carriage returns submit lines in a TUI
    this.proc?.write(body.replace(/\n/g, '\r') + '\r')
  }

  resize(cols: number, rows: number): void {
    try {
      this.proc?.resize(cols, rows)
    } catch {
      // a closed pty can't be resized — ignore
    }
  }

  async stop(): Promise<void> {
    const proc = this.proc
    try {
      proc?.kill()
    } catch {
      // already gone
    }
    if (this.proc === proc) this.proc = null
    if (this.alive) this.markExit(null)
  }
}
