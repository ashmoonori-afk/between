import { afterEach, describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execa } from 'execa'
import { CLAUDE_AGENT_SOURCE, CODEX_AGENT_SOURCE } from '../../src/agents/real-agents'

let dir = ''

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = ''
})

/** Put a fake `<cli>` on PATH that records its argv and stdin (a .cmd shim on Windows). */
async function fakeCli(bin: string, cli: string, record: string): Promise<void> {
  const impl = join(bin, `${cli}-impl.cjs`)
  await writeFile(
    impl,
    `const fs = require('fs')\nconst stdin = fs.readFileSync(0, 'utf8')\n` +
      `fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), stdin }))\n`,
  )
  if (process.platform === 'win32') {
    await writeFile(join(bin, `${cli}.cmd`), `@node "%~dp0${cli}-impl.cjs" %*\r\n`)
  } else {
    const shim = join(bin, cli)
    await writeFile(shim, `#!/bin/sh\nexec node "${impl}" "$@"\n`)
    await chmod(shim, 0o755)
  }
}

async function runWrapper(source: string, cli: string) {
  dir = await mkdtemp(join(tmpdir(), 'between-wrapper-'))
  const bin = join(dir, 'bin')
  await mkdir(bin)
  await mkdir(join(dir, '.between', 'signals'), { recursive: true })
  await writeFile(join(dir, '.between', 'signals', 'developer.json'), '{"goal":"demo"}')
  const record = join(dir, 'record.json')
  await fakeCli(bin, cli, record)
  const script = join(dir, `${cli}-agent.mjs`)
  await writeFile(script, source)
  const r = await execa('node', [script, 'developer'], {
    cwd: dir,
    reject: false,
    env: { ...process.env, BETWEEN_ROOT: dir, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` },
  })
  return {
    exitCode: r.exitCode,
    stderr: r.stderr,
    call: JSON.parse(await readFile(record, 'utf8')),
  }
}

describe('generated real-agent wrappers (N4)', () => {
  it('invokes codex with the top-level approval flag before `exec`', async () => {
    const { exitCode, call } = await runWrapper(CODEX_AGENT_SOURCE, 'codex')
    expect(exitCode).toBe(0)
    expect(call.argv).toEqual(['--ask-for-approval', 'never', 'exec'])
    expect(call.stdin).toContain('Your role: developer')
    expect(call.stdin).toContain('{"goal":"demo"}')
  })

  it('invokes claude in print mode with the prompt on stdin', async () => {
    const { exitCode, call } = await runWrapper(CLAUDE_AGENT_SOURCE, 'claude')
    expect(exitCode).toBe(0)
    expect(call.argv).toEqual(['-p', '--output-format', 'text'])
    expect(call.stdin).toContain('Your role: developer')
  })
})
