import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, parse } from 'node:path'
import {
  checkIsolation,
  isolatedReviewerLaunch,
  isolationConfigPath,
  planIsolationRemoval,
  planIsolationSetup,
  protectedPathsFor,
  readIsolationConfig,
  runIsolationPlan,
  sudoersRule,
  type IsolationConfig,
  type IsolationRunResult,
  type IsolationRunner,
} from '../../src/adapters/reviewer-isolation'
import { isolationDoctorCheck } from '../../src/api/setup'
import { loadReviewerIsolation } from '../../src/api/review'
import { BetweenApiError } from '../../src/api/errors'

let dir: string
let configPath: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'between-isolation-'))
  configPath = join(dir, 'reviewer-isolation.json')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const CONFIG: IsolationConfig = {
  schema_version: 1,
  platform: 'linux',
  user: 'between-reviewer',
  uid: 999,
  invoking_uid: 1000,
  method: 'sudo',
}

type Handler = (line: string, input?: string) => Partial<IsolationRunResult> | undefined

/** Records every command line; `handler` answers (default: exit 0, no output). */
function fakeRunner(handler: Handler = () => undefined) {
  const calls: { line: string; input?: string }[] = []
  const runner: IsolationRunner = async (file, args, opts = {}) => {
    const line = [file, ...args].join(' ')
    calls.push({ line, ...(opts.input === undefined ? {} : { input: opts.input }) })
    return { exitCode: 0, stdout: '', stderr: '', ...handler(line, opts.input) }
  }
  return { runner, calls, lines: () => calls.map((c) => c.line) }
}

const idAnswers =
  (uid: string | null): Handler =>
  (line) =>
    line.startsWith('/usr/bin/id -u')
      ? uid === null
        ? { exitCode: 1, stderr: 'no such user' }
        : { stdout: `${uid}\n` }
      : undefined

const setupPlan = () => {
  const plan = planIsolationSetup({
    platform: 'linux',
    user: 'between-reviewer',
    invokingUid: 1000,
    configPath,
    facts: { userExists: false, configExists: false },
  })
  if (!plan.supported) throw new Error('expected a supported plan')
  return plan
}

const quiet = { interactive: false, ask: async () => '', print: () => {} }

describe('planIsolationSetup', () => {
  it('lists every root command as an absolute path, the uid-keyed rule, and the opt-in', () => {
    const plan = setupPlan()
    expect(plan.steps.map((s) => (s.kind === 'run' ? s.command.join(' ') : s.kind))).toEqual([
      '/usr/bin/sudo /usr/sbin/useradd --system --create-home --home-dir /var/lib/between-reviewer --shell /usr/sbin/nologin between-reviewer',
      '/usr/bin/sudo /bin/sh -c test ! -e "$1" sh /etc/sudoers.d/between-reviewer',
      '/usr/bin/sudo /usr/bin/tee /etc/sudoers.d/between-reviewer.pending',
      '/usr/bin/sudo /bin/chmod 0440 /etc/sudoers.d/between-reviewer.pending',
      '/usr/bin/sudo /usr/sbin/visudo -cf /etc/sudoers.d/between-reviewer.pending',
      '/usr/bin/sudo /bin/mv /etc/sudoers.d/between-reviewer.pending /etc/sudoers.d/between-reviewer',
      '/usr/bin/sudo /bin/mkdir -p /etc/between/reviewer-isolation',
      'write-config',
    ])
    const rule = plan.steps[2]!
    expect(rule.kind === 'run' && rule.input).toBe(
      '#1000 ALL=(between-reviewer) NOPASSWD:SETENV: ALL\n',
    )
  })

  it('does nothing when isolation is already set up', () => {
    const plan = planIsolationSetup({
      platform: 'linux',
      user: 'between-reviewer',
      invokingUid: 1000,
      configPath,
      facts: { userExists: true, configExists: true },
    })
    expect(plan.supported && plan.steps).toEqual([])
  })

  it('refuses to reuse an account it did not create', () => {
    expect(() =>
      planIsolationSetup({
        platform: 'linux',
        user: 'postgres',
        invokingUid: 1000,
        configPath,
        facts: { userExists: true, configExists: false },
      }),
    ).toThrow(/already exists/)
  })

  it.each(['root', 'root; rm -rf /', 'Alice'])('rejects the user name %j', (user) => {
    expect(() =>
      planIsolationSetup({
        platform: 'linux',
        user,
        invokingUid: 1000,
        configPath,
        facts: { userExists: false, configExists: false },
      }),
    ).toThrow(/user name/)
  })

  it.each(['darwin', 'win32'] as const)(
    'refuses on %s instead of claiming isolation',
    (platform) => {
      const plan = planIsolationSetup({
        platform,
        user: 'between-reviewer',
        invokingUid: 1000,
        configPath: isolationConfigPath({ platform, uid: 1000 }),
        facts: { userExists: false, configExists: false },
      })
      expect(plan.supported).toBe(false)
      expect(!plan.supported && plan.reason).toMatch(/not implemented/)
    },
  )
})

describe('runIsolationPlan (confirmation)', () => {
  it('prints every command and runs nothing when the user declines', async () => {
    const fake = fakeRunner()
    const out: string[] = []
    const result = await runIsolationPlan(setupPlan(), {
      yes: false,
      interactive: true,
      ask: async () => 'n',
      print: (l) => out.push(l),
      runner: fake.runner,
    })
    expect(result).toBe('declined')
    expect(fake.calls).toEqual([])
    const text = out.join('\n')
    expect(text).toContain('/usr/sbin/useradd --system')
    expect(text).toContain('#1000 ALL=(between-reviewer) NOPASSWD:SETENV: ALL')
    expect(text).toContain(configPath)
  })

  it('refuses to run without a terminal unless --yes is given', async () => {
    const fake = fakeRunner()
    const out: string[] = []
    const result = await runIsolationPlan(setupPlan(), {
      ...quiet,
      yes: false,
      ask: async () => 'y',
      print: (l) => out.push(l),
      runner: fake.runner,
    })
    expect(result).toBe('declined')
    expect(fake.calls).toEqual([])
    expect(out.join('\n')).toContain('--yes')
  })

  it('after confirmation runs the steps in order and records the uid useradd assigned', async () => {
    const fake = fakeRunner(idAnswers('999'))
    const result = await runIsolationPlan(setupPlan(), {
      ...quiet,
      yes: false,
      interactive: true,
      ask: async () => 'y',
      runner: fake.runner,
    })
    expect(result).toBe('applied')
    expect(fake.lines().map((l) => l.split(' ').slice(0, 2).join(' '))).toEqual([
      '/usr/bin/sudo /usr/sbin/useradd',
      '/usr/bin/sudo /bin/sh',
      '/usr/bin/sudo /usr/bin/tee',
      '/usr/bin/sudo /bin/chmod',
      '/usr/bin/sudo /usr/sbin/visudo',
      '/usr/bin/sudo /bin/mv',
      '/usr/bin/sudo /bin/mkdir',
      '/usr/bin/id -u',
      '/usr/bin/sudo /usr/bin/tee',
      '/usr/bin/sudo /bin/chmod',
    ])
    const written = fake.calls.find((c) => c.line === `/usr/bin/sudo /usr/bin/tee ${configPath}`)
    expect(JSON.parse(written!.input!)).toEqual(CONFIG)
  })

  it('never records the invoking user or root as the reviewer', async () => {
    for (const uid of ['1000', '0']) {
      const fake = fakeRunner(idAnswers(uid))
      await expect(
        runIsolationPlan(setupPlan(), { ...quiet, yes: true, runner: fake.runner }),
      ).rejects.toThrow(/unexpected uid/)
      expect(fake.lines().some((l) => l.includes(`tee ${configPath}`))).toBe(false)
    }
  })

  it('stops at the first failed step and never activates an unchecked sudoers rule', async () => {
    const fake = fakeRunner((line) =>
      line.includes('/usr/sbin/visudo') ? { exitCode: 1, stderr: 'syntax error' } : undefined,
    )
    await expect(
      runIsolationPlan(setupPlan(), { ...quiet, yes: true, runner: fake.runner }),
    ).rejects.toThrow(/visudo/)
    expect(fake.lines().some((l) => l.includes('/bin/mv'))).toBe(false)
  })

  it('refuses to overwrite an existing sudoers file', async () => {
    const fake = fakeRunner((line) => (line.includes('test ! -e') ? { exitCode: 1 } : undefined))
    await expect(
      runIsolationPlan(setupPlan(), { ...quiet, yes: true, runner: fake.runner }),
    ).rejects.toThrow(/test ! -e/)
    expect(fake.lines().some((l) => l.includes('/usr/bin/tee'))).toBe(false)
  })
})

describe('planIsolationRemoval', () => {
  const removal = () => {
    const plan = planIsolationRemoval({ platform: 'linux', configPath, config: CONFIG })
    if (!plan.supported) throw new Error('expected a supported plan')
    return plan
  }

  it('removes only what setup recorded, after re-checking uid and rule content', async () => {
    const fake = fakeRunner((line) =>
      line.startsWith('/usr/bin/id')
        ? { stdout: '999\n' }
        : line.includes('cat "$1"')
          ? { stdout: sudoersRule(1000, 'between-reviewer') }
          : undefined,
    )
    expect(await runIsolationPlan(removal(), { ...quiet, yes: true, runner: fake.runner })).toBe(
      'applied',
    )
    expect(fake.lines().filter((l) => /rm -f|userdel/.test(l))).toEqual([
      '/usr/bin/sudo /bin/rm -f /etc/sudoers.d/between-reviewer',
      '/usr/bin/sudo /usr/sbin/userdel --remove between-reviewer',
      `/usr/bin/sudo /bin/rm -f ${configPath}`,
    ])
  })

  it('refuses when the account now has a different uid', async () => {
    const fake = fakeRunner(idAnswers('1001'))
    await expect(
      runIsolationPlan(removal(), { ...quiet, yes: true, runner: fake.runner }),
    ).rejects.toThrow(/uid 1001/)
    expect(fake.lines().some((l) => /userdel|rm -f/.test(l))).toBe(false)
  })

  it('refuses when the sudoers file is not the rule setup wrote', async () => {
    const fake = fakeRunner((line) =>
      line.startsWith('/usr/bin/id')
        ? { stdout: '999\n' }
        : line.includes('cat "$1"')
          ? { stdout: 'postgres ALL=(ALL) ALL\n' }
          : undefined,
    )
    await expect(
      runIsolationPlan(removal(), { ...quiet, yes: true, runner: fake.runner }),
    ).rejects.toThrow(/left untouched/)
    expect(fake.lines().some((l) => /userdel|rm -f/.test(l))).toBe(false)
  })

  it('has nothing to do when isolation was never set up', () => {
    const plan = planIsolationRemoval({ platform: 'linux', configPath, config: null })
    expect(plan.supported && plan.steps).toEqual([])
  })
})

describe('checkIsolation (doctor)', () => {
  const paths = ['/home/alice/.local/state/between/anchors', '/home/alice']
  const writeConfig = (value: unknown = CONFIG) => writeFile(configPath, JSON.stringify(value))
  const probe = (answer: Partial<IsolationRunResult>): Handler => {
    const id = idAnswers('999')
    return (line, input) =>
      line.startsWith('/usr/bin/sudo -n -u between-reviewer -- /bin/sh -c')
        ? answer
        : id(line, input)
  }
  const check = (runner: IsolationRunner, platform: NodeJS.Platform = 'linux') =>
    checkIsolation({ platform, configPath, protectedPaths: paths, runner })

  it('reports off when isolation was never set up (the default)', async () => {
    const fake = fakeRunner()
    expect((await check(fake.runner)).state).toBe('off')
    expect(fake.calls).toEqual([])
  })

  it('reports active only when the probe answers read-only for every protected path', async () => {
    await writeConfig()
    const fake = fakeRunner(probe({ stdout: 'R\nR\n' }))
    expect((await check(fake.runner)).state).toBe('active')
    expect(fake.lines().at(-1)).toMatch(
      /^\/usr\/bin\/sudo -n -u between-reviewer -- \/bin\/sh -c .* sh \/home\/alice\/.local\/state\/between\/anchors \/home\/alice$/,
    )
  })

  it('reports broken and names the path when the reviewer could write one', async () => {
    await writeConfig()
    const status = await check(fakeRunner(probe({ stdout: 'R\nW\n' })).runner)
    expect(status.state).toBe('broken')
    expect(status.detail).toContain('/home/alice')
  })

  it.each([
    ['sudo fails', { exitCode: 1, stderr: 'sudo: a password is required' }],
    ['a timeout', { exitCode: -1 }],
    ['a short answer', { stdout: 'R\n' }],
    ['garbage', { stdout: 'R\nmaybe\n' }],
  ])('fails closed (broken) on %s instead of reporting active', async (_, answer) => {
    await writeConfig()
    expect((await check(fakeRunner(probe(answer)).runner)).state).toBe('broken')
  })

  it('reports broken when the account no longer has the recorded uid', async () => {
    await writeConfig()
    expect((await check(fakeRunner(idAnswers('1001')).runner)).state).toBe('broken')
    expect((await check(fakeRunner(idAnswers(null)).runner)).state).toBe('broken')
  })

  it('reports broken for a malformed or unsafe opt-in', async () => {
    for (const bad of [
      { ...CONFIG, uid: 0 },
      { ...CONFIG, user: 'root' },
      { ...CONFIG, uid: 1000 },
    ]) {
      await writeConfig(bad)
      expect((await check(fakeRunner().runner)).state).toBe('broken')
    }
  })

  it('reports unsupported on macOS/Windows even if an opt-in exists', async () => {
    await writeConfig()
    expect((await check(fakeRunner().runner, 'darwin')).state).toBe('unsupported')
  })

  it('keeps the opt-in root-owned under /etc, keyed by uid, with no environment override', async () => {
    expect(isolationConfigPath({ platform: 'linux', uid: 1000 })).toBe(
      '/etc/between/reviewer-isolation/1000.json',
    )
    expect(isolationConfigPath({ platform: 'win32', uid: 1000 })).toBeNull()
    expect(await readIsolationConfig(null)).toBeNull()
  })
})

describe('isolatedReviewerLaunch', () => {
  it('runs the reviewer as the reviewer user and passes only credential, network, and locale vars', () => {
    const launch = isolatedReviewerLaunch(
      CONFIG,
      'codex',
      ['exec', '-'],
      '/tmp/between-review-abcdefgh',
      {
        PATH: '/usr/bin',
        HOME: '/home/alice',
        CODEX_HOME: '/home/alice/.codex',
        XDG_CONFIG_HOME: '/home/alice/.config',
        TERM: 'xterm',
        OPENAI_API_KEY: 'sk-x',
        HTTPS_PROXY: 'http://p',
        LC_ALL: 'C.UTF-8',
      },
      ['OPENAI_API_KEY'],
    )
    expect(launch.file).toBe('/usr/bin/sudo')
    expect(launch.args).toEqual([
      '-n',
      '-u',
      'between-reviewer',
      '--preserve-env=OPENAI_API_KEY,HTTPS_PROXY,LC_ALL',
      '--',
      '/usr/bin/env',
      '-C',
      '/tmp/between-review-abcdefgh',
      'codex',
      'exec',
      '-',
    ])
    expect(launch.env).toEqual({
      OPENAI_API_KEY: 'sk-x',
      HTTPS_PROXY: 'http://p',
      LC_ALL: 'C.UTF-8',
    })
  })
})

describe('protectedPathsFor', () => {
  it('covers the nearest existing ancestors of the anchor file and journal, up to the root', () => {
    const paths = protectedPathsFor(dir, join(dir, 'state', 'between', 'anchors'))
    expect(paths).toContain(dir)
    expect(paths).toContain(dirname(dir))
    expect(paths).toContain(parse(dir).root)
    expect(paths.every((p) => existsSync(p))).toBe(true)
  })
})

describe('doctor line', () => {
  it('passes when off or active, and fails when configured but not in force', () => {
    expect(isolationDoctorCheck({ state: 'off', detail: 'off' }).ok).toBe(true)
    expect(isolationDoctorCheck({ state: 'active', detail: 'a', config: CONFIG }).ok).toBe(true)
    expect(isolationDoctorCheck({ state: 'broken', detail: 'b' }).ok).toBe(false)
    expect(isolationDoctorCheck({ state: 'unsupported', detail: 'u' }).ok).toBe(true)
    expect(isolationDoctorCheck({ state: 'unsupported', detail: 'u', config: CONFIG }).ok).toBe(
      false,
    )
  })
})

describe('review path (loadReviewerIsolation)', () => {
  const load = (platform: NodeJS.Platform, runner: IsolationRunner) =>
    loadReviewerIsolation(dir, { platform, configPath, anchorStore: join(dir, 'anchors'), runner })

  it('runs unisolated when isolation is off', async () => {
    expect(await load('linux', fakeRunner().runner)).toBeNull()
  })

  it('returns the config only when isolation is fully in force', async () => {
    await writeFile(configPath, JSON.stringify(CONFIG))
    const runner = fakeRunner((line) =>
      line.startsWith('/usr/bin/id')
        ? { stdout: '999\n' }
        : {
            stdout: protectedPathsFor(dir, join(dir, 'anchors'))
              .map(() => 'R')
              .join('\n'),
          },
    ).runner
    expect(await load('linux', runner)).toEqual(CONFIG)
  })

  it.each([
    ['a malformed opt-in', 'linux', '{"schema_version":1}'],
    ['an opt-in on macOS', 'darwin', JSON.stringify(CONFIG)],
    ['a reviewer that can write a protected path', 'linux', JSON.stringify(CONFIG)],
  ] as const)('fails the review closed for %s', async (_, platform, content) => {
    await writeFile(configPath, content)
    const runner = fakeRunner((line) =>
      line.startsWith('/usr/bin/id')
        ? { stdout: '999\n' }
        : {
            stdout: protectedPathsFor(dir, join(dir, 'anchors'))
              .map(() => 'W')
              .join('\n'),
          },
    ).runner
    const err = await load(platform, runner).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BetweenApiError)
    expect((err as BetweenApiError).code).toBe('reviewer_failed')
  })
})
