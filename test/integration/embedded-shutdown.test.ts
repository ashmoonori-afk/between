import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shutdownEmbedded } from '../../src/ui/start'
import { OneShotTransport } from '../../src/adapters/pty-transport'
import { PipeAgentHost } from '../../src/adapters/pipe-agent-host'
import { buildSignal } from '../../src/adapters/signal-transport'

let dir = ''

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  dir = ''
})

describe('embedded broker shutdown (N5)', () => {
  it('ends in-flight oneshot agents before releasing the lock', async () => {
    dir = await mkdtemp(join(tmpdir(), 'between-shutdown-'))
    await mkdir(join(dir, '.between'), { recursive: true })
    const developer = new PipeAgentHost('developer', 10)
    const reviewer = new PipeAgentHost('reviewer', 10)
    const agentExited = new Promise<number | null>((resolve) =>
      developer.subscribeExit((e) => resolve(e.exitCode)),
    )
    const transport = new OneShotTransport(dir, {
      // an agent that would run far longer than the test
      developerCommand: 'node -e "setInterval(() => {}, 1000)"',
      reviewerCommand: 'node -e ""',
      cwd: dir,
      hosts: { developer, reviewer },
    })
    await transport.send(buildSignal('developer', 1, 'hash', 'work', ''))
    expect(developer.snapshot().alive).toBe(true)

    const order: string[] = []
    void agentExited.then(() => order.push('agent exited'))
    try {
      await shutdownEmbedded({
        agentControl: transport,
        hosts: { developer, reviewer },
        lock: {
          releaseLock: async () => {
            order.push('lock released')
          },
        },
      })
      expect(order).toEqual(['agent exited', 'lock released'])
      expect(developer.snapshot().alive).toBe(false)
      expect(await agentExited).toBeNull() // killed, not a normal exit
    } finally {
      await transport.abortActive('test cleanup')
    }
  })
})
