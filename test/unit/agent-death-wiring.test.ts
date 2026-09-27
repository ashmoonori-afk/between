import { describe, expect, it } from 'vitest'
import { wireAgentDeaths } from '../../src/ui/start'
import { PipeAgentHost } from '../../src/adapters/pipe-agent-host'
import { BaseAgentHost, type AgentHostKind } from '../../src/adapters/agent-host'
import type { Phase } from '../../src/core/types'

class FakePtyHost extends BaseAgentHost {
  readonly kind: AgentHostKind = 'pty'
  async start(): Promise<void> {}
  async deliver(): Promise<void> {}
  resize(): void {}
  async stop(): Promise<void> {}
}

function fakeDaemon(phase: Phase = 'reviewing') {
  const deaths: Array<[string, number | null]> = []
  return {
    deaths,
    daemon: {
      state: { workflow: { phase } },
      reportAgentDied: async (role: string, code: number | null) => {
        deaths.push([role, code])
      },
    } as unknown as Parameters<typeof wireAgentDeaths>[1],
  }
}

describe('wireAgentDeaths (C4)', () => {
  it('reports a oneshot agent that exits non-zero, and ignores normal or aborted exits', () => {
    const developer = new PipeAgentHost('developer', 10)
    const reviewer = new PipeAgentHost('reviewer', 10)
    const { daemon, deaths } = fakeDaemon()
    const stops = wireAgentDeaths({ developer, reviewer }, daemon)

    developer.markExit(0) // finished its turn
    reviewer.markExit(null) // aborted/killed on purpose
    expect(deaths).toEqual([])

    reviewer.markExit(2) // crashed (for example the CLI rejected its arguments)
    expect(deaths).toEqual([['reviewer', 2]])

    for (const stop of stops) stop()
    developer.markExit(1)
    expect(deaths).toHaveLength(1)
  })

  it('keeps pty semantics: any exit is a death unless paused with a null code', () => {
    const { daemon, deaths } = fakeDaemon()
    const developer = new FakePtyHost('developer', 10)
    wireAgentDeaths({ developer, reviewer: new FakePtyHost('reviewer', 10) }, daemon)
    developer.markExit(0)
    expect(deaths).toEqual([['developer', 0]])

    const paused = fakeDaemon('paused')
    const host = new FakePtyHost('developer', 10)
    wireAgentDeaths({ developer: host, reviewer: new FakePtyHost('reviewer', 10) }, paused.daemon)
    host.markExit(null)
    expect(paused.deaths).toEqual([])
  })

  it('does nothing in file mode (no hosts)', () => {
    expect(wireAgentDeaths(null, fakeDaemon().daemon)).toEqual([])
  })
})
