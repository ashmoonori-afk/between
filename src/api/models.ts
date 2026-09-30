import { mkdir, readFile } from 'node:fs/promises'
import { homedir as osHomedir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { z } from 'zod'
import {
  CLAUDE_MODEL_NOTE,
  CLAUDE_MODELS,
  CODEX_FALLBACK_MODELS,
  parseCodexModels,
  validateModelName,
  type CodexModelCatalog,
} from '../review/models'
import {
  ModelDiscoveryUnavailable,
  runCodexModelCommand,
  type CodexModelCommandDeps,
  type ModelCommandResult,
} from './model-command'

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_FILE = 'review-models.json'

const CacheSchema = z.object({
  version: z.literal(2),
  fetched_at: z.string().datetime(),
  models: z.array(z.string()),
  accepted: z.array(z.string()).min(1),
})

export type ModelSource = 'cli' | 'cache' | 'static'

export interface ReviewerModels {
  readonly source: ModelSource
  readonly models: readonly string[]
  readonly accepted?: readonly string[]
  readonly note?: string
}

export interface ModelsResult {
  readonly claude: ReviewerModels
  readonly codex: ReviewerModels
}

export type { ModelCommandInvocation, ModelCommandResult } from './model-command'

export interface ModelDiscoveryDeps extends CodexModelCommandDeps {
  readonly env?: NodeJS.ProcessEnv
  readonly homedir?: () => string
  readonly now?: () => Date
  readonly platform?: NodeJS.Platform
  readonly runCodexModels?: () => Promise<ModelCommandResult>
}

export interface ListModelsOptions {
  readonly refresh?: boolean
  readonly projectRoot?: string
}

export function modelCacheDir(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string,
): string {
  const paths = platform === 'win32' ? win32 : posix
  if (env.BETWEEN_CACHE_DIR && paths.isAbsolute(env.BETWEEN_CACHE_DIR)) {
    return env.BETWEEN_CACHE_DIR
  }
  if (platform === 'win32') {
    return win32.join(env.LOCALAPPDATA ?? win32.join(home, 'AppData', 'Local'), 'between', 'Cache')
  }
  if (platform === 'darwin') return posix.join(home, 'Library', 'Caches', 'between')
  const xdgCache =
    env.XDG_CACHE_HOME && posix.isAbsolute(env.XDG_CACHE_HOME)
      ? env.XDG_CACHE_HOME
      : posix.join(home, '.cache')
  return posix.join(xdgCache, 'between')
}

export async function listModels(
  options: ListModelsOptions = {},
  deps: ModelDiscoveryDeps = {},
): Promise<ModelsResult> {
  const env = deps.env ?? process.env
  const home = (deps.homedir ?? osHomedir)()
  const now = (deps.now ?? (() => new Date()))()
  const projectRoot = options.projectRoot ?? process.cwd()
  const cacheDir = modelCacheDir(deps.platform ?? process.platform, env, home)
  const cachePath = join(cacheDir, CACHE_FILE)
  const claude: ReviewerModels = {
    source: 'static',
    models: CLAUDE_MODELS,
    note: CLAUDE_MODEL_NOTE,
  }

  if (!options.refresh) {
    const cached = await readCache(cachePath, now)
    if (cached) return { claude, codex: { source: 'cache', ...cached } }
  }

  const run =
    deps.runCodexModels ?? (() => runCodexModelCommand({ baseEnv: env, home, projectRoot }, deps))
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

  let catalog: CodexModelCatalog
  try {
    catalog = parseCodexModels(result.stdout)
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
    await writeFileAtomic(
      cachePath,
      JSON.stringify({ version: 2, fetched_at: now.toISOString(), ...catalog }),
    )
  } catch (error) {
    note = `Models were discovered, but the cache could not be updated: ${errorMessage(error)}`
  }
  return {
    claude,
    codex: { source: 'cli', ...catalog, ...(note ? { note } : {}) },
  }
}

async function readCache(path: string, now: Date): Promise<CodexModelCatalog | null> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
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
    return {
      models: parsed.data.models.map(validateModelName),
      accepted: parsed.data.accepted.map(validateModelName),
    }
  } catch {
    return null
  }
}

function codexFallback(reason: string): ReviewerModels {
  return {
    source: 'static',
    models: CODEX_FALLBACK_MODELS,
    note: `${reason} Using the verified static fallback.`,
  }
}

function commandFailureNote(error: unknown): string {
  if (error instanceof ModelDiscoveryUnavailable) return error.message
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
