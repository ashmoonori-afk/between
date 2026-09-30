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
      `const action = process.argv[3]\n` +
      `process.exit(action === 'get' ? (process.env.BETWEEN_FAKE_REGISTERED ? 0 : 1) : ` +
      `(action === 'remove' && process.env.BETWEEN_FAKE_REMOVE_FAIL ? 1 : 0))\n`,
  )
  if (process.platform === 'win32') {
    await writeFile(
      join(bin, `${cli}.cmd`),
      [
        '@ECHO off',
        'GOTO start',
        ':find_dp0',
        'SET dp0=%~dp0',
        'EXIT /b',
        ':start',
        'SETLOCAL',
        'CALL :find_dp0',
        `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${cli}-impl.cjs" %*`,
        '',
      ].join('\r\n'),
    )
    return
  }
  const shim = join(bin, cli)
  await writeFile(shim, `#!/bin/sh\nexec node "${implementation}" "$@"\n`)
  await chmod(shim, 0o755)
}

describe('between mcp-install CLI', () => {
  it('installs both command files and registers both MCP clients', async () => {
    dir = realpathSync.native(await mkdtemp(join(tmpdir(), 'between-mcp-install-cli-')))
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
          ...(process.platform === 'win32' ? ['cmd', '/c'] : []),
          'npx',
          '-y',
          '--package=between-dev@0.2.0',
          'between-mcp',
          '--allow-review',
        ],
      },
    ])
  })

  it('exits nonzero when Claude is registered outside the local scope', async () => {
    dir = realpathSync.native(await mkdtemp(join(tmpdir(), 'between-mcp-uninstall-cli-')))
    const home = join(dir, 'home')
    const bin = join(dir, 'bin')
    const project = join(dir, 'project')
    const record = join(dir, 'calls.jsonl')
    await Promise.all([mkdir(home), mkdir(bin), mkdir(project)])
    await fakeCli(bin, 'claude', record)

    const result = await execa(
      process.execPath,
      [
        '--import',
        pathToFileURL(join(process.cwd(), 'node_modules/tsx/dist/loader.mjs')).href,
        join(process.cwd(), 'src/cli.ts'),
        'mcp-uninstall',
        'claude',
      ],
      {
        cwd: project,
        reject: false,
        env: {
          ...process.env,
          HOME: home,
          CLAUDE_CONFIG_DIR: join(dir, 'claude'),
          PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
          BETWEEN_FAKE_REGISTERED: '1',
          BETWEEN_FAKE_REMOVE_FAIL: '1',
        },
      },
    )

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('run `claude mcp remove between -s <scope>`')
  })
})
