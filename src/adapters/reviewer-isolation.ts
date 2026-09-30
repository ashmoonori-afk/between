import { existsSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { execa } from 'execa'
import writeFileAtomic from 'write-file-atomic'
import { anchorDir } from './journal-anchor'
import { betweenPaths } from './paths'

/**
 * Opt-in reviewer isolation: run the direct-review reviewer CLI as a dedicated OS user that
 * cannot write the invoking user's journal anchor, `.between/` journal, or `state.json`.
 *
 * Linux only for now: a system user plus a sudoers rule that lets the invoking user (and nobody
 * else) start commands as that user without a password. macOS and Windows are documented
 * follow-ups (docs/AGENT-CONTRACT.md); setup refuses there instead of claiming isolation.
 *
 * The switch lives outside the workspace (per-user config dir), so a workspace-confined writer
 * cannot turn it off. It does not stop a process running as the invoking user, which can delete
 * the config file; see the threat model.
 */
export interface IsolationConfig {
  schema_version: 1
  platform: 'linux'
  user: string
  method: 'sudo'
}

export interface IsolationRunResult {
  exitCode: number
  stdout: string
  stderr: string
}
export type IsolationRunner = (
  file: string,
  args: string[],
  opts?: { input?: string },
) => Promise<IsolationRunResult>

export interface IsolationStep {
  description: string
  command?: string[]
  input?: string
  writeConfig?: { path: string; content: IsolationConfig }
  removeFile?: string
}

export type IsolationPlan =
  | { supported: true; user: string; steps: IsolationStep[]; after: string[] }
  | { supported: false; reason: string }

export interface HostFacts {
  userExists: boolean
  sudoersExists: boolean
  configExists: boolean
}

export const DEFAULT_REVIEWER_USER = 'between-reviewer'
const SUDO = '/usr/bin/sudo'
const USER_NAME = /^[a-z_][a-z0-9_-]{0,30}$/
const UNSUPPORTED =
  'reviewer isolation is not implemented on this platform yet (Linux only); see "Reviewer isolation" in docs/AGENT-CONTRACT.md for the planned macOS/Windows design'

const sudoersPath = (user: string) => `/etc/sudoers.d/${user}`
// sudo ignores sudoers.d entries containing a '.', so the rule is inert until visudo accepts it
const pendingSudoersPath = (user: string) => `${sudoersPath(user)}.pending`
const reviewerHome = (user: string) => `/var/lib/${user}`

function assertUserName(user: string): void {
  if (!USER_NAME.test(user)) {
    throw new Error(`invalid reviewer user name ${JSON.stringify(user)}: use [a-z_][a-z0-9_-]*`)
  }
}

/** Per-user config dir, outside any project. `BETWEEN_REVIEWER_ISOLATION_CONFIG` overrides. */
export function isolationConfigPath(
  opts: { env?: NodeJS.ProcessEnv; home?: string; platform?: NodeJS.Platform } = {},
): string {
  const env = opts.env ?? process.env
  if (env.BETWEEN_REVIEWER_ISOLATION_CONFIG) return env.BETWEEN_REVIEWER_ISOLATION_CONFIG
  const home = opts.home ?? homedir()
  const platform = opts.platform ?? process.platform
  if (platform === 'win32') {
    return join(
      env.APPDATA || join(home, 'AppData', 'Roaming'),
      'between',
      'reviewer-isolation.json',
    )
  }
  const xdg = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : ''
  return join(xdg || join(home, '.config'), 'between', 'reviewer-isolation.json')
}

/** The saved isolation config, or null when isolation was never set up. Malformed throws. */
export async function readIsolationConfig(path: string): Promise<IsolationConfig | null> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
  let v: Partial<IsolationConfig> | null
  try {
    v = JSON.parse(raw) as Partial<IsolationConfig> | null
  } catch {
    throw new Error(`reviewer isolation config ${path} is not valid JSON`)
  }
  if (
    !v ||
    v.schema_version !== 1 ||
    v.platform !== 'linux' ||
    v.method !== 'sudo' ||
    typeof v.user !== 'string' ||
    !USER_NAME.test(v.user)
  ) {
    throw new Error(`reviewer isolation config ${path} is malformed`)
  }
  return { schema_version: 1, platform: 'linux', user: v.user, method: 'sudo' }
}

export function planIsolationSetup(opts: {
  platform: NodeJS.Platform
  user: string
  invokingUser: string
  configPath: string
  facts: HostFacts
}): IsolationPlan {
  assertUserName(opts.user)
  if (opts.platform !== 'linux') return { supported: false, reason: UNSUPPORTED }
  assertUserName(opts.invokingUser)
  const { user } = opts
  const steps: IsolationStep[] = []
  if (!opts.facts.userExists) {
    steps.push({
      description: `create the system user ${user} (no login shell, home ${reviewerHome(user)})`,
      command: [
        'sudo',
        'useradd',
        '--system',
        '--create-home',
        '--home-dir',
        reviewerHome(user),
        '--shell',
        '/usr/sbin/nologin',
        user,
      ],
    })
  }
  if (!opts.facts.sudoersExists) {
    const pending = pendingSudoersPath(user)
    steps.push(
      {
        description: `write the sudoers rule letting ${opts.invokingUser} run commands as ${user} without a password (inert until checked)`,
        command: ['sudo', 'tee', pending],
        input: `${opts.invokingUser} ALL=(${user}) NOPASSWD:SETENV: ALL\n`,
      },
      {
        description: 'make the rule root-only readable',
        command: ['sudo', 'chmod', '0440', pending],
      },
      { description: 'check the rule with visudo', command: ['sudo', 'visudo', '-cf', pending] },
      {
        description: 'activate the checked rule',
        command: ['sudo', 'mv', pending, sudoersPath(user)],
      },
    )
  }
  steps.push({
    description: 'record the opt-in (outside any project)',
    writeConfig: {
      path: opts.configPath,
      content: { schema_version: 1, platform: 'linux', user, method: 'sudo' },
    },
  })
  return {
    supported: true,
    user,
    steps,
    after: [
      `Install the reviewer CLI where ${user} can run it (a system-wide install on sudo's secure_path, e.g. /usr/local/bin), then sign it in as that user: sudo -u ${user} -H codex login (or claude). Between passes only the reviewer's own provider API key from your environment.`,
      'Check with: between isolation status (or between doctor).',
    ],
  }
}

export function planIsolationRemoval(opts: {
  platform: NodeJS.Platform
  user: string
  configPath: string
  facts: HostFacts
}): IsolationPlan {
  assertUserName(opts.user)
  if (opts.platform !== 'linux') return { supported: false, reason: UNSUPPORTED }
  const { user } = opts
  const steps: IsolationStep[] = []
  if (opts.facts.sudoersExists) {
    steps.push({
      description: `remove the sudoers rule for ${user}`,
      command: ['sudo', 'rm', '-f', sudoersPath(user)],
    })
  }
  if (opts.facts.userExists) {
    steps.push({
      description: `delete the user ${user} and its home (its reviewer CLI sign-in goes too)`,
      command: ['sudo', 'userdel', '--remove', user],
    })
  }
  if (opts.facts.configExists) {
    steps.push({ description: 'forget the opt-in', removeFile: opts.configPath })
  }
  return { supported: true, user, steps, after: [] }
}

function describeStep(step: IsolationStep): string[] {
  const lines = [`  - ${step.description}`]
  if (step.command) lines.push(`      $ ${step.command.join(' ')}`)
  if (step.input !== undefined) {
    for (const l of step.input.trimEnd().split('\n')) lines.push(`      | ${l}`)
  }
  if (step.writeConfig) {
    lines.push(`      write ${step.writeConfig.path}:`)
    lines.push(`      | ${JSON.stringify(step.writeConfig.content)}`)
  }
  if (step.removeFile) lines.push(`      delete ${step.removeFile}`)
  return lines
}

export type PlanOutcome = 'applied' | 'declined' | 'nothing-to-do'

/**
 * Print the plan, ask for confirmation (or require `yes`), then run it step by step, stopping
 * at the first failure. Nothing runs without a confirmation; nothing is created silently.
 */
export async function runIsolationPlan(
  plan: Extract<IsolationPlan, { supported: true }>,
  io: {
    yes: boolean
    interactive: boolean
    ask: (question: string) => Promise<string>
    print: (line: string) => void
    runner: IsolationRunner
  },
): Promise<PlanOutcome> {
  if (plan.steps.length === 0) {
    io.print('between: nothing to do')
    return 'nothing-to-do'
  }
  io.print('between: this will run exactly the following (sudo may ask for your password):')
  for (const step of plan.steps) for (const line of describeStep(step)) io.print(line)
  if (!io.yes) {
    if (!io.interactive) {
      io.print('between: not confirmed; nothing was changed. Re-run in a terminal, or pass --yes.')
      return 'declined'
    }
    const answer = (await io.ask('Proceed? [y/N] ')).trim().toLowerCase()
    if (answer !== 'y' && answer !== 'yes') {
      io.print('between: declined; nothing was changed.')
      return 'declined'
    }
  }
  for (const step of plan.steps) {
    if (step.command) {
      const [file, ...args] = step.command
      const r = await io.runner(file!, args, step.input === undefined ? {} : { input: step.input })
      if (r.exitCode !== 0) {
        const detail = r.stderr.trim().split('\n')[0] || `exit ${r.exitCode}`
        throw new Error(`step failed: ${step.command.join(' ')}: ${detail}`)
      }
    }
    if (step.writeConfig) {
      await mkdir(dirname(step.writeConfig.path), { recursive: true, mode: 0o700 })
      await writeFileAtomic(
        step.writeConfig.path,
        `${JSON.stringify(step.writeConfig.content, null, 2)}\n`,
        { mode: 0o600 },
      )
    }
    if (step.removeFile) await rm(step.removeFile, { force: true })
  }
  for (const line of plan.after) io.print(line)
  return 'applied'
}

export type IsolationState = 'off' | 'active' | 'broken' | 'unsupported'
export interface IsolationStatus {
  state: IsolationState
  detail: string
  user?: string
}

/**
 * Whether isolation is really in force: the config exists, the reviewer user exists, sudo can
 * switch to it without a password, and that user cannot write any of `protectedPaths`.
 */
export async function checkIsolation(opts: {
  platform: NodeJS.Platform
  configPath: string
  protectedPaths: string[]
  runner: IsolationRunner
}): Promise<IsolationStatus> {
  let config: IsolationConfig | null
  try {
    config = await readIsolationConfig(opts.configPath)
  } catch (e) {
    return { state: 'broken', detail: (e as Error).message }
  }
  if (!config) {
    if (opts.platform !== 'linux') {
      return { state: 'unsupported', detail: 'not available on this platform (Linux only)' }
    }
    return { state: 'off', detail: 'off (opt-in: between isolation setup)' }
  }
  const { user } = config
  if (opts.platform !== 'linux') {
    return { state: 'unsupported', detail: `configured for ${user}, but ${UNSUPPORTED}`, user }
  }
  if ((await opts.runner('id', ['-u', user])).exitCode !== 0) {
    return { state: 'broken', detail: `the reviewer user ${user} does not exist`, user }
  }
  if ((await opts.runner(SUDO, ['-n', '-u', user, '--', 'true'])).exitCode !== 0) {
    return {
      state: 'broken',
      detail: `sudo cannot run commands as ${user} without a password (sudoers rule missing?)`,
      user,
    }
  }
  const writable: string[] = []
  for (const path of opts.protectedPaths) {
    const r = await opts.runner(SUDO, ['-n', '-u', user, '--', 'test', '-w', path])
    if (r.exitCode === 0) writable.push(path)
  }
  if (writable.length > 0) {
    return { state: 'broken', detail: `${user} can write ${writable.join(', ')}`, user }
  }
  return { state: 'active', detail: `active: direct reviews run as ${user}`, user }
}

// the reviewer user keeps its own HOME/PATH/temp dir; only credentials and network settings pass
const NOT_PASSED = new Set(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'USER', 'LOGNAME', 'SHELL'])

/**
 * The sudo invocation that runs `command` as the reviewer user in `workdir` with a filtered
 * environment. sudo keeps the caller's cwd, which the reviewer user cannot enter (and the caller
 * cannot enter the reviewer's 0700 workdir), so `env -C` changes directory as the reviewer.
 */
export function isolatedReviewerLaunch(
  config: IsolationConfig,
  command: string,
  args: string[],
  workdir: string,
  env: Record<string, string>,
): { file: string; args: string[]; env: Record<string, string> } {
  const passed: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) if (!NOT_PASSED.has(k.toUpperCase())) passed[k] = v
  const keys = Object.keys(passed)
  return {
    file: SUDO,
    args: [
      '-n',
      '-u',
      config.user,
      ...(keys.length ? [`--preserve-env=${keys.join(',')}`] : []),
      '--',
      'env',
      '-C',
      workdir,
      command,
      ...args,
    ],
    env: passed,
  }
}

export const probeRunner: IsolationRunner = async (file, args, opts = {}) => {
  const r = await execa(file, args, {
    reject: false,
    timeout: 15_000,
    ...(opts.input === undefined ? { stdin: 'ignore' as const } : { input: opts.input }),
  })
  return {
    exitCode: typeof r.exitCode === 'number' ? r.exitCode : -1,
    stdout: String(r.stdout ?? ''),
    stderr: String(r.stderr ?? ''),
  }
}

/** Setup runner: sudo may prompt on the terminal; command output is shown, tee's echo is not. */
export const interactiveRunner: IsolationRunner = async (file, args, opts = {}) => {
  const r = await execa(file, args, {
    reject: false,
    stdout: opts.input === undefined ? 'inherit' : 'ignore',
    stderr: 'inherit',
    ...(opts.input === undefined ? { stdin: 'inherit' as const } : { input: opts.input }),
  })
  return { exitCode: typeof r.exitCode === 'number' ? r.exitCode : -1, stdout: '', stderr: '' }
}

export async function probeHostFacts(
  user: string,
  configPath: string,
  runner: IsolationRunner = probeRunner,
): Promise<HostFacts> {
  assertUserName(user)
  const [id, sudoers, config] = await Promise.all([
    runner('id', ['-u', user]),
    // /etc/sudoers.d is root-only readable on most distros: ask sudo -n, fall back to "missing"
    runner(SUDO, ['-n', '-u', user, '--', 'true']),
    readFile(configPath).then(
      () => true,
      () => false,
    ),
  ])
  return {
    userExists: id.exitCode === 0,
    sudoersExists: sudoers.exitCode === 0,
    configExists: config,
  }
}

export async function makeIsolatedWorkdir(
  config: IsolationConfig,
  runner: IsolationRunner = probeRunner,
): Promise<string> {
  const r = await runner(SUDO, [
    '-n',
    '-u',
    config.user,
    '--',
    'mktemp',
    '-d',
    '/tmp/between-review-XXXXXXXX',
  ])
  const path = r.stdout.trim()
  if (r.exitCode !== 0 || !path.startsWith('/tmp/between-review-')) {
    throw new Error(
      `could not create the reviewer workdir as ${config.user}: ${r.stderr.trim().split('\n')[0] || `exit ${r.exitCode}`}`,
    )
  }
  return path
}

export async function removeIsolatedWorkdir(
  config: IsolationConfig,
  path: string,
  runner: IsolationRunner = probeRunner,
): Promise<void> {
  const r = await runner(SUDO, ['-n', '-u', config.user, '--', 'rm', '-rf', '--', path])
  if (r.exitCode !== 0) {
    process.stderr.write(`between: could not remove reviewer temp dir ${path} as ${config.user}\n`)
  }
}

/**
 * What the reviewer user must not be able to write: the journal anchor store, `.between/`, the
 * journal, and `state.json`. A path that does not exist yet is checked at its nearest existing
 * ancestor, since a writable parent would let the reviewer create it.
 */
export function protectedPathsFor(root: string, anchor: string = anchorDir()): string[] {
  const p = betweenPaths(root)
  return [...new Set([anchor, p.dir, p.events, p.state].map(nearestExisting))]
}

function nearestExisting(path: string): string {
  let current = resolve(path)
  while (!existsSync(current)) {
    const up = dirname(current)
    if (up === current) break
    current = up
  }
  return current
}
