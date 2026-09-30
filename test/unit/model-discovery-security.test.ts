import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  listModels,
  type ModelCommandInvocation,
  type ModelDiscoveryDeps,
} from '../../src/api/models'
import { CODEX_FALLBACK_MODELS } from '../../src/review/models'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function fixture(name: string): Promise<string> {
  return readFile(join(process.cwd(), 'test', 'fixtures', 'models', name), 'utf8')
}

async function baseDeps(platform: NodeJS.Platform): Promise<ModelDiscoveryDeps> {
  const cache = await mkdtemp(join(tmpdir(), 'between-model-security-'))
  dirs.push(cache)
  return {
    env: { BETWEEN_CACHE_DIR: cache },
    homedir: () => (platform === 'win32' ? 'C:\\Users\\tester' : '/Users/tester'),
    now: () => new Date('2026-09-30T12:00:00.000Z'),
    platform,
  }
}

describe('guarded Codex model discovery', () => {
  it('runs a Windows npm cmd-shim through the current Node executable', async () => {
    // Given: guarded resolution found an npm-installed codex.cmd outside the project
    const projectRoot = 'C:\\work\\repo'
    const shim = 'C:\\tools\\bin\\codex.cmd'
    const entry = 'C:\\tools\\node_modules\\@openai\\codex\\bin\\codex.js'
    const calls: ModelCommandInvocation[] = []

    // When: Codex models are refreshed
    const result = await listModels(
      { refresh: true, projectRoot },
      {
        ...(await baseDeps('win32')),
        reviewerEnv: () => ({ PATH: 'C:\\tools\\bin' }),
        resolveReviewerBinary: async (name, resolvedEnv, root) => {
          expect({ name, resolvedEnv, root }).toEqual({
            name: 'codex',
            resolvedEnv: { PATH: 'C:\\tools\\bin' },
            root: projectRoot,
          })
          return shim
        },
        npmShimEntry: async (path) => {
          expect(path).toBe(shim)
          return entry
        },
        runModelCommand: async (invocation) => {
          calls.push(invocation)
          return {
            stdout: await fixture('codex-debug-models.json'),
            stderr: '',
            exitCode: 0,
            timedOut: false,
          }
        },
      },
    )

    // Then: no shell or batch file is executed
    expect(calls).toEqual([
      {
        command: process.execPath,
        args: [entry, 'debug', 'models'],
        cwd: 'C:\\Users\\tester',
        env: { PATH: 'C:\\tools\\bin' },
      },
    ])
    expect(result.codex.source).toBe('cli')
  })

  it('falls back when guarded resolution rejects a project-local binary', async () => {
    // Given: PATH contains only a repository-controlled codex binary
    const projectRoot = '/work/repo'
    let ran = false

    // When: the guarded resolver refuses that path
    const result = await listModels(
      { refresh: true, projectRoot },
      {
        ...(await baseDeps('darwin')),
        reviewerEnv: () => ({ PATH: `${projectRoot}/bin` }),
        resolveReviewerBinary: async (_name, resolvedEnv, root) => {
          expect({ resolvedEnv, root }).toEqual({
            resolvedEnv: { PATH: `${projectRoot}/bin` },
            root: projectRoot,
          })
          return null
        },
        npmShimEntry: async () => null,
        runModelCommand: async () => {
          ran = true
          throw new Error('must not execute')
        },
      },
    )

    // Then: discovery fails closed without executing project code
    expect(ran).toBe(false)
    expect(result.codex).toMatchObject({
      source: 'static',
      note: expect.stringContaining('outside the project'),
    })
  })

  it('falls back instead of executing an unrecognized batch file', async () => {
    // Given: guarded resolution found a batch file that is not an npm cmd-shim
    let ran = false

    // When: models are refreshed
    const result = await listModels(
      { refresh: true, projectRoot: 'C:\\work\\repo' },
      {
        ...(await baseDeps('win32')),
        reviewerEnv: () => ({ PATH: 'C:\\tools\\bin' }),
        resolveReviewerBinary: async () => 'C:\\tools\\bin\\codex.cmd',
        npmShimEntry: async () => null,
        runModelCommand: async () => {
          ran = true
          throw new Error('must not execute')
        },
      },
    )

    // Then: no shell or batch file is executed
    expect(ran).toBe(false)
    expect(result.codex).toMatchObject({
      source: 'static',
      note: expect.stringContaining('not a trusted npm shim'),
    })
  })

  it('falls back when an npm shim entry resolves inside the project', async () => {
    // Given: an external cmd-shim points to repository-controlled JavaScript
    const projectRoot = '/work/repo'
    let ran = false

    // When: models are refreshed
    const result = await listModels(
      { refresh: true, projectRoot },
      {
        ...(await baseDeps('darwin')),
        reviewerEnv: () => ({ PATH: '/tools/bin' }),
        resolveReviewerBinary: async () => '/tools/bin/codex.cmd',
        npmShimEntry: async () => `${projectRoot}/scripts/codex.js`,
        runModelCommand: async () => {
          ran = true
          throw new Error('must not execute')
        },
      },
    )

    // Then: repository JavaScript never receives Codex credentials
    expect(ran).toBe(false)
    expect(result.codex).toMatchObject({
      source: 'static',
      note: expect.stringContaining('inside the project'),
    })
  })

  it('falls back when guarded resolution cannot find Codex', async () => {
    // Given: no installed Codex binary can be resolved
    const result = await listModels(
      { refresh: true, projectRoot: '/work/repo' },
      {
        ...(await baseDeps('darwin')),
        reviewerEnv: () => ({ PATH: '/usr/bin' }),
        resolveReviewerBinary: async () => null,
        npmShimEntry: async () => null,
        runModelCommand: async () => {
          throw new Error('must not execute')
        },
      },
    )

    // Then: the verified static list remains available with a clear reason
    expect(result.codex).toMatchObject({
      source: 'static',
      models: CODEX_FALLBACK_MODELS,
      note: expect.stringContaining('not found'),
    })
  })
})
