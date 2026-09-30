import { execa } from 'execa'

const DISCOVERY_TIMEOUT_MS = 5_000
const MAX_DISCOVERY_OUTPUT_BYTES = 1024 * 1024

export interface ModelCommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly timedOut: boolean
}

export interface ModelCommandInvocation {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
}

export interface CodexModelCommandDeps {
  readonly reviewerEnv?: (
    preset: 'codex',
    projectRoot: string,
    baseEnv: NodeJS.ProcessEnv,
  ) => Record<string, string>
  readonly resolveReviewerBinary?: (
    name: string,
    env: Record<string, string>,
    projectRoot: string,
  ) => Promise<string | null>
  readonly npmShimEntry?: (shimPath: string) => Promise<string | null>
  readonly runModelCommand?: (invocation: ModelCommandInvocation) => Promise<ModelCommandResult>
}

export class ModelDiscoveryUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelDiscoveryUnavailable'
  }
}

export async function runCodexModelCommand(
  context: {
    readonly baseEnv: NodeJS.ProcessEnv
    readonly home: string
    readonly projectRoot: string
  },
  deps: CodexModelCommandDeps,
): Promise<ModelCommandResult> {
  const guards = await import('./review')
  const env = (deps.reviewerEnv ?? guards.reviewerEnv)(
    'codex',
    context.projectRoot,
    context.baseEnv,
  )
  const binary = await (deps.resolveReviewerBinary ?? guards.resolveReviewerBinary)(
    'codex',
    env,
    context.projectRoot,
  )
  if (!binary) {
    throw new ModelDiscoveryUnavailable('Codex CLI was not found on PATH outside the project.')
  }

  let command = binary
  let args = ['debug', 'models']
  if (/\.(cmd|bat)$/i.test(binary)) {
    const entry = await (deps.npmShimEntry ?? guards.npmShimEntry)(binary)
    if (!entry) {
      throw new ModelDiscoveryUnavailable(
        `Codex resolves to a batch file (${binary}) that is not a trusted npm shim outside the project.`,
      )
    }
    if (guards.isPathInsideProject(context.projectRoot, entry)) {
      throw new ModelDiscoveryUnavailable(
        `Codex npm shim entry (${entry}) resolves inside the project.`,
      )
    }
    command = process.execPath
    args = [entry, ...args]
  }

  const invocation: ModelCommandInvocation = { command, args, cwd: context.home, env }
  if (deps.runModelCommand) return deps.runModelCommand(invocation)
  const result = await execa(invocation.command, [...invocation.args], {
    cwd: invocation.cwd,
    env: { ...invocation.env },
    extendEnv: false,
    timeout: DISCOVERY_TIMEOUT_MS,
    forceKillAfterDelay: 500,
    maxBuffer: MAX_DISCOVERY_OUTPUT_BYTES,
    reject: false,
  })
  return {
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
    exitCode: result.exitCode ?? null,
    timedOut: result.timedOut,
  }
}
