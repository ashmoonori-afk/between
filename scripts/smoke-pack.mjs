#!/usr/bin/env node
// Pack-and-run smoke test: proves the packed artifact works through `npx` and as a library,
// independent of the source tree. Usage: `npm run build && npm run smoke:pack`.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '..')
const { name, version } = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
const work = mkdtempSync(join(tmpdir(), 'between-smoke-pack-'))
// a space in the project path catches unquoted-path bugs in bins and MCP client launches
const project = join(work, 'my project')
const consumer = join(work, 'consumer')

function run(cmd, args, cwd, input) {
  return execFileSync(cmd, args, {
    cwd,
    input,
    encoding: 'utf8',
    timeout: 180_000,
    shell: process.platform === 'win32',
    // keep throwaway smoke projects out of the developer's keychain / per-user anchor store
    env: { ...process.env, BETWEEN_JOURNAL_ANCHOR: 'off' },
  }).trim()
}

// Drive a stdio MCP server like a client: initialize, list tools, call between_status. Every
// stdout line must be a JSON-RPC message (stdout pollution breaks real MCP clients).
function mcpSession(npxArgs, cwd) {
  const requests = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'smoke', version: '0' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'between_status', arguments: {} },
    },
  ]
  const stdout = run(
    'npx',
    ['--yes', ...npxArgs],
    cwd,
    requests.map((r) => JSON.stringify(r)).join('\n') + '\n',
  )
  const messages = stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const msg = JSON.parse(line)
      if (msg.jsonrpc !== '2.0') throw new Error(`non-JSON-RPC stdout line: ${line}`)
      return msg
    })
  const byId = new Map(messages.map((m) => [m.id, m]))
  const tools = byId.get(2)?.result?.tools?.map((t) => t.name) ?? []
  const status = byId.get(3)?.result?.structuredContent
  return `server=${byId.get(1)?.result?.serverInfo?.name} tools=${tools.length} approve=${tools.some((t) => t.includes('approve'))} phase=${status?.data?.workflow?.phase}`
}

function check(label, output, expected) {
  if (!output.includes(expected)) {
    throw new Error(`${label}: expected output to include ${JSON.stringify(expected)}\n${output}`)
  }
  process.stdout.write(`ok - ${label}\n`)
}

try {
  // npm 10 still runs `prepare` on pack and its build log shares stdout, so locate the tarball
  // on disk instead of parsing `npm pack --json`.
  run('npm', ['pack', '--pack-destination', work], repo)
  const tarball = join(
    work,
    readdirSync(work).find((f) => f.endsWith('.tgz')),
  )
  const npx = (...args) => run('npx', ['--yes', '--package', tarball, 'between', ...args], project)

  mkdirSync(project)
  run('git', ['init', '-q'], project)
  check('npx between --version', npx('--version'), version)
  check('npx between --help', npx('--help'), 'Usage: between')
  check('npx between init', npx('init', '--agent', 'fake'), 'between: initialized')
  check('npx between status', npx('status'), 'phase:      idle')
  // `npx <package> <cmd>` with no explicit bin: with several bins, npx runs the one named after
  // the package. `file:` makes npx treat the tarball as a package spec, like `npx between-dev`.
  check(
    `npx ${name} status (default bin)`,
    run('npx', ['--yes', `file:${tarball}`, 'status'], project),
    'phase:      idle',
  )
  const expectedMcp = 'server=between tools=6 approve=false phase=idle'
  check(
    'mcp stdio via npx --package <pkg> between-mcp',
    mcpSession(['--package', tarball, 'between-mcp'], project),
    expectedMcp,
  )
  check(
    `mcp stdio via npx ${name} mcp (default bin)`,
    mcpSession([`file:${tarball}`, 'mcp'], project),
    expectedMcp,
  )

  mkdirSync(consumer)
  writeFileSync(
    join(consumer, 'package.json'),
    '{"name":"smoke-consumer","private":true,"type":"module"}\n',
  )
  run('npm', ['install', '--no-audit', '--no-fund', tarball], consumer)
  check(
    'LICENSE shipped in package',
    readFileSync(join(consumer, 'node_modules', name, 'LICENSE'), 'utf8'),
    'MIT License',
  )
  writeFileSync(
    join(consumer, 'consumer.mjs'),
    `import { getStatus } from '${name}'\n` +
      `const status = await getStatus(${JSON.stringify(project)})\n` +
      `console.log('phase=' + status.workflow.phase)\n`,
  )
  check('library import', run('node', ['consumer.mjs'], consumer), 'phase=idle')
  writeFileSync(
    join(consumer, 'human.mjs'),
    `import * as core from '${name}'\n` +
      `import { approve } from '${name}/human'\n` +
      `console.log('human=' + typeof approve + ' core-approve=' + ('approve' in core))\n`,
  )
  check(
    'human-only entry',
    run('node', ['human.mjs'], consumer),
    'human=function core-approve=false',
  )
} finally {
  // Windows keeps a just-exited child's cwd locked briefly (EBUSY); rmSync retries those errors.
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
