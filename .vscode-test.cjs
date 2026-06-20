const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { mkdirSync } = require('node:fs')

const extensionRoot = join(__dirname, 'extensions', 'vscode-between')
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

module.exports = [
  {
    label: 'task-9-diagnostics',
    version: '1.125.1',
    cachePath,
    extensionDevelopmentPath: extensionRoot,
    files: 'extensions/vscode-between/test/vscode-diagnostics.test.mjs',
    workspaceFolder: 'extensions/vscode-between',
    launchArgs,
  },
  {
    label: 'task-9-stale',
    version: '1.125.1',
    cachePath,
    extensionDevelopmentPath: extensionRoot,
    files: 'extensions/vscode-between/test/vscode-stale-diagnostics.test.mjs',
    workspaceFolder: 'extensions/vscode-between',
    launchArgs,
  },
]
