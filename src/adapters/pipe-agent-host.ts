import { BaseAgentHost, type AgentHostKind, type AgentRole } from './agent-host'

/**
 * Zero-native-deps host for `oneshot` mode (and the `pty` degrade target). It owns no
 * persistent process: the `OneShotTransport` spawns the agent per signal and streams the
 * invocation's output into this buffer via `feed()` / `markStart()` / `markExit()`.
 * `start`/`deliver`/`resize` are no-ops because one-shot delivery happens in the transport.
 */
export class PipeAgentHost extends BaseAgentHost {
  readonly kind: AgentHostKind = 'pipe'

  constructor(role: AgentRole, scrollback: number) {
    super(role, scrollback)
  }

  async start(): Promise<void> {
    // passive: nothing runs until the one-shot transport spawns an invocation
  }

  async deliver(): Promise<void> {
    // one-shot mode delivers the signal by spawning the CLI in the transport, not here
  }

  resize(): void {
    // no TTY to resize
  }

  async stop(): Promise<void> {
    // no owned process
  }
}
