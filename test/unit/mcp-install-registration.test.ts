import { describe, expect, it } from 'vitest'
import {
  manageMcpRegistration,
  type CommandRunner,
  type CommandSpec,
} from '../../src/onboard/mcp-registration'

class FakeRunner implements CommandRunner {
  readonly calls: CommandSpec[] = []

  constructor(
    private readonly run: (spec: CommandSpec) => {
      readonly exitCode: number | null
      readonly errorCode?: string
      readonly stdout?: string
    },
  ) {}

  async execute(spec: CommandSpec) {
    this.calls.push(spec)
    return this.run(spec)
  }
}

describe('MCP registration', () => {
  it('builds Claude and Codex registration commands on Unix', async () => {
    const runner = new FakeRunner((spec) => ({ exitCode: spec.args[1] === 'get' ? 1 : 0 }))
    const root = '/repo'
    const resolveBinary = async (name: string) => `/usr/bin/${name}`

    expect(
      await manageMcpRegistration('install', 'claude', {
        projectRoot: root,
        platform: 'darwin',
        runner,
        resolveBinary,
      }),
    ).toMatchObject({ status: 'registered' })
    expect(
      await manageMcpRegistration('install', 'codex', {
        projectRoot: root,
        platform: 'linux',
        runner,
        resolveBinary,
      }),
    ).toMatchObject({ status: 'registered' })
    expect(runner.calls).toEqual([
      { file: '/usr/bin/claude', args: ['mcp', 'get', 'between'], cwd: root, shell: false },
      {
        file: '/usr/bin/claude',
        args: [
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
        cwd: root,
        shell: false,
      },
      { file: '/usr/bin/codex', args: ['mcp', 'get', 'between'], cwd: root, shell: false },
      {
        file: '/usr/bin/codex',
        args: [
          'mcp',
          'add',
          'between',
          '--',
          'npx',
          '-y',
          '--package=between-dev@0.2.0',
          'between-mcp',
          '--allow-review',
        ],
        cwd: root,
        shell: false,
      },
    ])
  })

  it('passes a space-containing Windows root as one argv entry without a shell', async () => {
    const runner = new FakeRunner((spec) => ({ exitCode: spec.args.includes('get') ? 1 : 0 }))
    const root = String.raw`C:\Users\John Doe\proj`

    await manageMcpRegistration('install', 'codex', {
      projectRoot: root,
      platform: 'win32',
      runner,
      resolveBinary: async () => String.raw`C:\Program Files\Codex\codex.exe`,
    })

    expect(runner.calls[1]).toMatchObject({
      file: String.raw`C:\Program Files\Codex\codex.exe`,
      shell: false,
      args: expect.arrayContaining(['cmd', '/c', 'npx']),
    })
    expect(runner.calls[1]?.args).not.toContain(root)
  })

  it('runs a Windows npm cmd shim through Node and its JavaScript entry', async () => {
    const runner = new FakeRunner((spec) => ({ exitCode: spec.args.includes('get') ? 1 : 0 }))
    const entry = String.raw`C:\Program Files\node_modules\codex\bin\codex.js`

    expect(
      await manageMcpRegistration('install', 'codex', {
        projectRoot: String.raw`C:\repo`,
        platform: 'win32',
        runner,
        resolveBinary: async () => String.raw`C:\Program Files\codex.cmd`,
        resolveNpmShim: async () => entry,
        nodePath: String.raw`C:\Program Files\node.exe`,
      }),
    ).toMatchObject({ status: 'registered' })
    expect(runner.calls[0]).toEqual({
      file: String.raw`C:\Program Files\node.exe`,
      args: [entry, 'mcp', 'get', 'between'],
      cwd: String.raw`C:\repo`,
      shell: false,
    })
  })

  it('refuses a Windows batch file that is not an npm shim', async () => {
    const runner = new FakeRunner(() => ({ exitCode: 0 }))

    expect(
      await manageMcpRegistration('install', 'claude', {
        projectRoot: String.raw`C:\repo`,
        platform: 'win32',
        runner,
        resolveBinary: async () => String.raw`C:\tools\claude.bat`,
        resolveNpmShim: async () => null,
      }),
    ).toMatchObject({ status: 'skipped_unsupported_batch' })
    expect(runner.calls).toHaveLength(0)
  })

  it('skips registered and missing host CLIs without failing', async () => {
    const registered = new FakeRunner(() => ({ exitCode: 0 }))
    const missing = new FakeRunner(() => ({ exitCode: 0 }))

    expect(
      await manageMcpRegistration('install', 'claude', {
        projectRoot: '/repo',
        platform: 'linux',
        runner: registered,
        resolveBinary: async () => '/usr/bin/claude',
      }),
    ).toMatchObject({ status: 'already_registered' })
    expect(
      await manageMcpRegistration('install', 'codex', {
        projectRoot: '/repo',
        platform: 'linux',
        runner: missing,
        resolveBinary: async () => null,
      }),
    ).toMatchObject({ status: 'skipped_missing_cli' })
  })

  it('warns when an existing Codex registration is pinned to a root', async () => {
    const runner = new FakeRunner(() => ({
      exitCode: 0,
      stdout: 'args: -y between-mcp --allow-review --root /old/project',
    }))

    expect(
      await manageMcpRegistration('install', 'codex', {
        projectRoot: '/new/project',
        platform: 'linux',
        runner,
        resolveBinary: async () => '/usr/bin/codex',
      }),
    ).toMatchObject({
      status: 'already_registered_pinned',
      hint: 'it is pinned with `--root`; to follow the current project, run `codex mcp remove between` then `between mcp-install codex`',
    })
    expect(runner.calls).toHaveLength(1)
  })

  it('reports a failed MCP add as a real failure', async () => {
    const runner = new FakeRunner((spec) => ({ exitCode: spec.args[1] === 'get' ? 1 : 2 }))

    expect(
      await manageMcpRegistration('install', 'claude', {
        projectRoot: '/repo',
        platform: 'linux',
        runner,
        resolveBinary: async () => '/usr/bin/claude',
      }),
    ).toMatchObject({ status: 'failed' })
  })

  it('removes only a registered server', async () => {
    const runner = new FakeRunner(() => ({ exitCode: 0 }))

    expect(
      await manageMcpRegistration('uninstall', 'claude', {
        projectRoot: '/repo',
        platform: 'linux',
        runner,
        resolveBinary: async () => '/usr/bin/claude',
      }),
    ).toMatchObject({ status: 'unregistered' })
    expect(runner.calls[1]?.args).toEqual(['mcp', 'remove', '-s', 'local', 'between'])
  })

  it('hints how to remove Claude from its registered scope when local removal fails', async () => {
    const runner = new FakeRunner((spec) => ({ exitCode: spec.args.includes('get') ? 0 : 1 }))

    expect(
      await manageMcpRegistration('uninstall', 'claude', {
        projectRoot: '/repo',
        platform: 'linux',
        runner,
        resolveBinary: async () => '/usr/bin/claude',
      }),
    ).toMatchObject({
      status: 'failed_scope_mismatch',
      hint: 'run `claude mcp remove between -s <scope>`',
    })
  })
})
