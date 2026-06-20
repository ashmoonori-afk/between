import { defineConfig } from '@vscode/test-cli'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const workspaceFolder = process.cwd()
const runRoot = join(tmpdir(), 'between-vscode-test')
const userDataDir = join(runRoot, 'user-data')
const extensionsDir = join(runRoot, 'extensions')
const cachePath = join(runRoot, 'cache')
mkdirSync(cachePath, { recursive: true })
mkdirSync(userDataDir, { recursive: true })
mkdirSync(extensionsDir, { recursive: true })
const launchArgs = [
  '--disable-workspace-trust',
  '--user-data-dir',
  userDataDir,
  '--extensions-dir',
  extensionsDir,
]

export default defineConfig([
  {
    label: 'task-9-diagnostics',
    version: '1.125.1',
    cachePath,
    files: 'test/vscode-diagnostics.test.mjs',
    workspaceFolder,
    launchArgs,
  },
  {
    label: 'task-9-stale',
    version: '1.125.1',
    cachePath,
    files: 'test/vscode-stale-diagnostics.test.mjs',
    workspaceFolder,
    launchArgs,
  },
])
