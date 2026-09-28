import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { FakeClock } from '../../src/core/clock'
import { betweenPaths } from '../../src/adapters/paths'
import { initWorkspace } from '../../src/api/setup'
import {
  createBetweenMcpServer,
  resolveServerRoot,
  scrubServerEnv,
  type BetweenMcpOptions,
} from '../../src/mcp/server'

const READ_TOOLS = [
  'between_doctor',
  'between_evidence',
  'between_journal',
  'between_replay',
  'between_status',
  'between_summarize',
]
const EXEC_TOOLS = ['between_policy', 'between_verify']
const CONTROL_TOOLS = [
  'between_goal',
  'between_interrupt',
  'between_pause',
  'between_resume',
  'between_review_now',
  'between_steer',
  'between_stop',
]

const dirs: string[] = []
const clients: Client[] = []

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()))
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function tempDir(prefix: string): Promise<string> {
  // native realpath matches fs.promises.realpath (expands Windows 8.3 names like RUNNER~1)
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), prefix)))
  dirs.push(dir)
  return dir
}

async function workspace(): Promise<string> {
  const dir = await tempDir('between-mcp-')
  await initWorkspace(dir, { agent: 'fake' }, new FakeClock(0))
  return dir
}

async function connect(opts: BetweenMcpOptions): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await createBetweenMcpServer(opts).connect(serverSide)
  const client = new Client({ name: 'between-test', version: '0.0.0' })
  await client.connect(clientSide)
  clients.push(client)
  return client
}

async function toolNames(client: Client): Promise<string[]> {
  return (await client.listTools()).tools.map((t) => t.name).sort()
}

interface Envelope {
  ok: boolean
  data?: Record<string, unknown>
  error?: { code: string; message: string }
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args })
  const body = res.structuredContent as unknown as Envelope
  const text = (res.content as Array<{ type: string; text: string }>)[0]!.text
  expect(JSON.parse(text)).toEqual(body)
  return { body, isError: res.isError === true }
}

describe('between MCP server', () => {
  it('exposes only read tools by default; exec and control need startup grants', async () => {
    const root = await workspace()
    expect(await toolNames(await connect({ root }))).toEqual(READ_TOOLS)
    expect(await toolNames(await connect({ root, allowExec: true }))).toEqual(
      [...READ_TOOLS, ...EXEC_TOOLS].sort(),
    )
    expect(await toolNames(await connect({ root, allowControl: true, allowExec: true }))).toEqual(
      [...READ_TOOLS, ...EXEC_TOOLS, ...CONTROL_TOOLS].sort(),
    )
  })

  it('never exposes human-only or trust-sensitive operations', async () => {
    const names = await toolNames(
      await connect({ root: await workspace(), allowControl: true, allowExec: true }),
    )
    for (const forbidden of ['approve', 'ack', 'init', 'policy_init', 'verify_push', 'worktree']) {
      expect(names.some((n) => n.includes(forbidden))).toBe(false)
    }
  })

  it('marks read tools read-only and control tools destructive', async () => {
    const tools = (
      await (await connect({ root: await workspace(), allowControl: true })).listTools()
    ).tools
    const byName = new Map(tools.map((t) => [t.name, t]))
    expect(byName.get('between_status')!.annotations).toMatchObject({ readOnlyHint: true })
    expect(byName.get('between_steer')!.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    })
  })

  it('returns status in the ok envelope for the pinned root', async () => {
    const { body, isError } = await call(
      await connect({ root: await workspace() }),
      'between_status',
    )
    expect(isError).toBe(false)
    expect(body.ok).toBe(true)
    expect((body.data!.workflow as { phase: string }).phase).toBe('idle')
  })

  it('verifies the journal by default', async () => {
    const { body } = await call(await connect({ root: await workspace() }), 'between_journal')
    expect((body.data!.integrity as { status: string }).status).toBe('verified')
  })

  it('maps api failures to a coded error envelope', async () => {
    const root = await tempDir('between-mcp-empty-')
    const { body, isError } = await call(await connect({ root }), 'between_status')
    expect(isError).toBe(true)
    expect(body).toMatchObject({ ok: false, error: { code: 'no_state' } })
    // the agent cannot init over MCP, so the message sends it to the human
    expect(body.error!.message).toContain('npx between-dev init')
  })

  it('reports no_state (not a verified empty journal) before init', async () => {
    const client = await connect({ root: await tempDir('between-mcp-empty-') })
    for (const tool of ['between_journal', 'between_replay']) {
      const { body, isError } = await call(client, tool)
      expect(isError).toBe(true)
      expect(body).toMatchObject({ ok: false, error: { code: 'no_state' } })
    }
  })

  it('rejects a per-call root (tools are pinned to the server root)', async () => {
    const client = await connect({ root: await workspace() })
    const other = await tempDir('between-mcp-other-')
    const res = await client.callTool({ name: 'between_status', arguments: { root: other } })
    expect(res.isError).toBe(true)
  })

  it('queues control commands only when control is granted', async () => {
    const root = await workspace()
    const denied = await connect({ root })
    const res = await denied.callTool({ name: 'between_goal', arguments: { goal: 'x' } })
    expect(res.isError).toBe(true)

    const { body } = await call(await connect({ root, allowControl: true }), 'between_goal', {
      goal: 'wire the mcp server',
    })
    expect(body).toMatchObject({ ok: true, data: { status: 'queued' } })
    const commandsDir = betweenPaths(root).commands
    const files = await readdir(commandsDir)
    expect(files).toEqual([`${(body.data as { command_id: string }).command_id}.json`])
    expect(JSON.parse(await readFile(join(commandsDir, files[0]!), 'utf8'))).toEqual({
      kind: 'goal',
      goal: 'wire the mcp server',
    })
  })

  it('rejects a blank goal with invalid_argument', async () => {
    const client = await connect({ root: await workspace(), allowControl: true })
    const { body } = await call(client, 'between_steer', { goal: '   ' })
    expect(body).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
  })
})

describe('resolveServerRoot', () => {
  it('prefers --root, then BETWEEN_ROOT, then cwd, canonicalized', async () => {
    const a = await tempDir('between-root-a-')
    const b = await tempDir('between-root-b-')
    expect(await resolveServerRoot(a, { BETWEEN_ROOT: b }, '/')).toBe(a)
    expect(await resolveServerRoot(undefined, { BETWEEN_ROOT: b }, '/')).toBe(b)
    expect(await resolveServerRoot(undefined, {}, a)).toBe(a)
  })

  it('refuses a missing root and a .between that escapes the root', async () => {
    const root = await tempDir('between-root-')
    await expect(resolveServerRoot(join(root, 'missing'), {}, '/')).rejects.toMatchObject({
      code: 'invalid_argument',
    })
    const outside = await tempDir('between-outside-')
    await mkdir(join(outside, 'state'))
    // junctions need no symlink privilege on Windows runners
    const linkType = process.platform === 'win32' ? 'junction' : 'dir'
    await symlink(join(outside, 'state'), join(root, '.between'), linkType)
    await expect(resolveServerRoot(root, {}, '/')).rejects.toMatchObject({
      code: 'invalid_argument',
    })
  })
})

describe('scrubServerEnv', () => {
  it('removes the approval secret and tokens but keeps runtime variables', () => {
    const env: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOME: '/home/x',
      BETWEEN_APPROVAL_SECRET: 's',
      GITHUB_TOKEN: 't',
    }
    const removed = scrubServerEnv(env)
    expect(removed).toEqual(expect.arrayContaining(['BETWEEN_APPROVAL_SECRET', 'GITHUB_TOKEN']))
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/x' })
  })
})
