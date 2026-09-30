import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  listModels,
  modelCacheDir,
  type ModelCommandResult,
  type ModelDiscoveryDeps,
} from '../../src/api/models'
import {
  CLAUDE_MODELS,
  CODEX_FALLBACK_MODELS,
  parseCodexModels,
  suggestModels,
  validateModelName,
} from '../../src/review/models'

const fixture = (name: string) =>
  readFile(join(process.cwd(), 'test', 'fixtures', 'models', name), 'utf8')

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function cacheEnv(): Promise<NodeJS.ProcessEnv> {
  const dir = await mkdtemp(join(tmpdir(), 'between-models-'))
  dirs.push(dir)
  return { BETWEEN_CACHE_DIR: dir }
}

function deps(
  env: NodeJS.ProcessEnv,
  runCodexModels: () => Promise<ModelCommandResult>,
): ModelDiscoveryDeps {
  return {
    env,
    homedir: () => '/Users/tester',
    now: () => new Date('2026-09-29T12:00:00.000Z'),
    platform: 'darwin',
    runCodexModels,
  }
}

describe('model parsing and validation', () => {
  it('parses visible Codex models and tolerates unknown fields', async () => {
    // Given: a recorded Codex 0.155.1 model response
    const output = await fixture('codex-debug-models.json')

    // When: the response is parsed
    const models = parseCodexModels(output)

    // Then: only visible model slugs are returned
    expect(models).toEqual(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.5'])
  })

  it('rejects malformed Codex model output', async () => {
    // Given: structurally invalid and unsafe recorded output
    const output = await fixture('codex-debug-models-malformed.json')

    // When/Then: parsing rejects the complete response
    expect(() => parseCodexModels(output)).toThrow()
  })

  it.each(['', '--foo', 'a b', ';rm', 'a'.repeat(101)])('rejects unsafe model name %j', (model) => {
    // Given/When/Then: unsafe boundary input cannot become a CLI argument
    expect(() => validateModelName(model)).toThrow()
  })

  it('accepts aliases, full names, provider separators, and context suffixes', () => {
    // Given: model names supported by the reviewer CLIs
    const models = ['sonnet', 'claude-opus-5-5', 'provider:model.v1', 'sonnet[1m]']

    // When/Then: every safe value is preserved exactly
    expect(models.map(validateModelName)).toEqual(models)
  })

  it('suggests the closest known model names', () => {
    // Given/When: a misspelled authoritative model
    const suggestions = suggestModels('gpt-5.6-so', [
      'gpt-6-astra',
      'gpt-5.6-sol',
      'gpt-5.6-luna',
      'gpt-5.5',
    ])

    // Then: the closest candidate is first and the list is bounded
    expect(suggestions[0]).toBe('gpt-5.6-sol')
    expect(suggestions).toHaveLength(3)
  })

  it('ships small verified static lists for both reviewer CLIs', () => {
    // Given/When/Then: the fallback surface remains deliberately small
    expect({ claude: CLAUDE_MODELS, codex: CODEX_FALLBACK_MODELS }).toEqual({
      claude: ['fable', 'opus', 'sonnet', 'haiku'],
      codex: ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.5'],
    })
  })
})

describe('model discovery fallback', () => {
  it.each([
    {
      name: 'missing CLI',
      run: async () => {
        throw Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' })
      },
    },
    {
      name: 'timeout',
      run: async () => ({ stdout: '', stderr: '', exitCode: null, timedOut: true }),
    },
    {
      name: 'old CLI',
      run: async () => ({
        stdout: '',
        stderr: await fixture('codex-debug-models-old-cli.stderr'),
        exitCode: 2,
        timedOut: false,
      }),
    },
    {
      name: 'malformed output',
      run: async () => ({
        stdout: await fixture('codex-debug-models-malformed.json'),
        stderr: '',
        exitCode: 0,
        timedOut: false,
      }),
    },
  ])('uses static Codex models when discovery hits $name', async ({ run }) => {
    // Given: an isolated cache and a failed best-effort discovery
    const env = await cacheEnv()

    // When: models are listed
    const result = await listModels({}, deps(env, run))

    // Then: startup-safe static data and an explanation are returned
    expect(result.codex).toMatchObject({
      source: 'static',
      models: CODEX_FALLBACK_MODELS,
      note: expect.any(String),
    })
    expect(result.claude).toMatchObject({
      source: 'static',
      models: CLAUDE_MODELS,
      note: expect.stringContaining('does not provide'),
    })
  })
})

describe('model discovery cache', () => {
  it.each([
    {
      platform: 'darwin' as const,
      env: {},
      home: '/Users/tester',
      expected: '/Users/tester/Library/Caches/between',
    },
    {
      platform: 'linux' as const,
      env: { XDG_CACHE_HOME: '/var/cache/tester' },
      home: '/home/tester',
      expected: '/var/cache/tester/between',
    },
    {
      platform: 'linux' as const,
      env: {},
      home: '/home/tester',
      expected: '/home/tester/.cache/between',
    },
    {
      platform: 'win32' as const,
      env: { LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' },
      home: 'C:\\Users\\tester',
      expected: 'C:\\Users\\tester\\AppData\\Local\\between\\Cache',
    },
  ])('resolves the $platform cache directory', ({ platform, env, home, expected }) => {
    // Given/When: an OS-specific environment is resolved
    const path = modelCacheDir(platform, env, home)

    // Then: the native per-user cache convention is used
    expect(path).toBe(expected)
  })

  it('honors BETWEEN_CACHE_DIR on every platform', () => {
    // Given/When: tests or users provide an explicit cache root
    const path = modelCacheDir('win32', { BETWEEN_CACHE_DIR: '/tmp/custom' }, 'C:\\Users\\tester')

    // Then: the override wins unchanged
    expect(path).toBe('/tmp/custom')
  })

  it('serves a fresh cache without running the CLI again', async () => {
    // Given: one successful discovery populated an isolated cache
    const env = await cacheEnv()
    const output = await fixture('codex-debug-models.json')
    let calls = 0
    const run = async () => {
      calls += 1
      return { stdout: output, stderr: '', exitCode: 0, timedOut: false }
    }
    await listModels({}, deps(env, run))

    // When: models are listed again within 24 hours
    const result = await listModels({}, deps(env, run))

    // Then: the cache is authoritative and the CLI was not run again
    expect(result.codex).toMatchObject({
      source: 'cache',
      models: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.5'],
    })
    expect(calls).toBe(1)
  })

  it('rediscovers models after cache expiry', async () => {
    // Given: a cache written more than 24 hours ago
    const env = await cacheEnv()
    const first = await fixture('codex-debug-models.json')
    await listModels(
      {},
      deps(env, async () => ({ stdout: first, stderr: '', exitCode: 0, timedOut: false })),
    )
    const later = {
      ...deps(env, async () => ({
        stdout: JSON.stringify({ models: [{ slug: 'gpt-6-sol', visibility: 'list' }] }),
        stderr: '',
        exitCode: 0,
        timedOut: false,
      })),
      now: () => new Date('2026-09-30T12:00:00.001Z'),
    }

    // When: the expired cache is read
    const result = await listModels({}, later)

    // Then: a fresh CLI result replaces it
    expect(result.codex).toEqual({ source: 'cli', models: ['gpt-6-sol'] })
  })

  it('refresh bypasses a fresh cache', async () => {
    // Given: a fresh populated cache
    const env = await cacheEnv()
    const first = await fixture('codex-debug-models.json')
    await listModels(
      {},
      deps(env, async () => ({ stdout: first, stderr: '', exitCode: 0, timedOut: false })),
    )

    // When: the caller requests a manual refresh
    const result = await listModels(
      { refresh: true },
      deps(env, async () => ({
        stdout: JSON.stringify({ models: [{ slug: 'gpt-6-luna', visibility: 'list' }] }),
        stderr: '',
        exitCode: 0,
        timedOut: false,
      })),
    )

    // Then: the CLI result is used instead of the cache
    expect(result.codex).toEqual({ source: 'cli', models: ['gpt-6-luna'] })
  })
})
