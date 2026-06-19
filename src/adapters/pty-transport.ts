import { execa } from 'execa'
import type { Ack, Signal, SignalTransport } from '../core/types'
import { FileTransport } from './signal-transport'
import { tokenizeCommand, type AgentHost, type AgentRole } from './agent-host'
import { strippedAgentEnv } from './approval-secret'

export type AgentHostMap = Partial<Record<AgentRole, AgentHost>>

function roleOf(signal: Signal): AgentRole | null {
  return signal.target === 'reviewer' || signal.target === 'developer' ? signal.target : null
}

export interface OneShotOptions {
  developerCommand: string
  reviewerCommand: string
  cwd: string
  hosts?: AgentHostMap
}

/**
 * One-shot transport (ADR-0001 D2 "cleaner option"): each signal SPAWNS the agent CLI with
 * the signal body on stdin (fire-and-forget — the agent writes the ack/review files the
 * daemon polls for, so the tick is never blocked on a slow agent). The signal pointer is
 * still persisted via a composed FileTransport, and `pollAck` is delegated to it verbatim
 * so `reviewing` stays gated on a real `.between/acks/<id>.json` receipt (I7).
 */
export class OneShotTransport implements SignalTransport {
  readonly kind = 'oneshot'
  private readonly file: FileTransport

  constructor(
    private readonly root: string,
    private readonly opts: OneShotOptions,
  ) {
    this.file = new FileTransport(root)
  }

  async send(signal: Signal): Promise<void> {
    await this.file.send(signal) // keep the .between/signals/<target>.json record
    const role = roleOf(signal)
    if (!role) return
    const command = role === 'reviewer' ? this.opts.reviewerCommand : this.opts.developerCommand
    const { file, args } = tokenizeCommand(command)
    const host = this.opts.hosts?.[role]
    host?.markStart()
    host?.feed(`$ ${command}\n`)
    const sub = execa(file, args, {
      cwd: this.opts.cwd,
      input: signal.body,
      reject: false,
      env: strippedAgentEnv({ FORCE_COLOR: '1', BETWEEN_ROOT: this.root }),
    })
    sub.stdout?.on('data', (d: Buffer) => host?.feed(d.toString()))
    sub.stderr?.on('data', (d: Buffer) => host?.feed(d.toString()))
    void sub.then(
      (r) => host?.markExit(r.exitCode ?? null),
      () => host?.markExit(null),
    )
    // intentionally NOT awaited — fire and forget
  }

  pollAck(signalId: string): Promise<Ack | null> {
    return this.file.pollAck(signalId)
  }
}

export interface PtyTransportOptions {
  hosts: AgentHostMap
}

/**
 * PTY transport: delivers the signal body as keystrokes to the matching LIVE PtyAgentHost.
 * Like OneShotTransport, it persists the signal pointer and delegates `pollAck` to a composed
 * FileTransport, reusing the proven ack-file gate.
 */
export class PtyTransport implements SignalTransport {
  readonly kind = 'pty'
  private readonly file: FileTransport

  constructor(
    root: string,
    private readonly opts: PtyTransportOptions,
  ) {
    this.file = new FileTransport(root)
  }

  async send(signal: Signal): Promise<void> {
    await this.file.send(signal)
    const role = roleOf(signal)
    if (!role) return
    await this.opts.hosts[role]?.deliver(signal.body)
  }

  pollAck(signalId: string): Promise<Ack | null> {
    return this.file.pollAck(signalId)
  }
}
