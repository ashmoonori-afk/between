import { realpath, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { BETWEEN_VERSION } from '../core/version'
import { buildAgentSandboxEnv } from '../adapters/agent-env'
import { BetweenApiError, toApiError } from '../api/errors'
import { getStatus, summarizeEvents } from '../api/status'
import { runDoctor } from '../api/setup'
import { inspectJournal, replayState, getEvidence } from '../api/records'
import { evaluatePolicy, runConfiguredVerification } from '../api/checks'
import { submitBrokerCommand, type BrokerControl } from '../api/broker'

export interface BetweenMcpOptions {
  /** absolute, canonical project root; every tool is pinned to it (tools take no `root`). */
  root: string
  /** human-granted at startup: register pause/resume/interrupt/review_now/stop/goal/steer. */
  allowControl?: boolean
  /** human-granted at startup: register tools that run repo-configured commands. */
  allowExec?: boolean
}

type Access = 'read' | 'exec' | 'control'

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const
const MUTATING = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const

const ResultEnvelope = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
})

const NoArgs = z.object({}).strict()
const GoalArgs = z.object({ goal: z.string().describe('goal text for the developer') }).strict()

function log(message: string): void {
  process.stderr.write(`between-mcp: ${message}\n`)
}

function envelope(body: z.infer<typeof ResultEnvelope>, isError: boolean): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(body) }],
    structuredContent: { ...body },
    ...(isError ? { isError: true } : {}),
  }
}

/**
 * Resolve the single project root the server is pinned to: `--root` > `BETWEEN_ROOT` > cwd,
 * canonicalized. Refuses a `.between` that resolves outside the root (symlink escape).
 */
export async function resolveServerRoot(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): Promise<string> {
  const candidate = resolve(cwd, explicit || env.BETWEEN_ROOT || cwd)
  let root: string
  try {
    root = await realpath(candidate)
    if (!(await stat(root)).isDirectory()) throw new Error('not a directory')
  } catch {
    throw new BetweenApiError('invalid_argument', `root is not an existing directory: ${candidate}`)
  }
  const stateDir = join(root, '.between')
  if (existsSync(stateDir)) {
    const real = await realpath(stateDir)
    if (!real.startsWith(root + sep)) {
      throw new BetweenApiError('invalid_argument', `.between resolves outside the root: ${real}`)
    }
  }
  return root
}

/**
 * Remove credential-looking variables (the approval secret, gateway/forge tokens, SSH agent, ...)
 * from the server's own environment so tools that spawn processes cannot pass them on. Uses the
 * same classifier the broker applies to agent processes. Returns the removed names.
 */
export function scrubServerEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const { manifest } = buildAgentSandboxEnv({}, { baseEnv: env })
  const removed = manifest.stripped.map((entry) => entry.name)
  for (const name of removed) delete env[name]
  return removed
}

export function createBetweenMcpServer(opts: BetweenMcpOptions): McpServer {
  const { root } = opts
  const server = new McpServer({ name: 'between', version: BETWEEN_VERSION })
  const enabled: Record<Access, boolean> = {
    read: true,
    exec: Boolean(opts.allowExec),
    control: Boolean(opts.allowControl),
  }

  function tool<S extends z.ZodObject>(
    name: string,
    access: Access,
    description: string,
    input: S,
    run: (args: z.infer<S>) => Promise<unknown>,
  ): void {
    if (!enabled[access]) return
    const inputSchema: z.ZodObject = input
    server.registerTool(
      name,
      {
        description,
        inputSchema,
        outputSchema: ResultEnvelope,
        annotations: access === 'read' ? READ_ONLY : MUTATING,
      },
      // the SDK has already validated (and defaulted) args against `input`
      async (args) => {
        try {
          return envelope({ ok: true, data: await run(args as z.infer<S>) }, false)
        } catch (e) {
          const err = toApiError(e)
          if (err.code === 'internal') log(`${name} failed: ${e instanceof Error ? e.stack : e}`)
          // agents cannot run `between init` through MCP, so point them at the human
          const message =
            err.code === 'no_state'
              ? `Between is not initialized in ${root}. Ask the human to run \`npx between-dev init\` there.`
              : err.message
          return envelope({ ok: false, error: { code: err.code, message } }, true)
        }
      },
    )
  }

  const control = (name: string, description: string, command: BrokerControl) =>
    tool(name, 'control', description, NoArgs, () => submitBrokerCommand(root, command))

  tool(
    'between_status',
    'read',
    'Current phase, cycle, waiting actor, diff, agent status, and latest broker event.',
    NoArgs,
    () => getStatus(root),
  )
  tool(
    'between_summarize',
    'read',
    'Event counts from the broker journal, most frequent first.',
    NoArgs,
    () => summarizeEvents(root),
  )
  tool(
    'between_doctor',
    'read',
    'Diagnose git, repo, Between config, vault, and optional pty support.',
    z.object({ strict: z.boolean().default(true) }).strict(),
    ({ strict }) => runDoctor(root, { strict }),
  )
  tool(
    'between_journal',
    'read',
    'Journal entry count and (by default) hash-chain + pinned-head integrity.',
    z.object({ verify: z.boolean().default(true) }).strict(),
    ({ verify }) => inspectJournal(root, { verify }),
  )
  tool(
    'between_replay',
    'read',
    'Reconstruct broker state from the append-only journal (verified by default).',
    z.object({ verify: z.boolean().default(true) }).strict(),
    ({ verify }) => replayState(root, { verify }),
  )
  tool(
    'between_evidence',
    'read',
    'Evidence manifest for the current cycle: bundle, review, verification, approval.',
    NoArgs,
    () => getEvidence(root),
  )

  tool(
    'between_policy',
    'exec',
    'Evaluate the current cycle against policy-as-code. May run a dependency audit.',
    NoArgs,
    () => evaluatePolicy(root),
  )
  tool(
    'between_verify',
    'exec',
    'Run the verification commands configured in .between/config.yaml and persist the report.',
    NoArgs,
    () => runConfiguredVerification(root),
  )

  control('between_pause', 'Queue a pause for the running broker.', { kind: 'pause' })
  control('between_resume', 'Queue a resume for the running broker.', { kind: 'resume' })
  control('between_interrupt', 'Queue an abort of active hosted agents (pauses for steering).', {
    kind: 'interrupt',
  })
  control('between_review_now', 'Queue a forced review of the current diff.', {
    kind: 'review_now',
  })
  control('between_stop', 'Queue a stop for the running broker.', { kind: 'stop' })
  tool(
    'between_goal',
    'control',
    'Queue a new goal for the developer. Queued, not yet applied.',
    GoalArgs,
    ({ goal }) => submitBrokerCommand(root, { kind: 'goal', goal }),
  )
  tool(
    'between_steer',
    'control',
    'Queue a steer for active agents; clears any stale approval. Queued, not yet applied.',
    GoalArgs,
    ({ goal }) => submitBrokerCommand(root, { kind: 'steer_goal', goal }),
  )

  return server
}

export interface RunMcpOptions {
  root?: string
  allowControl?: boolean
  allowExec?: boolean
}

/** Start the stdio MCP server. stdout carries only JSON-RPC; diagnostics go to stderr. */
export async function runMcpServer(opts: RunMcpOptions = {}): Promise<void> {
  const root = await resolveServerRoot(opts.root)
  const removed = scrubServerEnv()
  const server = createBetweenMcpServer({ ...opts, root })
  await server.connect(new StdioServerTransport())
  log(
    `serving ${root} (control: ${opts.allowControl ? 'on' : 'off'}, exec: ${opts.allowExec ? 'on' : 'off'}; scrubbed ${removed.length} credential env var(s))`,
  )
}
