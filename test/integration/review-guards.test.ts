import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type RequestListener, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fetchSubjectText, isPublicAddress } from '../../src/review/fetch-subject'
import { reviewerEnv } from '../../src/api/review'

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
    })
    expect(reviewerEnv('codex', root, base)).toEqual({
      PATH: '/usr/bin',
      OPENAI_API_KEY: 'o',
      CODEX_API_KEY: 'x',
    })
  })

  it('drops anything that points into the project and non-runtime variables', () => {
    const env = reviewerEnv('codex', root, {
      PATH: [join(root, 'node_modules', '.bin'), '/usr/bin'].join(delimiter),
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
