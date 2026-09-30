import { afterEach, describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { execa } from 'execa'

let dir = ''

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = ''
})

async function fakeCli(bin: string, cli: string, record: string): Promise<void> {
  const implementation = join(bin, `${cli}-impl.cjs`)
  await writeFile(
    implementation,
    `const fs = require('fs')\n` +
      `const row = JSON.stringify({ cli: ${JSON.stringify(cli)}, argv: process.argv.slice(2) }) + '\\n'\n` +
      `fs.appendFileSync(${JSON.stringify(record)}, row)\n` +
      `process.exit(process.argv[3] === 'get' ? 1 : 0)\n`,
  )
  if (process.platform === 'win32') {
    await writeFile(join(bin, `${cli}.cmd`), `@node "%~dp0${cli}-impl.cjs" %*\r\n`)
    return
  }
  const shim = join(bin, cli)
  await writeFile(shim, `#!/bin/sh\nexec node "${implementation}" "$@"\n`)
  await chmod(shim, 0o755)
}

describe('between mcp-install CLI', () => {
  it('installs both command files and registers both MCP clients', async () => {
    dir = await mkdtemp(join(tmpdir(), 'between-mcp-install-cli-'))
    const home = join(dir, 'home')
    const claudeHome = join(dir, 'claude')
    const codexHome = join(dir, 'codex')
    const bin = join(dir, 'bin')
    const project = join(dir, 'project')
    const record = join(dir, 'calls.jsonl')
    await Promise.all([mkdir(home), mkdir(bin), mkdir(project)])
    await fakeCli(bin, 'claude', record)
    await fakeCli(bin, 'codex', record)

    const result = await execa(
      process.execPath,
      [
        '--import',
        pathToFileURL(join(process.cwd(), 'node_modules/tsx/dist/loader.mjs')).href,
        join(process.cwd(), 'src/cli.ts'),
        'mcp-install',
      ],
      {
        cwd: project,
        reject: false,
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          CLAUDE_CONFIG_DIR: claudeHome,
          CODEX_HOME: codexHome,
          PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
        },
      },
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Claude Code command: installed')
    expect(result.stdout).toContain('Codex skill: installed')
    expect(await readFile(join(claudeHome, 'commands', 'bqr.md'), 'utf8')).toContain(
      'between-dev:managed',
    )
    expect(await readFile(join(codexHome, 'skills', 'bqr', 'SKILL.md'), 'utf8')).toContain(
      'between-dev:managed',
    )
    const calls = (await readFile(record, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(calls).toEqual([
      { cli: 'claude', argv: ['mcp', 'get', 'between'] },
      {
        cli: 'claude',
        argv: [
          'mcp',
          'add',
          '-s',
          'local',
          'between',
          '--',
          'npx',
          '-y',
          '--package=between-dev@0.2.0',
          'between-mcp',
          '--allow-review',
        ],
      },
      { cli: 'codex', argv: ['mcp', 'get', 'between'] },
      {
        cli: 'codex',
        argv: [
          'mcp',
          'add',
          'between',
          '--',
          'npx',
          '-y',
          '--package=between-dev@0.2.0',
          'between-mcp',
          '--allow-review',
          '--root',
          realpathSync.native(project),
        ],
      },
    ])
  })
})
