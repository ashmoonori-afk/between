import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir as osHomedir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { execa } from 'execa'
import { z } from 'zod'
import {
  CLAUDE_MODELS,
  CODEX_FALLBACK_MODELS,
  parseCodexModels,
  validateModelName,
} from '../review/models'

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const DISCOVERY_TIMEOUT_MS = 5_000
const MAX_DISCOVERY_OUTPUT_BYTES = 1024 * 1024
const CACHE_FILE = 'review-models.json'

const CacheSchema = z.object({
  version: z.literal(1),
  fetched_at: z.string().datetime(),
  models: z.array(z.string()).min(1),
})

export type ModelSource = 'cli' | 'cache' | 'static'

export interface ReviewerModels {
  readonly source: ModelSource
  readonly models: readonly string[]
  readonly note?: string
}

export interface ModelsResult {
  readonly claude: ReviewerModels
  readonly codex: ReviewerModels
}

export interface ModelCommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly timedOut: boolean
}

export interface ModelDiscoveryDeps {
  readonly env?: NodeJS.ProcessEnv
  readonly homedir?: () => string
  readonly now?: () => Date
  readonly platform?: NodeJS.Platform
  readonly runCodexModels?: () => Promise<ModelCommandResult>
}

export interface ListModelsOptions {
  readonly refresh?: boolean
}

export function modelCacheDir(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string,
): string {
  if (env.BETWEEN_CACHE_DIR) return env.BETWEEN_CACHE_DIR
  if (platform === 'win32') {
    return win32.join(env.LOCALAPPDATA ?? win32.join(home, 'AppData', 'Local'), 'between', 'Cache')
  }
  if (platform === 'darwin') return posix.join(home, 'Library', 'Caches', 'between')
  return posix.join(env.XDG_CACHE_HOME ?? posix.join(home, '.cache'), 'between')
}

export async function listModels(
  options: ListModelsOptions = {},
  deps: ModelDiscoveryDeps = {},
): Promise<ModelsResult> {
  const env = deps.env ?? process.env
  const home = (deps.homedir ?? osHomedir)()
  const now = (deps.now ?? (() => new Date()))()
  const cacheDir = modelCacheDir(deps.platform ?? process.platform, env, home)
  const cachePath = join(cacheDir, CACHE_FILE)
  const claude: ReviewerModels = {
    source: 'static',
    models: CLAUDE_MODELS,
    note: 'Claude Code does not provide a reliable machine-readable model listing command.',
  }

  if (!options.refresh) {
    const cached = await readCache(cachePath, now)
    if (cached) return { claude, codex: { source: 'cache', models: cached } }
  }

  const run = deps.runCodexModels ?? (() => runCodexModelCommand(env, home))
  let result: ModelCommandResult
  try {
    result = await run()
  } catch (error) {
    return { claude, codex: codexFallback(commandFailureNote(error)) }
  }
  if (result.timedOut) {
    return {
      claude,
      codex: codexFallback('Codex model discovery timed out after 5 seconds.'),
    }
  }
  if (result.exitCode !== 0) {
    return {
      claude,
      codex: codexFallback(
        `Codex model discovery exited with code ${result.exitCode ?? 'unknown'}.`,
      ),
    }
  }

  let models: readonly string[]
  try {
    models = parseCodexModels(result.stdout)
  } catch (error) {
    return {
      claude,
      codex: codexFallback(
        error instanceof Error
          ? error.message
          : 'Codex model discovery output could not be parsed.',
      ),
    }
  }

  let note: string | undefined
  try {
    await mkdir(cacheDir, { recursive: true })
    await writeFile(
      cachePath,
      JSON.stringify({ version: 1, fetched_at: now.toISOString(), models }),
      'utf8',
    )
  } catch (error) {
    note = `Models were discovered, but the cache could not be updated: ${errorMessage(error)}`
  }
  return {
    claude,
    codex: { source: 'cli', models, ...(note ? { note } : {}) },
  }
}

async function readCache(path: string, now: Date): Promise<readonly string[] | null> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    return null
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = CacheSchema.safeParse(value)
  if (!parsed.success) return null
  const age = now.getTime() - new Date(parsed.data.fetched_at).getTime()
  if (age < 0 || age > CACHE_TTL_MS) return null
  try {
    return parsed.data.models.map(validateModelName)
  } catch {
    return null
  }
}

async function runCodexModelCommand(
  env: NodeJS.ProcessEnv,
  home: string,
): Promise<ModelCommandResult> {
  const result = await execa('codex', ['debug', 'models'], {
    cwd: home,
    env: discoveryEnv(env),
    extendEnv: false,
    timeout: DISCOVERY_TIMEOUT_MS,
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

function discoveryEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const allowed = new Set([
    'PATH',
    'PATHEXT',
    'SYSTEMROOT',
    'WINDIR',
    'HOME',
    'USER',
    'LOGNAME',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'APPDATA',
    'LOCALAPPDATA',
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TZ',
    'TERM',
    'NO_COLOR',
    'CODEX_HOME',
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
    'XDG_CACHE_HOME',
  ])
  return Object.fromEntries(
    Object.entries(base).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && allowed.has(entry[0].toUpperCase()),
    ),
  )
}

function codexFallback(reason: string): ReviewerModels {
  return {
    source: 'static',
    models: CODEX_FALLBACK_MODELS,
    note: `${reason} Using the verified static fallback.`,
  }
}

function commandFailureNote(error: unknown): string {
  if (errorCode(error) === 'ENOENT') return 'Codex CLI was not found.'
  return `Codex model discovery could not start: ${errorMessage(error)}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}
