import { createHash } from 'node:crypto'
import { readFile, mkdir, rmdir, unlink, writeFile } from 'node:fs/promises'
import { homedir as systemHomedir } from 'node:os'
import { dirname, posix, win32 } from 'node:path'
import type { HostAgent } from '../review/direct'

const MARKER_PATTERN =
  /^<!-- between-dev:managed sha256=([a-f0-9]{64}) -- edit freely; between will then leave this file alone -->\r?\n/m

export interface PathOptions {
  readonly platform?: NodeJS.Platform
  readonly env?: NodeJS.ProcessEnv
  readonly homedir?: () => string
}

export type FileStatus =
  | 'installed'
  | 'updated'
  | 'up_to_date'
  | 'removed'
  | 'not_installed'
  | 'skipped_user_edited'

export interface FileResult {
  readonly path: string
  readonly status: FileStatus
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
\`kind: "diff"\` and \`from: "${host}"\`. When provided, pass \`--base <ref>\` as the
\`base\` field and the remaining focus text as the \`focus\` field. If \`--model <name>\`
is present, pass \`model: "<name>"\`; when omitted, do not pass \`model\`.

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
  if (current === null) return { path, status: 'not_installed' }
  if (!isManagedUnmodified(current)) return { path, status: 'skipped_user_edited' }
  await unlink(path)
  if (host === 'codex') await removeEmptyDirectory(dirname(path))
  return { path, status: 'removed' }
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
