import { createHash } from 'node:crypto'
import { readFile, mkdir, rmdir, unlink, writeFile } from 'node:fs/promises'
import { homedir as systemHomedir } from 'node:os'
import { dirname, posix, win32 } from 'node:path'
import { execa } from 'execa'
import { BETWEEN_VERSION } from '../core/version'
import type { HostAgent } from '../review/direct'

const MARKER_PATTERN =
  /^<!-- between-dev:managed sha256=([a-f0-9]{64}) -- edit freely; between will then leave this file alone -->\r?\n/m

export interface PathOptions {
  readonly platform?: NodeJS.Platform
  readonly env?: NodeJS.ProcessEnv
  readonly homedir?: () => string
}

export type FileStatus = 'installed' | 'updated' | 'up_to_date' | 'removed' | 'skipped_user_edited'

export interface FileResult {
  readonly path: string
  readonly status: FileStatus
}

export interface CommandSpec {
  readonly file: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly shell: boolean
}

export interface CommandResult {
  readonly exitCode: number | null
  readonly errorCode?: string
}

export interface CommandRunner {
  execute(spec: CommandSpec): Promise<CommandResult>
}

export type RegistrationStatus =
  | 'registered'
  | 'already_registered'
  | 'unregistered'
  | 'not_registered'
  | 'skipped_missing_cli'
  | 'failed'

export interface RegistrationResult {
  readonly status: RegistrationStatus
  readonly command?: CommandSpec
}

export interface RegistrationOptions {
  readonly projectRoot: string
  readonly platform?: NodeJS.Platform
  readonly runner?: CommandRunner
}

export function quickReviewPath(host: HostAgent, options: PathOptions = {}): string {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const home = env.HOME || env.USERPROFILE || (options.homedir ?? systemHomedir)()
  const paths = platform === 'win32' ? win32 : posix
  if (host === 'claude') {
    return paths.join(env.CLAUDE_CONFIG_DIR || paths.join(home, '.claude'), 'commands', 'bqr.md')
  }
  return paths.join(env.CODEX_HOME || paths.join(home, '.codex'), 'skills', 'bqr', 'SKILL.md')
}

export function renderQuickReviewCommand(host: HostAgent): string {
  const invocation = host === 'claude' ? '/bqr' : '$bqr'
  const frontmatter =
    host === 'claude'
      ? '---\ndescription: Ask Between for a quick review of the current diff\nargument-hint: "[--model <name>] [focus...]"\n---\n'
      : '---\nname: bqr\ndescription: Ask Between for a quick review of the current diff\n---\n'
  const content = `${frontmatter}
Usage: ${invocation} [--model <name>] [focus...]

Review the current working-tree diff against HEAD. Treat \`--base <ref>\` as the comparison
base and remaining arguments as the focus. Call the \`between_review\` MCP tool with
\`kind: "diff"\` and \`from: "${host}"\`. If \`--model <name>\` is present, pass \`model:
"<name>"\`; when omitted, do not pass \`model\`.

If the tool is unavailable and a model was provided, run
\`npx -y between-dev review --from ${host} --model <name> --json\`; otherwise omit the
\`--model\` option. Add \`--base <ref>\` and \`--focus "<focus>"\` only when provided. To
see available models, run \`npx -y between-dev models\`.

Print the verdict (APPROVE or REQUEST_CHANGES), summary, and findings with severity and
location. Do not apply fixes unless asked.
`
  const hash = createHash('sha256').update(content).digest('hex')
  const marker = `<!-- between-dev:managed sha256=${hash} -- edit freely; between will then leave this file alone -->\n`
  return content.replace(frontmatter, `${frontmatter}${marker}`)
}

export async function installQuickReviewCommand(
  host: HostAgent,
  options: PathOptions = {},
): Promise<FileResult> {
  const path = quickReviewPath(host, options)
  const next = renderQuickReviewCommand(host)
  const current = await readOptional(path)
  if (current === null) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, next, 'utf8')
    return { path, status: 'installed' }
  }
  if (!isManagedUnmodified(current)) return { path, status: 'skipped_user_edited' }
  if (current === next) return { path, status: 'up_to_date' }
  await writeFile(path, next, 'utf8')
  return { path, status: 'updated' }
}

export async function uninstallQuickReviewCommand(
  host: HostAgent,
  options: PathOptions = {},
): Promise<FileResult> {
  const path = quickReviewPath(host, options)
  const current = await readOptional(path)
  if (current === null) return { path, status: 'removed' }
  if (!isManagedUnmodified(current)) return { path, status: 'skipped_user_edited' }
  await unlink(path)
  if (host === 'codex') await removeEmptyDirectory(dirname(path))
  return { path, status: 'removed' }
}

export function registrationCommands(
  action: 'install' | 'uninstall',
  host: HostAgent,
  options: Pick<RegistrationOptions, 'projectRoot' | 'platform'>,
): readonly [CommandSpec, CommandSpec] {
  const { projectRoot } = options
  const platform = options.platform ?? process.platform
  const shell = platform === 'win32'
  const get = { file: host, args: ['mcp', 'get', 'between'], cwd: projectRoot, shell }
  if (action === 'uninstall') {
    const removeArgs =
      host === 'claude' ? ['mcp', 'remove', '-s', 'local', 'between'] : ['mcp', 'remove', 'between']
    return [get, { file: host, args: removeArgs, cwd: projectRoot, shell }]
  }
  const server = [
    ...(platform === 'win32' ? ['cmd', '/c'] : []),
    'npx',
    '-y',
    `--package=between-dev@${BETWEEN_VERSION}`,
    'between-mcp',
    '--allow-review',
    ...(host === 'codex' ? ['--root', projectRoot] : []),
  ]
  const addArgs =
    host === 'claude'
      ? ['mcp', 'add', '-s', 'local', 'between', '--', ...server]
      : ['mcp', 'add', 'between', '--', ...server]
  return [get, { file: host, args: addArgs, cwd: projectRoot, shell }]
}

export async function manageMcpRegistration(
  action: 'install' | 'uninstall',
  host: HostAgent,
  options: RegistrationOptions,
): Promise<RegistrationResult> {
  const [getCommand, changeCommand] = registrationCommands(action, host, options)
  const runner = options.runner ?? commandRunner
  const get = await runner.execute(getCommand)
  if (get.errorCode === 'ENOENT') return { status: 'skipped_missing_cli' }
  if (action === 'install' && get.exitCode === 0) return { status: 'already_registered' }
  if (action === 'uninstall' && get.exitCode !== 0) return { status: 'not_registered' }
  const result = await runner.execute(changeCommand)
  if (result.errorCode === 'ENOENT') return { status: 'skipped_missing_cli' }
  if (result.exitCode !== 0) return { status: 'failed', command: changeCommand }
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
      shell: spec.shell,
    })
    const cause: unknown = result.cause
    const missingFromShell =
      spec.shell &&
      /not recognized as an internal or external command|not recognized as the name/i.test(
        String(result.stderr ?? ''),
      )
    return {
      exitCode: result.exitCode ?? null,
      ...(nodeErrorCode(cause) === 'ENOENT'
        ? { errorCode: 'ENOENT' }
        : missingFromShell
          ? { errorCode: 'ENOENT' }
          : {}),
    }
  },
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error: unknown) {
    if (nodeErrorCode(error) === 'ENOENT') return null
    throw error
  }
}

function isManagedUnmodified(content: string): boolean {
  const marker = MARKER_PATTERN.exec(content)
  if (!marker) return false
  const withoutMarker = content.replace(MARKER_PATTERN, '')
  return createHash('sha256').update(withoutMarker).digest('hex') === marker[1]
}

async function removeEmptyDirectory(path: string): Promise<void> {
  try {
    await rmdir(path)
  } catch (error: unknown) {
    const code = nodeErrorCode(error)
    if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') throw error
  }
}

function nodeErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}
