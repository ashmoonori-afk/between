#!/usr/bin/env node
// Pack-and-run smoke test: proves the packed artifact works through `npx` and as a library,
// independent of the source tree. Usage: `npm run build && npm run smoke:pack`.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '..')
const { name, version } = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
const work = mkdtempSync(join(tmpdir(), 'between-smoke-pack-'))
const project = join(work, 'project')
const consumer = join(work, 'consumer')

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  }).trim()
}

function check(label, output, expected) {
  if (!output.includes(expected)) {
    throw new Error(`${label}: expected output to include ${JSON.stringify(expected)}\n${output}`)
  }
  process.stdout.write(`ok - ${label}\n`)
}

try {
  const packed = JSON.parse(
    run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', work], repo),
  )
  const tarball = join(work, packed[0].filename)
  const npx = (...args) => run('npx', ['--yes', '--package', tarball, 'between', ...args], project)

  mkdirSync(project)
  run('git', ['init', '-q'], project)
  check('npx between --version', npx('--version'), version)
  check('npx between --help', npx('--help'), 'Usage: between')
  check('npx between init', npx('init', '--agent', 'fake'), 'between: initialized')
  check('npx between status', npx('status'), 'phase:      idle')

  mkdirSync(consumer)
  writeFileSync(
    join(consumer, 'package.json'),
    '{"name":"smoke-consumer","private":true,"type":"module"}\n',
  )
  run('npm', ['install', '--no-audit', '--no-fund', tarball], consumer)
  writeFileSync(
    join(consumer, 'consumer.mjs'),
    `import { getStatus } from '${name}'\n` +
      `const status = await getStatus(${JSON.stringify(project)})\n` +
      `console.log('phase=' + status.workflow.phase)\n`,
  )
  check('library import', run('node', ['consumer.mjs'], consumer), 'phase=idle')
} finally {
  rmSync(work, { recursive: true, force: true })
}
