import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { execa } from 'execa'
import { anchorDir, anchorId } from './journal-anchor'
import { betweenPaths } from './paths'

/**
 * Opt-in reviewer isolation: run the direct-review reviewer CLI as a dedicated OS user that
 * cannot write the invoking user's journal anchor, `.between/` journal, or `state.json`.
 *
 * Linux only for now: a system user plus a sudoers rule that lets the invoking uid (and nobody
 * else) start commands as that user without a password. The opt-in is a root-owned file under
 * /etc, so a process running as the invoking user cannot switch isolation off without root.
 * macOS and Windows are documented follow-ups (docs/AGENT-CONTRACT.md); setup refuses there.
 *
 * Every command run as root is an absolute path: `between` may be started with a
 * workspace-controlled PATH (npx, npm scripts), and a fake `sudo` or `useradd` there must not run.
 */
export interface IsolationConfig {
  schema_version: 1
  platform: 'linux'
  user: string
  uid: number
  invoking_uid: number
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
  opts?: { input?: string; capture?: boolean },
) => Promise<IsolationRunResult>

export type IsolationStep =
  | { kind: 'run'; description: string; command: string[]; input?: string }
  | { kind: 'verify-uid'; description: string; user: string; uid: number }
  | { kind: 'verify-file'; description: string; path: string; content: string }
  | {
      kind: 'write-config'
      description: string
      path: string
      user: string
      invokingUid: number
    }

export type IsolationPlan =
  | { supported: true; user: string; steps: IsolationStep[]; after: string[] }
  | { supported: false; reason: string }

export interface HostFacts {
  userExists: boolean
  configExists: boolean
}

export const DEFAULT_REVIEWER_USER = 'between-reviewer'
export const ISOLATION_CONFIG_DIR = '/etc/between/reviewer-isolation'
export const SUDO = '/usr/bin/sudo'
const ID = '/usr/bin/id'
const SH = '/bin/sh'
const ENV = '/usr/bin/env'
const USER_NAME = /^[a-z_][a-z0-9_-]{0,30}$/
const UNSUPPORTED =
  'reviewer isolation is not implemented on this platform yet (Linux only); see "Reviewer isolation" in docs/AGENT-CONTRACT.md for the planned macOS/Windows design'

const sudoersPath = (user: string) => `/etc/sudoers.d/${user}`
// sudo ignores sudoers.d entries containing a '.', so the rule is inert until visudo accepts it
const pendingSudoersPath = (user: string) => `${sudoersPath(user)}.pending`
const reviewerHome = (user: string) => `/var/lib/${user}`
export const sudoersRule = (invokingUid: number, user: string) =>
  `#${invokingUid} ALL=(${user}) NOPASSWD:SETENV: ALL\n`

function assertUserName(user: string): void {
  if (!USER_NAME.test(user) || user === 'root') {
    throw new Error(
      `invalid reviewer user name ${JSON.stringify(user)}: use [a-z_][a-z0-9_-]* (not root)`,
    )
  }
}

/** The root-owned opt-in for `uid`, or null where isolation cannot exist (Windows). */
export function isolationConfigPath(
  opts: { platform?: NodeJS.Platform; uid?: number } = {},
): string | null {
  const platform = opts.platform ?? process.platform
  if (platform === 'win32') return null
  const uid = opts.uid ?? process.getuid?.()
  if (uid === undefined) return null
  return `${ISOLATION_CONFIG_DIR}/${uid}.json`
}

/** The saved isolation config, or null when isolation was never set up. Malformed throws. */
export async function readIsolationConfig(path: string | null): Promise<IsolationConfig | null> {
  if (!path) return null
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
  const positiveInt = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n > 0
  if (
    !v ||
    v.schema_version !== 1 ||
    v.platform !== 'linux' ||
    v.method !== 'sudo' ||
    typeof v.user !== 'string' ||
    !USER_NAME.test(v.user) ||
    v.user === 'root' ||
    !positiveInt(v.uid) ||
    typeof v.invoking_uid !== 'number' ||
    !Number.isInteger(v.invoking_uid) ||
    v.uid === v.invoking_uid
  ) {
    throw new Error(`reviewer isolation config ${path} is malformed`)
  }
  return {
    schema_version: 1,
    platform: 'linux',
    user: v.user,
    uid: v.uid as number,
    invoking_uid: v.invoking_uid,
    method: 'sudo',
  }
}

export function planIsolationSetup(opts: {
  platform: NodeJS.Platform
  user: string
  invokingUid: number
  configPath: string | null
  facts: HostFacts
}): IsolationPlan {
  assertUserName(opts.user)
  if (opts.platform !== 'linux' || !opts.configPath) {
    return { supported: false, reason: UNSUPPORTED }
  }
  const { user } = opts
  if (opts.facts.configExists) {
    return {
      supported: true,
      user,
      steps: [],
      after: ['Isolation is already set up. Check it with: between isolation status'],
    }
  }
  if (opts.facts.userExists) {
    throw new Error(
      `the user ${user} already exists and was not created by \`between isolation setup\`; refusing to reuse it. Pick another --user, or remove that account yourself if it is a leftover.`,
    )
  }
  const pending = pendingSudoersPath(user)
  return {
    supported: true,
    user,
    steps: [
      {
        kind: 'run',
        description: `create the system user ${user} (no login shell, home ${reviewerHome(user)})`,
        command: [
          SUDO,
          '/usr/sbin/useradd',
          '--system',
          '--create-home',
          '--home-dir',
          reviewerHome(user),
          '--shell',
          '/usr/sbin/nologin',
          user,
        ],
      },
      {
        kind: 'run',
        description: `refuse to overwrite an existing ${sudoersPath(user)}`,
        command: [SUDO, SH, '-c', 'test ! -e "$1"', 'sh', sudoersPath(user)],
      },
      {
        kind: 'run',
        description: `write the sudoers rule letting uid ${opts.invokingUid} (you) run commands as ${user} without a password (inert until checked)`,
        command: [SUDO, '/usr/bin/tee', pending],
        input: sudoersRule(opts.invokingUid, user),
      },
      {
        kind: 'run',
        description: 'make the rule root-only readable',
        command: [SUDO, '/bin/chmod', '0440', pending],
      },
      {
        kind: 'run',
        description: 'check the rule with visudo',
        command: [SUDO, '/usr/sbin/visudo', '-cf', pending],
      },
      {
        kind: 'run',
        description: 'activate the checked rule',
        command: [SUDO, '/bin/mv', pending, sudoersPath(user)],
      },
      {
        kind: 'run',
        description: 'create the root-owned opt-in directory',
        command: [SUDO, '/bin/mkdir', '-p', ISOLATION_CONFIG_DIR],
      },
      {
        kind: 'write-config',
        description: 'record the opt-in (root-owned, mode 0644, outside any project)',
        path: opts.configPath,
        user,
        invokingUid: opts.invokingUid,
      },
    ],
    after: [
      `Install the reviewer CLI where ${user} can run it: on sudo's secure_path (e.g. /usr/local/bin on Debian/Ubuntu) or in /usr/bin. Then sign it in as that user: sudo -u ${user} -H codex login (or claude). Between passes only the reviewer's own provider API key, proxy/CA, and locale variables from your environment.`,
      'Check with: between isolation status (or between doctor).',
    ],
  }
}

export function planIsolationRemoval(opts: {
  platform: NodeJS.Platform
  configPath: string | null
  config: IsolationConfig | null
}): IsolationPlan {
  if (opts.platform !== 'linux' || !opts.configPath) {
    return { supported: false, reason: UNSUPPORTED }
  }
  const { config } = opts
  if (!config) {
    return {
      supported: true,
      user: DEFAULT_REVIEWER_USER,
      steps: [],
      after: ['Reviewer isolation is not set up; nothing to remove.'],
    }
  }
  const { user } = config
  return {
    supported: true,
    user,
    steps: [
      {
        kind: 'verify-uid',
        description: `check that ${user} is still the account setup created (uid ${config.uid})`,
        user,
        uid: config.uid,
      },
      {
        kind: 'verify-file',
        description: `check that ${sudoersPath(user)} is missing or holds exactly the rule setup wrote`,
        path: sudoersPath(user),
        content: sudoersRule(config.invoking_uid, user),
      },
      {
        kind: 'run',
        description: `remove the sudoers rule for ${user}`,
        command: [SUDO, '/bin/rm', '-f', sudoersPath(user)],
      },
      {
        kind: 'run',
        description: `delete the user ${user} and its home (its reviewer CLI sign-in goes too)`,
        command: [SUDO, '/usr/sbin/userdel', '--remove', user],
      },
      {
        kind: 'run',
        description: 'remove the opt-in',
        command: [SUDO, '/bin/rm', '-f', opts.configPath],
      },
    ],
    after: [],
  }
}

function configPreview(step: Extract<IsolationStep, { kind: 'write-config' }>): string {
  return `{"schema_version":1,"platform":"linux","user":"${step.user}","uid":<uid useradd assigned>,"invoking_uid":${step.invokingUid},"method":"sudo"}`
}

function describeStep(step: IsolationStep): string[] {
  const lines = [`  - ${step.description}`]
  if (step.kind === 'run') {
    lines.push(`      $ ${step.command.join(' ')}`)
    if (step.input !== undefined) {
      for (const l of step.input.trimEnd().split('\n')) lines.push(`      | ${l}`)
    }
  } else if (step.kind === 'write-config') {
    lines.push(`      $ ${SUDO} /usr/bin/tee ${step.path}`)
    lines.push(`      | ${configPreview(step)}`)
    lines.push(`      $ ${SUDO} /bin/chmod 0644 ${step.path}`)
  } else if (step.kind === 'verify-uid') {
    lines.push(`      $ ${ID} -u ${step.user}   (must print ${step.uid})`)
  } else {
    lines.push(`      $ ${SUDO} ${SH} -c '[ ! -e "$1" ] || cat "$1"' sh ${step.path}`)
  }
  return lines
}

function firstLine(r: IsolationRunResult): string {
  return r.stderr.trim().split('\n')[0] || `exit ${r.exitCode}`
}

async function uidOf(user: string, runner: IsolationRunner): Promise<number | null> {
  const r = await runner(ID, ['-u', user], { capture: true })
  const uid = Number(r.stdout.trim())
  return r.exitCode === 0 && Number.isInteger(uid) && r.stdout.trim() !== '' ? uid : null
}

async function runStep(step: IsolationStep, runner: IsolationRunner): Promise<void> {
  if (step.kind === 'run') {
    const [file, ...args] = step.command
    const r = await runner(file!, args, step.input === undefined ? {} : { input: step.input })
    if (r.exitCode !== 0) {
      throw new Error(`step failed: ${step.command.join(' ')}: ${firstLine(r)}`)
    }
    return
  }
  if (step.kind === 'verify-uid') {
    const uid = await uidOf(step.user, runner)
    if (uid !== step.uid) {
      throw new Error(
        `refusing: ${step.user} has uid ${uid ?? 'none'}, not the uid ${step.uid} that setup created`,
      )
    }
    return
  }
  if (step.kind === 'verify-file') {
    const r = await runner(SUDO, [SH, '-c', '[ ! -e "$1" ] || cat "$1"', 'sh', step.path], {
      capture: true,
    })
    if (r.exitCode !== 0) throw new Error(`could not read ${step.path}: ${firstLine(r)}`)
    if (r.stdout !== '' && r.stdout !== step.content) {
      throw new Error(`refusing: ${step.path} is not the rule setup wrote; left untouched`)
    }
    return
  }
  const uid = await uidOf(step.user, runner)
  if (uid === null || uid <= 0 || uid === step.invokingUid) {
    throw new Error(`refusing to record ${step.user}: unexpected uid ${uid ?? 'none'}`)
  }
  const content: IsolationConfig = {
    schema_version: 1,
    platform: 'linux',
    user: step.user,
    uid,
    invoking_uid: step.invokingUid,
    method: 'sudo',
  }
  for (const [args, input] of [
    [['/usr/bin/tee', step.path], `${JSON.stringify(content, null, 2)}\n`],
    [['/bin/chmod', '0644', step.path], undefined],
  ] as const) {
    const r = await runner(SUDO, [...args], input === undefined ? {} : { input })
    if (r.exitCode !== 0) throw new Error(`step failed: sudo ${args.join(' ')}: ${firstLine(r)}`)
  }
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
    for (const line of plan.after) io.print(`between: ${line}`)
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
  for (const [i, step] of plan.steps.entries()) {
    try {
      await runStep(step, io.runner)
    } catch (e) {
      if (i > 0) {
        io.print(
          `between: stopped after ${i} of ${plan.steps.length} steps; the earlier steps were applied (see the list above).`,
        )
      }
      throw e
    }
  }
  for (const line of plan.after) io.print(line)
  return 'applied'
}

export type IsolationState = 'off' | 'active' | 'broken' | 'unsupported'
export interface IsolationStatus {
  state: IsolationState
  detail: string
  config?: IsolationConfig
}

// W when the reviewer could replace the entry: writable, and not a sticky dir it does not own
const PROBE =
  'for p; do if test -w "$p" && { ! test -k "$p" || test -O "$p"; }; then echo W; else echo R; fi; done'

/**
 * Whether isolation is really in force: the opt-in exists, the reviewer user still has the
 * recorded uid, sudo can switch to it without a password, and that user cannot write (or replace)
 * any of `protectedPaths`. A probe that does not answer for every path counts as broken.
 */
export async function checkIsolation(opts: {
  platform: NodeJS.Platform
  configPath: string | null
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
    return { state: 'unsupported', detail: `configured for ${user}, but ${UNSUPPORTED}`, config }
  }
  const uid = await uidOf(user, opts.runner)
  if (uid !== config.uid) {
    return {
      state: 'broken',
      detail: `the reviewer user ${user} ${uid === null ? 'does not exist' : `has uid ${uid}, not ${config.uid}`}`,
      config,
    }
  }
  const r = await opts.runner(
    SUDO,
    ['-n', '-u', user, '--', SH, '-c', PROBE, 'sh', ...opts.protectedPaths],
    { capture: true },
  )
  const answers = r.stdout.trim() === '' ? [] : r.stdout.trim().split('\n')
  if (
    r.exitCode !== 0 ||
    answers.length !== opts.protectedPaths.length ||
    answers.some((a) => a !== 'R' && a !== 'W')
  ) {
    return {
      state: 'broken',
      detail: `could not probe as ${user} (sudo -n failed or no answer: ${firstLine(r)})`,
      config,
    }
  }
  const writable = opts.protectedPaths.filter((_, i) => answers[i] === 'W')
  if (writable.length > 0) {
    return { state: 'broken', detail: `${user} can write ${writable.join(', ')}`, config }
  }
  return { state: 'active', detail: `active: direct reviews run as ${user}`, config }
}

/**
 * The config to run the reviewer under, or null when isolation is off (or cannot exist here).
 * Throws when isolation is configured but not fully in force, so the review fails closed.
 */
export async function requireActiveIsolation(opts: {
  platform: NodeJS.Platform
  configPath: string | null
  protectedPaths: string[]
  runner: IsolationRunner
}): Promise<IsolationConfig | null> {
  const status = await checkIsolation(opts)
  if (status.state === 'off' || (status.state === 'unsupported' && !status.config)) return null
  if (status.state !== 'active' || !status.config) {
    throw new Error(`reviewer isolation is configured but not in force: ${status.detail}`)
  }
  return status.config
}

const NETWORK_ENV = new Set([
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
])
const LOCALE_ENV = new Set(['LANG', 'LANGUAGE', 'TZ'])
const EXTRA_ENV = new Set(['CLAUDE_CODE_SUBPROCESS_ENV_SCRUB'])

/**
 * The sudo invocation that runs `command` as the reviewer user in `workdir`. Only the reviewer's
 * own credential variables plus proxy/CA and locale settings pass; its HOME, PATH, and config dirs
 * are its own. sudo keeps the caller's cwd, which the reviewer user cannot enter (and the caller
 * cannot enter the reviewer's 0700 workdir), so `env -C` changes directory as the reviewer.
 */
export function isolatedReviewerLaunch(
  config: IsolationConfig,
  command: string,
  args: string[],
  workdir: string,
  env: Record<string, string>,
  credentialVars: readonly string[],
): { file: string; args: string[]; env: Record<string, string> } {
  const credentials = new Set(credentialVars.map((k) => k.toUpperCase()))
  const passed: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    const upper = k.toUpperCase()
    if (
      credentials.has(upper) ||
      NETWORK_ENV.has(upper) ||
      LOCALE_ENV.has(upper) ||
      EXTRA_ENV.has(upper) ||
      upper.startsWith('LC_')
    ) {
      passed[k] = v
    }
  }
  const keys = Object.keys(passed)
  return {
    file: SUDO,
    args: [
      '-n',
      '-u',
      config.user,
      ...(keys.length ? [`--preserve-env=${keys.join(',')}`] : []),
      '--',
      ENV,
      '-C',
      workdir,
      command,
      ...args,
    ],
    env: passed,
  }
}

/**
 * What the reviewer user must not be able to write or replace: this project's anchor file, its
 * journal and `state.json`, and every existing directory above them (a writable ancestor would let
 * it swap the whole subtree). A path that does not exist yet is covered by its existing ancestors.
 */
export function protectedPathsFor(root: string, anchorStore: string = anchorDir()): string[] {
  const p = betweenPaths(root)
  const targets = [join(anchorStore, `${anchorId(root)}.json`), p.events, p.state]
  const out = new Set<string>()
  for (const target of targets) {
    let current = resolve(target)
    if (existsSync(current)) out.add(current)
    for (;;) {
      const up = dirname(current)
      if (up === current) break
      current = up
      if (existsSync(current)) out.add(current)
    }
  }
  return [...out]
}

export const probeRunner: IsolationRunner = async (file, args, opts = {}) => {
  const r = await execa(file, args, {
    reject: false,
    stripFinalNewline: false,
    timeout: 15_000,
    extendEnv: false,
    env: {},
    ...(opts.input === undefined ? { stdin: 'ignore' as const } : { input: opts.input }),
  })
  return {
    exitCode: typeof r.exitCode === 'number' ? r.exitCode : -1,
    stdout: String(r.stdout ?? ''),
    stderr: String(r.stderr ?? ''),
  }
}

/** Setup/remove runner: sudo may prompt on the terminal; output is shown unless captured. */
export const interactiveRunner: IsolationRunner = async (file, args, opts = {}) => {
  const r = await execa(file, args, {
    reject: false,
    stripFinalNewline: false,
    stdout: opts.capture ? 'pipe' : opts.input === undefined ? 'inherit' : 'ignore',
    stderr: 'inherit',
    ...(opts.input === undefined ? { stdin: 'inherit' as const } : { input: opts.input }),
  })
  return {
    exitCode: typeof r.exitCode === 'number' ? r.exitCode : -1,
    stdout: opts.capture ? String(r.stdout ?? '') : '',
    stderr: '',
  }
}

export async function probeHostFacts(
  user: string,
  configPath: string,
  runner: IsolationRunner = probeRunner,
): Promise<HostFacts> {
  assertUserName(user)
  const [uid, config] = await Promise.all([
    uidOf(user, runner),
    readFile(configPath).then(
      () => true,
      () => false,
    ),
  ])
  return { userExists: uid !== null, configExists: config }
}

export async function makeIsolatedWorkdir(
  config: IsolationConfig,
  runner: IsolationRunner = probeRunner,
): Promise<string> {
  const r = await runner(
    SUDO,
    ['-n', '-u', config.user, '--', '/bin/mktemp', '-d', '/tmp/between-review-XXXXXXXX'],
    { capture: true },
  )
  const path = r.stdout.trim()
  if (r.exitCode !== 0 || !/^\/tmp\/between-review-[A-Za-z0-9]{8}$/.test(path)) {
    throw new Error(`could not create the reviewer workdir as ${config.user}: ${firstLine(r)}`)
  }
  return path
}

export async function removeIsolatedWorkdir(
  config: IsolationConfig,
  path: string,
  runner: IsolationRunner = probeRunner,
): Promise<void> {
  const r = await runner(SUDO, ['-n', '-u', config.user, '--', '/bin/rm', '-rf', '--', path])
  if (r.exitCode !== 0) {
    process.stderr.write(`between: could not remove reviewer temp dir ${path} as ${config.user}\n`)
  }
}

/** After a timeout: execa kills sudo, so also kill whatever still runs as the reviewer user. */
export async function killReviewerProcesses(
  config: IsolationConfig,
  runner: IsolationRunner = probeRunner,
): Promise<void> {
  await runner(SUDO, ['-n', '-u', config.user, '--', '/usr/bin/pkill', '-KILL', '-u', config.user])
}
