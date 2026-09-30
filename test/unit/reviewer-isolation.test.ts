import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkIsolation,
  isolatedReviewerLaunch,
  isolationConfigPath,
  protectedPathsFor,
  planIsolationRemoval,
  planIsolationSetup,
  runIsolationPlan,
  type IsolationRunner,
} from '../../src/adapters/reviewer-isolation'
import { isolationDoctorCheck } from '../../src/api/setup'

let dir: string
let configPath: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-isolation-'))
  configPath = join(dir, 'config', 'reviewer-isolation.json')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** A runner that records every command and answers from a table (default: exit 0). */
function recordingRunner(answers: Record<string, number> = {}) {
  const calls: string[] = []
  const runner: IsolationRunner = async (file, args) => {
    const line = [file, ...args].join(' ')
    calls.push(line)
    const hit = Object.entries(answers).find(([prefix]) => line.startsWith(prefix))
    return { exitCode: hit ? hit[1] : 0, stdout: '', stderr: hit && hit[1] !== 0 ? 'denied' : '' }
  }
  return { runner, calls }
}

const linuxFacts = { userExists: false, sudoersExists: false, configExists: false }

describe('planIsolationSetup', () => {
  it('lists the exact user, sudoers rule, and config it will create on Linux', () => {
    const plan = planIsolationSetup({
      platform: 'linux',
      user: 'between-reviewer',
      invokingUser: 'alice',
      configPath,
      facts: linuxFacts,
    })
    if (!plan.supported) throw new Error('expected a supported plan')
    const commands = plan.steps.map((s) => s.command?.join(' '))
    expect(commands).toEqual([
      'sudo useradd --system --create-home --home-dir /var/lib/between-reviewer --shell /usr/sbin/nologin between-reviewer',
      'sudo tee /etc/sudoers.d/between-reviewer.pending',
      'sudo chmod 0440 /etc/sudoers.d/between-reviewer.pending',
      'sudo visudo -cf /etc/sudoers.d/between-reviewer.pending',
      'sudo mv /etc/sudoers.d/between-reviewer.pending /etc/sudoers.d/between-reviewer',
      undefined,
    ])
    expect(plan.steps[1]!.input).toBe('alice ALL=(between-reviewer) NOPASSWD:SETENV: ALL\n')
    expect(plan.steps[5]!.writeConfig).toEqual({
      path: configPath,
      content: { schema_version: 1, platform: 'linux', user: 'between-reviewer', method: 'sudo' },
    })
  })

  it('skips what already exists', () => {
    const plan = planIsolationSetup({
      platform: 'linux',
      user: 'between-reviewer',
      invokingUser: 'alice',
      configPath,
      facts: { userExists: true, sudoersExists: true, configExists: false },
    })
    if (!plan.supported) throw new Error('expected a supported plan')
    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]!.writeConfig?.path).toBe(configPath)
  })

  it.each(['darwin', 'win32'] as const)(
    'refuses on %s instead of claiming isolation',
    (platform) => {
      const plan = planIsolationSetup({
        platform,
        user: 'between-reviewer',
        invokingUser: 'alice',
        configPath,
        facts: linuxFacts,
      })
      expect(plan.supported).toBe(false)
      if (plan.supported) return
      expect(plan.reason).toMatch(/not implemented/)
    },
  )

  it('rejects a user name that is not a plain account name', () => {
    expect(() =>
      planIsolationSetup({
        platform: 'linux',
        user: 'root; rm -rf /',
        invokingUser: 'alice',
        configPath,
        facts: linuxFacts,
      }),
    ).toThrow(/user name/)
  })
})

describe('runIsolationPlan (confirmation)', () => {
  const plan = () => {
    const p = planIsolationSetup({
      platform: 'linux',
      user: 'between-reviewer',
      invokingUser: 'alice',
      configPath,
      facts: linuxFacts,
    })
    if (!p.supported) throw new Error('expected a supported plan')
    return p
  }

  it('prints every command and changes nothing when the user declines', async () => {
    const { runner, calls } = recordingRunner()
    const out: string[] = []
    const result = await runIsolationPlan(plan(), {
      yes: false,
      interactive: true,
      ask: async () => 'n',
      print: (l) => out.push(l),
      runner,
    })
    expect(result).toBe('declined')
    expect(calls).toEqual([])
    expect(existsSync(configPath)).toBe(false)
    const text = out.join('\n')
    expect(text).toContain('useradd --system')
    expect(text).toContain('alice ALL=(between-reviewer) NOPASSWD:SETENV: ALL')
    expect(text).toContain(configPath)
  })

  it('refuses to run without a terminal unless --yes is given', async () => {
    const { runner, calls } = recordingRunner()
    const out: string[] = []
    const result = await runIsolationPlan(plan(), {
      yes: false,
      interactive: false,
      ask: async () => 'y',
      print: (l) => out.push(l),
      runner,
    })
    expect(result).toBe('declined')
    expect(calls).toEqual([])
    expect(out.join('\n')).toContain('--yes')
  })

  it('runs the steps in order and writes the config after confirmation', async () => {
    const { runner, calls } = recordingRunner()
    const result = await runIsolationPlan(plan(), {
      yes: false,
      interactive: true,
      ask: async () => 'y',
      print: () => {},
      runner,
    })
    expect(result).toBe('applied')
    expect(calls.map((c) => c.split(' ').slice(0, 2).join(' '))).toEqual([
      'sudo useradd',
      'sudo tee',
      'sudo chmod',
      'sudo visudo',
      'sudo mv',
    ])
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toMatchObject({
      user: 'between-reviewer',
    })
  })

  it('stops at the first failed step and never installs an unchecked sudoers rule', async () => {
    const { runner, calls } = recordingRunner({ 'sudo visudo': 1 })
    await expect(
      runIsolationPlan(plan(), {
        yes: true,
        interactive: false,
        ask: async () => '',
        print: () => {},
        runner,
      }),
    ).rejects.toThrow(/visudo/)
    expect(calls.some((c) => c.startsWith('sudo mv'))).toBe(false)
    expect(existsSync(configPath)).toBe(false)
  })

  it('plans removal of exactly what setup created', () => {
    const removal = planIsolationRemoval({
      platform: 'linux',
      user: 'between-reviewer',
      configPath,
      facts: { userExists: true, sudoersExists: true, configExists: true },
    })
    if (!removal.supported) throw new Error('expected a supported plan')
    expect(removal.steps.map((s) => s.command?.join(' ') ?? `remove ${s.removeFile}`)).toEqual([
      'sudo rm -f /etc/sudoers.d/between-reviewer',
      'sudo userdel --remove between-reviewer',
      `remove ${configPath}`,
    ])
  })
})

describe('checkIsolation (doctor)', () => {
  const anchor = '/home/alice/.local/state/between/anchors'
  const writeConfig = async () => {
    const plan = planIsolationSetup({
      platform: 'linux',
      user: 'between-reviewer',
      invokingUser: 'alice',
      configPath,
      facts: { userExists: true, sudoersExists: true, configExists: false },
    })
    if (!plan.supported) throw new Error('expected a supported plan')
    await runIsolationPlan(plan, {
      yes: true,
      interactive: false,
      ask: async () => '',
      print: () => {},
      runner: recordingRunner().runner,
    })
  }
  const check = (runner: IsolationRunner, platform: NodeJS.Platform = 'linux') =>
    checkIsolation({ platform, configPath, protectedPaths: [anchor], runner })

  it('reports off when isolation was never set up (the default)', async () => {
    const { runner, calls } = recordingRunner()
    expect((await check(runner)).state).toBe('off')
    expect(calls).toEqual([])
  })

  it('reports active only when the reviewer user exists, sudo works, and it cannot write the anchor', async () => {
    await writeConfig()
    const { runner, calls } = recordingRunner({
      '/usr/bin/sudo -n -u between-reviewer -- test -w': 1,
    })
    const status = await check(runner)
    expect(status.state).toBe('active')
    expect(calls).toContain(`/usr/bin/sudo -n -u between-reviewer -- test -w ${anchor}`)
  })

  it('reports broken when the reviewer user could write the anchor', async () => {
    await writeConfig()
    const { runner } = recordingRunner()
    const status = await check(runner)
    expect(status.state).toBe('broken')
    expect(status.detail).toContain(anchor)
  })

  it('reports broken when sudo cannot switch to the reviewer user without a password', async () => {
    await writeConfig()
    const { runner } = recordingRunner({ '/usr/bin/sudo -n -u between-reviewer -- true': 1 })
    expect((await check(runner)).state).toBe('broken')
  })

  it('reports unsupported on macOS/Windows even if a config exists', async () => {
    await writeConfig()
    expect((await check(recordingRunner().runner, 'darwin')).state).toBe('unsupported')
  })

  it('keeps the config outside the workspace, under the per-user config dir', () => {
    expect(
      isolationConfigPath({
        env: { XDG_CONFIG_HOME: '/x/cfg' },
        home: '/home/alice',
        platform: 'linux',
      }),
    ).toBe(join('/x/cfg', 'between', 'reviewer-isolation.json'))
    expect(isolationConfigPath({ env: {}, home: '/home/alice', platform: 'linux' })).toBe(
      join('/home/alice', '.config', 'between', 'reviewer-isolation.json'),
    )
  })
})

describe('isolatedReviewerLaunch', () => {
  it('runs the reviewer through sudo as the reviewer user, passing only its credential env', () => {
    const launch = isolatedReviewerLaunch(
      { schema_version: 1, platform: 'linux', user: 'between-reviewer', method: 'sudo' },
      'codex',
      ['exec', '-'],
      '/tmp/between-review-abc',
      { PATH: '/usr/bin', HOME: '/home/alice', OPENAI_API_KEY: 'sk-x', HTTPS_PROXY: 'http://p' },
    )
    expect(launch.file).toBe('/usr/bin/sudo')
    expect(launch.args).toEqual([
      '-n',
      '-u',
      'between-reviewer',
      '--preserve-env=OPENAI_API_KEY,HTTPS_PROXY',
      '--',
      'env',
      '-C',
      '/tmp/between-review-abc',
      'codex',
      'exec',
      '-',
    ])
    expect(launch.env).toEqual({ OPENAI_API_KEY: 'sk-x', HTTPS_PROXY: 'http://p' })
  })
})

describe('doctor line', () => {
  it('passes when off or active, and fails when configured but not in force', () => {
    expect(isolationDoctorCheck({ state: 'off', detail: 'off' }).ok).toBe(true)
    expect(isolationDoctorCheck({ state: 'active', detail: 'a', user: 'r' }).ok).toBe(true)
    expect(isolationDoctorCheck({ state: 'broken', detail: 'b', user: 'r' }).ok).toBe(false)
    expect(isolationDoctorCheck({ state: 'unsupported', detail: 'u' }).ok).toBe(true)
    expect(isolationDoctorCheck({ state: 'unsupported', detail: 'u', user: 'r' }).ok).toBe(false)
  })

  it('probes the nearest existing ancestor of a protected path that does not exist yet', () => {
    const paths = protectedPathsFor(dir, join(dir, 'state', 'between', 'anchors'))
    // neither the anchor store nor .between/ exists yet: both resolve to the project dir itself
    expect(paths).toEqual([dir])
  })
})
