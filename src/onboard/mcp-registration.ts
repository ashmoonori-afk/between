import { execa } from 'execa'
import { npmShimEntry, resolveReviewerBinary } from '../api/review'
import { BETWEEN_VERSION } from '../core/version'
import type { HostAgent } from '../review/direct'

export interface CommandSpec {
  readonly file: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly shell: boolean
}

export interface CommandResult {
  readonly exitCode: number | null
  readonly errorCode?: string
  readonly stdout?: string
}

export interface CommandRunner {
  execute(spec: CommandSpec): Promise<CommandResult>
}

export type RegistrationStatus =
  | 'registered'
  | 'already_registered'
  | 'unregistered'
  | 'not_registered'
  | 'already_registered_pinned'
  | 'skipped_missing_cli'
  | 'skipped_unsupported_batch'
  | 'failed_scope_mismatch'
  | 'failed'

export interface RegistrationResult {
  readonly status: RegistrationStatus
  readonly command?: CommandSpec
  readonly hint?: string
}

export interface RegistrationOptions {
  readonly projectRoot: string
  readonly platform?: NodeJS.Platform
  readonly runner?: CommandRunner
  readonly env?: NodeJS.ProcessEnv
  readonly resolveBinary?: typeof resolveReviewerBinary
  readonly resolveNpmShim?: typeof npmShimEntry
  readonly nodePath?: string
}

export function registrationCommands(
  action: 'install' | 'uninstall',
  host: HostAgent,
  options: Pick<RegistrationOptions, 'projectRoot' | 'platform'>,
): readonly [CommandSpec, CommandSpec] {
  const { projectRoot } = options
  const platform = options.platform ?? process.platform
  const get = { file: host, args: ['mcp', 'get', 'between'], cwd: projectRoot, shell: false }
  if (action === 'uninstall') {
    const removeArgs =
      host === 'claude' ? ['mcp', 'remove', '-s', 'local', 'between'] : ['mcp', 'remove', 'between']
    return [get, { file: host, args: removeArgs, cwd: projectRoot, shell: false }]
  }
  const server = [
    ...(platform === 'win32' ? ['cmd', '/c'] : []),
    'npx',
    '-y',
    `--package=between-dev@${BETWEEN_VERSION}`,
    'between-mcp',
    '--allow-review',
  ]
  const addArgs =
    host === 'claude'
      ? ['mcp', 'add', '-s', 'local', 'between', '--', ...server]
      : ['mcp', 'add', 'between', '--', ...server]
  return [get, { file: host, args: addArgs, cwd: projectRoot, shell: false }]
}

export async function manageMcpRegistration(
  action: 'install' | 'uninstall',
  host: HostAgent,
  options: RegistrationOptions,
): Promise<RegistrationResult> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(options.env ?? process.env)) {
    if (value !== undefined) env[key] = value
  }
  const binary = await (options.resolveBinary ?? resolveReviewerBinary)(
    host,
    env,
    options.projectRoot,
  )
  if (binary === null) return { status: 'skipped_missing_cli' }

  let file = binary
  let prefix: readonly string[] = []
  if (/\.(cmd|bat)$/i.test(binary)) {
    const entry = await (options.resolveNpmShim ?? npmShimEntry)(binary)
    if (entry === null) return { status: 'skipped_unsupported_batch' }
    file = options.nodePath ?? process.execPath
    prefix = [entry]
  }

  const [rawGetCommand, rawChangeCommand] = registrationCommands(action, host, options)
  const getCommand = { ...rawGetCommand, file, args: [...prefix, ...rawGetCommand.args] }
  const changeCommand = {
    ...rawChangeCommand,
    file,
    args: [...prefix, ...rawChangeCommand.args],
  }
  const runner = options.runner ?? commandRunner
  const get = await runner.execute(getCommand)
  if (get.errorCode === 'ENOENT') return { status: 'skipped_missing_cli' }
  if (action === 'install' && get.exitCode === 0) {
    if (host === 'codex' && get.stdout?.includes('--root')) {
      return {
        status: 'already_registered_pinned',
        hint: 'it is pinned with `--root`; to follow the current project, run `codex mcp remove between` then `between mcp-install codex`',
      }
    }
    return { status: 'already_registered' }
  }
  if (action === 'uninstall' && get.exitCode !== 0) return { status: 'not_registered' }
  const result = await runner.execute(changeCommand)
  if (result.errorCode === 'ENOENT') return { status: 'skipped_missing_cli' }
  if (result.exitCode !== 0) {
    if (action === 'uninstall' && host === 'claude') {
      return {
        status: 'failed_scope_mismatch',
        command: changeCommand,
        hint: 'run `claude mcp remove between -s <scope>`',
      }
    }
    return { status: 'failed', command: changeCommand }
  }
  return {
    status: action === 'install' ? 'registered' : 'unregistered',
    command: changeCommand,
  }
}

const commandRunner: CommandRunner = {
  async execute(spec) {
    const result = await execa(spec.file, [...spec.args], {
      cwd: spec.cwd,
      reject: false,
      shell: false,
    })
    const cause: unknown = result.cause
    return {
      exitCode: result.exitCode ?? null,
      stdout: String(result.stdout ?? ''),
      ...(nodeErrorCode(cause) === 'ENOENT' ? { errorCode: 'ENOENT' } : {}),
    }
  },
}

function nodeErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}
