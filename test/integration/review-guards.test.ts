import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type RequestListener, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, join, relative } from 'node:path'
import { realpathSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { execa } from 'execa'
import { fetchSubjectText, isPublicAddress } from '../../src/review/fetch-subject'
import {
  makeReviewerWorkdir,
  npmShimEntry,
  resolveReviewerBinary,
  reviewerEnv,
} from '../../src/api/review'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
  )
})

async function serve(handler: RequestListener): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

const LIMITS = { maxBytes: 1024, timeoutMs: 10_000 }
const onlyLoopback = (address: string) => address === '127.0.0.1'

describe('isPublicAddress', () => {
  it('refuses loopback, private, link-local, and mapped addresses', () => {
    for (const a of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:10.0.0.1',
      'fec0::1',
      '64:ff9b::7f00:1',
      '64:ff9b:1::1',
      '::ffff:0:7f00:1',
      '::7f00:1',
      '::1.2.3.4',
      '2001::1',
      '2001:db8::1',
      '2002:7f00:1::1',
      '3fff::1',
      'ff02::1',
      'not-an-ip',
    ]) {
      expect(isPublicAddress(a), a).toBe(false)
    }
    for (const a of [
      '8.8.8.8',
      '1.1.1.1',
      '2606:4700::1111',
      '2a00:1450:4001::1',
      '::ffff:8.8.8.8',
    ]) {
      expect(isPublicAddress(a), a).toBe(true)
    }
  })
})

describe('fetchSubjectText', () => {
  it('refuses loopback by IP literal and by host name with the default guard', async () => {
    const base = await serve((_req, res) => res.end('secret'))
    await expect(fetchSubjectText(`${base}/`, LIMITS)).rejects.toThrow(/non-public address/)
    const byName = base.replace('127.0.0.1', 'localhost')
    await expect(fetchSubjectText(`${byName}/`, LIMITS)).rejects.toThrow(/non-public address/)
  })

  it('re-checks every redirect hop', async () => {
    const base = await serve((req, res) => {
      if (req.url === '/ok') return res.end('# plan')
      if (req.url === '/hop') {
        res.writeHead(302, { location: '/ok' })
        return res.end()
      }
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
      res.end()
    })
    const opts = { ...LIMITS, allowAddress: onlyLoopback }
    expect(await fetchSubjectText(`${base}/hop`, opts)).toBe('# plan')
    await expect(fetchSubjectText(`${base}/metadata`, opts)).rejects.toThrow(
      /non-public address: 169\.254\.169\.254/,
    )
  })

  it('aborts a streamed body past the byte limit', async () => {
    const base = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.write('x'.repeat(800))
      res.end('y'.repeat(800))
    })
    await expect(
      fetchSubjectText(`${base}/`, { ...LIMITS, allowAddress: onlyLoopback }),
    ).rejects.toThrow(/exceeds the 1024-byte limit/)
  })
})

describe('reviewerEnv', () => {
  const base = {
    PATH: '/usr/bin',
    ANTHROPIC_API_KEY: 'a',
    CLAUDE_CODE_OAUTH_TOKEN: 'c',
    OPENAI_API_KEY: 'o',
    CODEX_API_KEY: 'x',
    GITHUB_TOKEN: 'g',
  }

  const root = join(tmpdir(), 'between-guard-project')

  it("passes only the reviewer's own provider credentials", () => {
    expect(reviewerEnv('claude', root, base)).toEqual({
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'a',
      CLAUDE_CODE_OAUTH_TOKEN: 'c',
      CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
    })
    expect(reviewerEnv('codex', root, base)).toEqual({
      PATH: '/usr/bin',
      OPENAI_API_KEY: 'o',
      CODEX_API_KEY: 'x',
    })
  })

  it('drops anything that points into the project and non-runtime variables', () => {
    const env = reviewerEnv('codex', root, {
      PATH: [join(root, 'node_modules', '.bin'), 'relative/bin', '.', '/usr/bin'].join(delimiter),
      HOME: '/home/u',
      BETWEEN_ROOT: root,
      INIT_CWD: root,
      PWD: root,
      TMPDIR: join(root, 'tmp'),
      npm_package_json: join(root, 'package.json'),
      SOME_APP_SETTING: 'x',
    })
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/u' })
  })
})

describe('reviewer isolation from the project (canonical paths)', () => {
  const made: string[] = []
  afterEach(async () => {
    await Promise.all(made.splice(0).map((d) => rm(d, { recursive: true, force: true })))
  })

  async function dir(prefix: string): Promise<string> {
    const d = realpathSync.native(await mkdtemp(join(tmpdir(), prefix)))
    made.push(d)
    return d
  }

  async function fakeCli(binDir: string, name: string): Promise<void> {
    await mkdir(binDir, { recursive: true })
    const file = join(binDir, process.platform === 'win32' ? `${name}.cmd` : name)
    await writeFile(
      file,
      process.platform === 'win32'
        ? '@echo off\r\necho fake-cli-ok\r\n'
        : '#!/bin/sh\necho fake-cli-ok\n',
    )
    await chmod(file, 0o755)
  }

  it('drops env paths that reach the project through a symlink alias', async () => {
    const root = await dir('between-iso-root-')
    const aliasParent = await dir('between-iso-alias-')
    const alias = join(aliasParent, 'link')
    await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await mkdir(join(root, 'bin'))
    await mkdir(join(root, '.claude'))
    const env = reviewerEnv('claude', root, {
      PATH: [join(alias, 'bin'), '/usr/bin'].join(delimiter),
      CLAUDE_CONFIG_DIR: join(alias, '.claude'),
      HOME: '/home/u',
    })
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/u',
      CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
    })
  })

  it('never resolves a reviewer binary that lives inside the project', async () => {
    const root = await dir('between-iso-root-')
    const outside = await dir('between-iso-outside-')
    await fakeCli(join(root, 'bin'), 'codex')
    await fakeCli(join(outside, 'bin'), 'codex')
    const aliasParent = await dir('between-iso-alias-')
    const alias = join(aliasParent, 'link')
    await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir')
    // the project copy comes first on PATH, once directly and once through an alias
    const PATH = [join(alias, 'bin'), join(root, 'bin'), join(outside, 'bin')].join(delimiter)
    const found = await resolveReviewerBinary('codex', { PATH }, root)
    // the canonical absolute path of the checked file, runnable from any cwd
    expect(found).toBe(
      realpathSync.native(
        join(outside, 'bin', process.platform === 'win32' ? 'codex.cmd' : 'codex'),
      ),
    )
    const ran = await execa(found!, [], { cwd: aliasParent })
    expect(ran.stdout.trim()).toBe('fake-cli-ok')
    expect(await resolveReviewerBinary('codex', { PATH: join(root, 'bin') }, root)).toBeNull()
  })

  it('ignores relative PATH entries (they would resolve against a different cwd)', async () => {
    const root = await dir('between-iso-root-')
    const outside = await dir('between-iso-outside-')
    await fakeCli(join(outside, 'bin'), 'codex')
    const PATH = relative(process.cwd(), join(outside, 'bin'))
    expect(await resolveReviewerBinary('codex', { PATH }, root)).toBeNull()
  })

  it('resolves an npm cmd-shim to its JS entry instead of running the batch file', async () => {
    const npmBin = await dir('between-iso-npm-')
    const entry = join(npmBin, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
    await mkdir(join(npmBin, 'node_modules', '@openai', 'codex', 'bin'), { recursive: true })
    await writeFile(entry, '')
    // the shape npm's cmd-shim writes for a global bin
    await writeFile(
      join(npmBin, 'codex.cmd'),
      [
        '@ECHO off',
        'GOTO start',
        ':find_dp0',
        'SET dp0=%~dp0',
        'EXIT /b',
        ':start',
        'SETLOCAL',
        'CALL :find_dp0',
        'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
        '',
      ].join('\r\n'),
    )
    expect(await npmShimEntry(join(npmBin, 'codex.cmd'))).toBe(realpathSync.native(entry))
    await writeFile(join(npmBin, 'other.cmd'), '@echo off\r\n"C:\\tools\\evil.exe" %*\r\n')
    expect(await npmShimEntry(join(npmBin, 'other.cmd'))).toBeNull()
  })

  it.skipIf(process.platform === 'win32')(
    'a shebang interpreter is never looked up in the project (end to end)',
    async () => {
      const root = await dir('between-iso-root-')
      const outside = await dir('between-iso-outside-')
      const workParent = await dir('between-iso-work-')
      const work = join(workParent, 'w')
      await mkdir(work)
      const interp = (dirPath: string, tag: string) =>
        mkdir(dirPath, { recursive: true }).then(async () => {
          const file = join(dirPath, 'between-fake-node')
          await writeFile(file, `#!/bin/sh\necho ${tag}\n`)
          await chmod(file, 0o755)
        })
      await interp(join(root, 'bin'), 'project-interpreter')
      await interp(join(outside, 'interp'), 'trusted-interpreter')
      await mkdir(join(outside, 'bin'))
      const cli = join(outside, 'bin', 'codex')
      await writeFile(cli, '#!/usr/bin/env between-fake-node\n')
      await chmod(cli, 0o755)
      // a relative PATH entry that, from the reviewer's temp cwd, points back into the project
      const sneaky = relative(work, join(root, 'bin'))
      const env = reviewerEnv('codex', root, {
        PATH: [
          sneaky,
          join(root, 'bin'),
          join(outside, 'interp'),
          join(outside, 'bin'),
          '/usr/bin',
          '/bin',
        ].join(delimiter),
      })
      const binary = await resolveReviewerBinary('codex', env, root)
      expect(binary).toBe(realpathSync.native(cli))
      const ran = await execa(binary!, [], { cwd: work, env, extendEnv: false })
      expect(ran.stdout.trim()).toBe('trusted-interpreter')
    },
  )

  it('fails closed when the temp base is inside the project, and cleans up', async () => {
    const root = await dir('between-iso-root-')
    await expect(makeReviewerWorkdir(root, root)).rejects.toMatchObject({
      code: 'reviewer_failed',
    })
    expect((await readdir(root)).filter((n) => n.startsWith('between-review-'))).toEqual([])
    const ok = await makeReviewerWorkdir(root)
    made.push(ok.created)
    expect(ok.workdir.startsWith(root)).toBe(false)
  })
})
