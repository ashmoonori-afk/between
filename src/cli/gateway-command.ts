import type { Command } from 'commander'
import { loadConfig } from '../runtime'
import { print } from './output'
import { fail, root } from './shared'

export function registerGatewayCommand(program: Command): void {
  program
    .command('gateway')
    .description('Run the chat gateway (telegram/discord/echo) bridging a chat to the broker')
    .option('--max-seconds <n>', 'auto-stop after N seconds (smoke testing)', (v) => Number(v))
    .action(async (opts: { maxSeconds?: number }) => {
      const { createChatTransport } = await import('../gateway/factory')
      const { GatewaySession } = await import('../gateway/session')
      let session: InstanceType<typeof GatewaySession> | null = null
      let notify: ReturnType<typeof setInterval> | null = null
      const stop = async (): Promise<void> => {
        if (notify) clearInterval(notify)
        notify = null
        process.removeListener('SIGINT', onSigint)
        if (session) await session.stop()
      }
      const onSigint = (): void => void stop().then(() => process.exit(0))
      try {
        const config = await loadConfig(root())
        const transport = createChatTransport(config)
        session = new GatewaySession(root(), transport)
        await session.start()
        print(`between: gateway online (${transport.kind}). Ctrl-C to stop.`)
        notify = setInterval(() => void session?.tick(), 1500)
        if (opts.maxSeconds && opts.maxSeconds > 0) {
          await new Promise((r) => setTimeout(r, opts.maxSeconds! * 1000))
          await stop()
          print('between: gateway stopped.')
        } else {
          process.on('SIGINT', onSigint)
          await new Promise<void>(() => {})
        }
      } catch (e) {
        await stop().catch(() => {})
        await fail(e)
      }
    })
}
