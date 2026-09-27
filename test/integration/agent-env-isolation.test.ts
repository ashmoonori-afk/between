import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OneShotTransport } from '../../src/adapters/pty-transport'
import { buildSignal } from '../../src/adapters/signal-transport'
import type { AgentHost } from '../../src/adapters/agent-host'

let dir = ''
const saved: Record<string, string | undefined> = {}
const PLANTED = {
  BETWEEN_APPROVAL_SECRET: 'human-only-secret',
  GITHUB_TOKEN: 'ghp_should_not_leak',
  ANTHROPIC_API_KEY: 'provider-key-kept',
}

afterEach(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = ''
})

describe('oneshot agent environment isolation (N1)', () => {
  it('does not hand stripped secrets back to the spawned agent', async () => {
    dir = await mkdtemp(join(tmpdir(), 'between-env-'))
    await mkdir(join(dir, '.between'), { recursive: true })
    for (const [k, v] of Object.entries(PLANTED)) {
      saved[k] = process.env[k]
      process.env[k] = v
    }
    const dump = join(dir, 'dump-env.mjs')
    const out = join(dir, 'env.json')
    await writeFile(
      dump,
      `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(out)}, JSON.stringify(process.env))\n`,
    )

    let exited!: (code: number | null) => void
    const done = new Promise<number | null>((resolve) => (exited = resolve))
    const host = {
      markStart: () => {},
      feed: () => {},
      markExit: (code: number | null) => exited(code),
    } as unknown as AgentHost
    const transport = new OneShotTransport(dir, {
      developerCommand: `node ${dump}`,
      reviewerCommand: `node ${dump}`,
      cwd: dir,
      hosts: { developer: host },
    })

    await transport.send(buildSignal('developer', 1, 'hash', 'body', ''))
    expect(await done).toBe(0)

    const env = JSON.parse(await readFile(out, 'utf8')) as Record<string, string>
    expect(env.BETWEEN_APPROVAL_SECRET).toBeUndefined()
    expect(env.GITHUB_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBe('provider-key-kept')
    expect(env.PATH ?? env.Path).toBeTruthy()
  })
})
