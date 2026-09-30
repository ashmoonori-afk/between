import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { defaultConfigYaml } from '../../src/core/config-schema'
import type { ModelsResult } from '../../src/api/models'
import { requestReview, type ReviewDeps, type ReviewResult } from '../../src/api/review'
import { createBetweenMcpServer } from '../../src/mcp/server'
import {
  FAKE_REQUEST_CHANGES_MARKER,
  fakeReviewerOutput,
  type ReviewerPreset,
} from '../../src/review/direct'
import { reviewShim } from '../../src/review/shims'

const dirs: string[] = []
const clients: Client[] = []

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()))
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function tempDir(prefix: string): Promise<string> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), prefix)))
  dirs.push(dir)
  return dir
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execa('git', ['-c', 'commit.gpgsign=false', ...args], { cwd })
}

async function repo(): Promise<string> {
  const dir = await tempDir('between-review-')
  await git(dir, ['init', '-b', 'main'])
  await git(dir, ['config', 'user.email', 't@example.com'])
  await git(dir, ['config', 'user.name', 'Tester'])
  await writeFile(join(dir, 'app.txt'), 'v1\n')
  await git(dir, ['add', '-A'])
  await git(dir, ['commit', '-m', 'init'])
  await writeFile(join(dir, 'app.txt'), 'v2\n')
  await writeFile(join(dir, 'plan.md'), '# Plan\n\n1. Ship it.\n')
  return dir
}

interface Recorder extends ReviewDeps {
  calls: Array<{ preset: ReviewerPreset; prompt: string; model?: string }>
}

function recorder(): Recorder {
  const calls: Recorder['calls'] = []
  return {
    calls,
    runReviewer: async (preset, prompt, opts) => {
      calls.push({ preset, prompt, ...(opts.model ? { model: opts.model } : {}) })
      return fakeReviewerOutput(prompt)
    },
    fetchText: async (url) => `# Remote plan at ${url}\n`,
    listModels: async (): Promise<ModelsResult> => ({
      claude: {
        source: 'static',
        models: ['fable', 'opus', 'sonnet', 'haiku'],
        note: 'Claude Code has no reliable model listing command.',
      },
      codex: { source: 'cli', models: ['gpt-6-astra', 'gpt-5.5'] },
    }),
  }
}

describe('requestReview', () => {
  it('reviews the working-tree diff against HEAD', async () => {
    const root = await repo()
    const deps = recorder()
    const result = await requestReview(root, { kind: 'diff', reviewer: 'codex' }, deps)
    expect(result).toMatchObject({
      kind: 'diff',
      reviewer: 'codex',
      routed_by: 'explicit',
      verdict: 'APPROVE',
      subject: { source: 'git', label: 'git diff HEAD' },
    })
    expect(deps.calls[0]!.prompt).toContain('+v2')
  })

  it('reviews a plan file and an inline answer with their own rubrics', async () => {
    const root = await repo()
    const deps = recorder()
    const plan = await requestReview(root, { kind: 'plan', file: 'plan.md', from: 'claude' }, deps)
    expect(plan).toMatchObject({ reviewer: 'codex', routed_by: 'paired_with_caller' })
    expect(plan.rubric).toContain('open decisions')
    expect(deps.calls[0]!.prompt).toContain('# Plan')

    const answer = await requestReview(
      root,
      {
        kind: 'answer',
        text: `Use a mutex. ${FAKE_REQUEST_CHANGES_MARKER}`,
        context: 'How do I fix the race?',
        from: 'codex',
      },
      deps,
    )
    expect(answer).toMatchObject({ reviewer: 'claude', verdict: 'REQUEST_CHANGES' })
    expect(answer.rubric).toEqual(['correctness', 'completeness', 'evidence', 'clarity'])
    expect(deps.calls[1]!.prompt).toContain('How do I fix the race?')
  })

  it('reviews a URL subject', async () => {
    const deps = recorder()
    const result = await requestReview(
      await repo(),
      { kind: 'plan', url: 'https://example.com/plan.md', reviewer: 'fake' },
      deps,
    )
    expect(result.subject).toMatchObject({ source: 'url', label: 'https://example.com/plan.md' })
    await expect(
      requestReview(
        await repo(),
        { kind: 'plan', url: 'file:///etc/passwd', reviewer: 'fake' },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'invalid_argument' })
  })

  it('routes to the configured reviewer when the caller is unknown', async () => {
    const root = await repo()
    await mkdir(join(root, '.between'))
    await writeFile(
      join(root, '.between', 'config.yaml'),
      defaultConfigYaml().replace(
        "reviewer_command: 'node .between/agents/fake-agent.mjs reviewer'",
        "reviewer_command: 'node .between/agents/codex-agent.mjs reviewer'",
      ),
    )
    const result = await requestReview(root, { kind: 'plan', text: 'do x' }, recorder())
    expect(result).toMatchObject({ reviewer: 'codex', routed_by: 'config' })
  })

  it('redacts secret-like values before the subject leaves the machine', async () => {
    const deps = recorder()
    const token = `ghp_${'a'.repeat(30)}`
    const result = await requestReview(
      await repo(),
      { kind: 'answer', text: `set GH token ${token}`, reviewer: 'claude' },
      deps,
    )
    expect(result.subject.redactions).toBe(1)
    expect(deps.calls[0]!.prompt).not.toContain(token)
  })

  it('refuses bad input with invalid_argument', async () => {
    const root = await repo()
    const outside = await tempDir('between-review-outside-')
    await writeFile(join(outside, 'secret.md'), 'x')
    await writeFile(join(root, '.env'), 'A=1')
    const deps = recorder()
    const cases = [
      { kind: 'plan' as const, reviewer: 'fake' as const },
      { kind: 'plan' as const, text: 'a', file: 'plan.md', reviewer: 'fake' as const },
      { kind: 'plan' as const, file: join(outside, 'secret.md'), reviewer: 'fake' as const },
      { kind: 'plan' as const, file: '.env', reviewer: 'fake' as const },
      { kind: 'answer' as const, text: 'a', base: 'HEAD', reviewer: 'fake' as const },
      { kind: 'diff' as const, base: '--output=x', reviewer: 'fake' as const },
      { kind: 'plan' as const, text: 'no reviewer given' },
      {
        kind: 'plan' as const,
        text: 'self review',
        reviewer: 'claude' as const,
        from: 'claude' as const,
      },
    ]
    for (const req of cases) {
      await expect(requestReview(root, req, deps)).rejects.toMatchObject({
        code: 'invalid_argument',
      })
    }
    expect(deps.calls).toHaveLength(0)
  })

  it('reports an unparseable reviewer reply as reviewer_failed', async () => {
    await expect(
      requestReview(
        await repo(),
        { kind: 'plan', text: 'x', reviewer: 'claude' },
        { runReviewer: async () => 'LGTM!' },
      ),
    ).rejects.toMatchObject({ code: 'reviewer_failed' })
  })

  it('validates and echoes an explicitly selected reviewer model', async () => {
    // Given: authoritative discovered Codex models
    const deps = recorder()

    // When: an available model is selected
    const result = await requestReview(
      await repo(),
      { kind: 'plan', text: 'x', reviewer: 'codex', model: 'gpt-5.5' },
      deps,
    )

    // Then: the selected model reaches the runner and result
    expect(result).toMatchObject({ reviewer: 'codex', model: 'gpt-5.5' })
    expect(deps.calls[0]).toMatchObject({ preset: 'codex', model: 'gpt-5.5' })
  })

  it('rejects unknown authoritative models with suggestions', async () => {
    // Given: authoritative discovered Codex models
    const deps = recorder()

    // When/Then: an unknown model is rejected before a paid review
    await expect(
      requestReview(
        await repo(),
        { kind: 'plan', text: 'x', reviewer: 'codex', model: 'gpt-5.6' },
        deps,
      ),
    ).rejects.toMatchObject({
      code: 'invalid_argument',
      message: expect.stringContaining('gpt-5.5'),
    })
    expect(deps.calls).toHaveLength(0)
  })

  it('allows safe model names against a static list and returns a note', async () => {
    // Given: Claude has only a non-authoritative static alias list
    const deps = recorder()

    // When: a safe full model name is selected
    const result = await requestReview(
      await repo(),
      { kind: 'plan', text: 'x', reviewer: 'claude', model: 'claude-opus-5-5' },
      deps,
    )

    // Then: the CLI decides availability and the result explains the static source
    expect(result).toMatchObject({
      model: 'claude-opus-5-5',
      model_note: expect.stringContaining('no reliable model listing'),
    })
  })
})

describe('between_review over MCP', () => {
  async function connect(
    root: string,
    deps: ReviewDeps,
    clientName: string,
    allowReview = true,
  ): Promise<Client> {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    await createBetweenMcpServer({ root, reviewDeps: deps, allowReview }).connect(serverSide)
    const client = new Client({ name: clientName, version: '0.0.0' })
    await client.connect(clientSide)
    clients.push(client)
    return client
  }

  async function review(client: Client, args: Record<string, unknown>) {
    const res = await client.callTool({ name: 'between_review', arguments: args })
    const body = res.structuredContent as {
      ok: boolean
      data?: ReviewResult
      error?: { code: string }
    }
    return { body, isError: res.isError === true }
  }

  it('needs the --allow-review startup grant and is not marked read-only', async () => {
    const root = await repo()
    const off = await connect(root, recorder(), 'test', false)
    expect((await off.listTools()).tools.map((t) => t.name)).not.toContain('between_review')
    expect((await off.listTools()).tools.map((t) => t.name)).not.toContain('between_models')
    expect((await review(off, { kind: 'plan', text: 'x', reviewer: 'codex' })).isError).toBe(true)

    const on = await connect(root, recorder(), 'test')
    const tool = (await on.listTools()).tools.find((t) => t.name === 'between_review')
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    })
    expect((await on.listTools()).tools.map((t) => t.name)).toContain('between_models')
  })

  it('lists reviewer models and accepts a model over MCP', async () => {
    // Given: the review access grant and injected discovery seam
    const deps = recorder()
    const client = await connect(await repo(), deps, 'test')

    // When: the client lists models and requests a selected one
    const listed = await client.callTool({ name: 'between_models', arguments: {} })
    const reviewed = await review(client, {
      kind: 'plan',
      text: 'x',
      reviewer: 'codex',
      model: 'gpt-5.5',
    })

    // Then: both tools return the injected model data without a real provider call
    expect(listed.structuredContent).toMatchObject({
      ok: true,
      data: { codex: { source: 'cli', models: ['gpt-6-astra', 'gpt-5.5'] } },
    })
    expect(reviewed.body).toMatchObject({
      ok: true,
      data: { model: 'gpt-5.5' },
    })
  })

  it('refuses a self-review by the calling agent', async () => {
    const deps = recorder()
    const client = await connect(await repo(), deps, 'claude-code')
    const res = await review(client, { kind: 'plan', text: 'x', reviewer: 'claude' })
    expect(res.body).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(deps.calls).toHaveLength(0)
  })

  it('reviews diff, answer, and plan; the other agent of the calling client reviews', async () => {
    const root = await repo()
    const deps = recorder()
    const client = await connect(root, deps, 'claude-code')

    const diff = await review(client, { kind: 'diff' })
    expect(diff.body).toMatchObject({
      ok: true,
      data: {
        kind: 'diff',
        reviewer: 'codex',
        routed_by: 'paired_with_caller',
        verdict: 'APPROVE',
      },
    })

    const answer = await review(client, {
      kind: 'answer',
      text: `answer ${FAKE_REQUEST_CHANGES_MARKER}`,
      context: 'question',
    })
    expect(answer.body.data).toMatchObject({ kind: 'answer', verdict: 'REQUEST_CHANGES' })
    expect(answer.body.data!.findings[0]).toMatchObject({ id: 'F1', severity: 'major' })

    const plan = await review(client, { kind: 'plan', file: 'plan.md', from: 'claude' })
    expect(plan.body.data).toMatchObject({ kind: 'plan', reviewer: 'codex' })

    const fromCodex = await connect(root, deps, 'codex-mcp-client')
    const codexPlan = await review(fromCodex, { kind: 'plan', file: 'plan.md' })
    expect(codexPlan.body.data).toMatchObject({ kind: 'plan', reviewer: 'claude' })
    expect(deps.calls.map((c) => c.preset)).toEqual(['codex', 'codex', 'codex', 'claude'])
  })

  it('treats a recognized client as authoritative: a conflicting from is refused', async () => {
    const deps = recorder()
    const client = await connect(await repo(), deps, 'claude-code')
    const spoofed = await review(client, {
      kind: 'plan',
      text: 'x',
      from: 'codex',
      reviewer: 'claude',
    })
    expect(spoofed.body).toMatchObject({
      ok: false,
      error: {
        code: 'invalid_argument',
        message: expect.stringContaining('conflicts with the calling client'),
      },
    })
    expect(deps.calls).toHaveLength(0)
  })

  it('accepts a claimed from only from an unrecognized client', async () => {
    const deps = recorder()
    const client = await connect(await repo(), deps, 'cursor')
    const res = await review(client, { kind: 'plan', text: 'x', from: 'codex' })
    expect(res.body.data).toMatchObject({ reviewer: 'claude', routed_by: 'paired_with_caller' })
  })

  it('does not let an agent pick the fake reviewer or pass a root', async () => {
    const client = await connect(await repo(), recorder(), 'claude-code')
    expect((await review(client, { kind: 'plan', text: 'x', reviewer: 'fake' })).isError).toBe(true)
    expect((await review(client, { kind: 'plan', text: 'x', root: '/' })).isError).toBe(true)
  })

  it('returns a coded error envelope for invalid input', async () => {
    const client = await connect(await repo(), recorder(), 'codex-mcp-client')
    const res = await review(client, { kind: 'answer' })
    expect(res.isError).toBe(true)
    expect(res.body).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
  })
})

describe('between review CLI', () => {
  async function runBetween(cwd: string, args: string[], input?: string, env = {}) {
    return execa(
      process.execPath,
      [
        '--import',
        pathToFileURL(join(process.cwd(), 'node_modules/tsx/dist/loader.mjs')).href,
        join(process.cwd(), 'src/cli.ts'),
        ...args,
      ],
      { cwd, reject: false, env, ...(input !== undefined ? { input } : { stdin: 'ignore' }) },
    )
  }

  it('reviews diff, plan file, and stdin answer with --json', async () => {
    const root = await repo()
    const diff = await runBetween(root, ['review', '--reviewer', 'fake', '--json'])
    expect(diff.exitCode).toBe(0)
    expect(JSON.parse(diff.stdout)).toMatchObject({ kind: 'diff', verdict: 'APPROVE' })

    const plan = await runBetween(root, [
      'review',
      '--kind',
      'plan',
      'plan.md',
      '--reviewer',
      'fake',
      '--json',
    ])
    expect(JSON.parse(plan.stdout)).toMatchObject({ kind: 'plan', subject: { label: 'plan.md' } })

    const answer = await runBetween(
      root,
      ['review', '--kind', 'answer', '-', '--reviewer', 'fake', '--json'],
      `An answer. ${FAKE_REQUEST_CHANGES_MARKER}`,
    )
    expect(JSON.parse(answer.stdout)).toMatchObject({
      kind: 'answer',
      verdict: 'REQUEST_CHANGES',
      subject: { source: 'text' },
    })

    const selected = await runBetween(root, [
      'review',
      '--kind',
      'plan',
      '--text',
      'x',
      '--reviewer',
      'fake',
      '--model',
      'gpt-5.5',
      '--json',
    ])
    expect(JSON.parse(selected.stdout)).toMatchObject({ reviewer: 'fake', model: 'gpt-5.5' })
  })

  it('prints a readable verdict and fails cleanly on bad input', async () => {
    const root = await repo()
    const text = await runBetween(root, [
      'review',
      '--kind',
      'plan',
      '--text',
      `x ${FAKE_REQUEST_CHANGES_MARKER}`,
      '--reviewer',
      'fake',
    ])
    expect(text.stdout).toContain('between review: REQUEST_CHANGES (plan, reviewed by fake)')
    expect(text.stdout).toContain('F1 major [correctness]')

    const bad = await runBetween(root, ['review', '--kind', 'essay', '--reviewer', 'fake'])
    expect(bad.exitCode).toBe(1)
    expect(bad.stderr).toContain('--kind must be one of: diff, answer, plan')
  })

  it('installs the Claude Code and Codex shims', async () => {
    const root = await repo()
    const codexHome = await tempDir('between-codex-home-')
    const env = { CODEX_HOME: codexHome }
    expect((await runBetween(root, ['review-shim', 'claude'], undefined, env)).exitCode).toBe(0)
    expect((await runBetween(root, ['review-shim', 'codex'], undefined, env)).exitCode).toBe(0)
    expect(await readFile(join(root, '.claude', 'commands', 'between-review.md'), 'utf8')).toBe(
      reviewShim('claude'),
    )
    expect(await readFile(join(codexHome, 'prompts', 'between-review.md'), 'utf8')).toBe(
      reviewShim('codex'),
    )
    const again = await runBetween(root, ['review-shim', 'claude'], undefined, env)
    expect(again.stdout).toContain('already exists')
  })
})
