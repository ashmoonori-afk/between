import { CommandBus } from '../adapters/command-bus'
import { StateRepository } from '../adapters/state-repository'
import { resolveApprovalSecret } from '../adapters/approval-secret'
import { signApproval } from '../core/approval'
import { APPROVAL_SCOPES } from '../core/constants'
import type { ApprovalScope, Phase } from '../core/types'
import type { ChatMessage, ChatTransport } from './transport'

const HELP = [
  'Between gateway — commands:',
  '  status                 broker phase / cycle / waiting',
  '  goal <text>            lock a work goal',
  '  review-now             force a review of the current diff',
  '  approve <merge|deploy|promote_rule>   sign + submit a human approval',
  '  pause | resume | stop  control the broker',
  '  help',
].join('\n')

/**
 * Bridges a chat (over any `ChatTransport`) to the Between broker (Phase 2). Inbound messages
 * become commands on the broker's command bus (the daemon stays the single state writer);
 * `approve` is HMAC-signed with the human session's secret (P1-5). `tick()` pushes a
 * notification to the last chat when the broker reaches a human gate or finishes.
 */
export class GatewaySession {
  private readonly bus: CommandBus
  private readonly repo: StateRepository
  private lastChatId: string | null = null
  private lastPhase: Phase | null = null

  constructor(
    private readonly root: string,
    private readonly transport: ChatTransport,
  ) {
    this.bus = new CommandBus(root)
    this.repo = new StateRepository(root)
  }

  async start(): Promise<void> {
    await this.transport.start((m) => this.onMessage(m))
  }

  async stop(): Promise<void> {
    await this.transport.stop()
  }

  private async onMessage(msg: ChatMessage): Promise<void> {
    this.lastChatId = msg.chatId
    const reply = await this.handle(msg.text.trim())
    await this.transport.send(msg.chatId, reply)
  }

  async handle(text: string): Promise<string> {
    const sp = text.indexOf(' ')
    const cmd = (sp === -1 ? text : text.slice(0, sp)).toLowerCase()
    const arg = sp === -1 ? '' : text.slice(sp + 1).trim()
    switch (cmd) {
      case '':
      case 'help':
        return HELP
      case 'status':
        return this.statusLine()
      case 'goal':
        if (!arg) return 'usage: goal <text>'
        await this.bus.submit({ kind: 'goal', goal: arg })
        return `goal locked: ${arg}`
      case 'review-now':
      case 'review_now':
        await this.bus.submit({ kind: 'review_now' })
        return 'review requested'
      case 'pause':
        await this.bus.submit({ kind: 'pause' })
        return 'paused'
      case 'resume':
        await this.bus.submit({ kind: 'resume' })
        return 'resumed'
      case 'stop':
        await this.bus.submit({ kind: 'stop' })
        return 'stopping the broker'
      case 'approve':
        return this.approve(arg)
      default:
        return `unknown command "${cmd}". ${HELP}`
    }
  }

  private async approve(scopeArg: string): Promise<string> {
    const scope = scopeArg.trim() as ApprovalScope
    if (!APPROVAL_SCOPES.includes(scope)) {
      return `usage: approve <${APPROVAL_SCOPES.join('|')}>`
    }
    const state = await this.repo.read()
    const secret = resolveApprovalSecret(this.root)
    const sig = secret
      ? signApproval(secret, {
          scope,
          diff_hash: state?.diff.hash ?? null,
          cycle: state?.workflow.cycle ?? 0,
        })
      : undefined
    await this.bus.submit({ kind: 'approve', scope, sig })
    return secret
      ? `${scope} approval signed + submitted`
      : `${scope} approval submitted (UNSIGNED)`
  }

  private async statusLine(): Promise<string> {
    const state = await this.repo.read()
    if (!state) return 'not initialized — run `between init`'
    const wf = state.workflow
    return `phase ${wf.phase} · cycle ${wf.cycle} · waiting on ${wf.waiting_on ?? '-'}`
  }

  /** Poll broker state once; push a chat notification when it reaches a gate / finishes. */
  async tick(): Promise<void> {
    const state = await this.repo.read()
    if (!state || !this.lastChatId) return
    const phase = state.workflow.phase
    if (phase === this.lastPhase) return
    this.lastPhase = phase
    if (phase === 'human_gate') {
      await this.transport.send(this.lastChatId, '⏸ approval needed — reply: approve merge')
    } else if (phase === 'done') {
      await this.transport.send(this.lastChatId, '✓ done')
    } else if (phase === 'error') {
      await this.transport.send(
        this.lastChatId,
        `⚑ broker error: ${state.workflow.error?.message ?? 'unknown'}`,
      )
    }
  }
}
