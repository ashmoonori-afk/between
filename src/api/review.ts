import { createHash, randomBytes } from 'node:crypto'
import { constants as fsConstants, existsSync, realpathSync } from 'node:fs'
import { access, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { execa } from 'execa'
import { fetchSubjectText } from '../review/fetch-subject'
import { GitAdapter, GitError } from '../adapters/git'
import { betweenPaths } from '../adapters/paths'
import { redactSecrets } from '../core/redact'
import { isDeniedUntrackedPath } from '../core/untracked-policy'
import { loadConfig } from '../runtime'
import {
  RUBRICS,
  ReviewerOutputError,
  buildReviewPrompt,
  fakeReviewerOutput,
  parseReviewerOutput,
  resolveReviewer,
  reviewerInvocation,
  type HostAgent,
  type ParsedReview,
  type ReviewKind,
  type ReviewerPreset,
  type ReviewerRoute,
} from '../review/direct'
import { BetweenApiError } from './errors'

export const MAX_REVIEW_SUBJECT_BYTES = 256 * 1024
const DEFAULT_REVIEW_TIMEOUT_MS = 900_000
const URL_FETCH_TIMEOUT_MS = 20_000

export interface ReviewRequest {
  kind: ReviewKind
  /** inline subject: the answer, the plan, or a unified diff */
  text?: string
  /** subject file, resolved against the project root; must stay inside it */
  file?: string
  url?: string
  /** diff only: commit to diff the working tree against (default HEAD) */
  base?: string
  context?: string
  focus?: string
  criteria?: string[]
  reviewer?: ReviewerPreset
  /** the agent asking for the review; the other agent of the pair reviews */
  from?: HostAgent
}

export type ReviewSubjectSource = 'git' | 'file' | 'url' | 'text'

export interface ReviewResult extends ParsedReview {
  kind: ReviewKind
  reviewer: ReviewerPreset
  routed_by: ReviewerRoute
  rubric: string[]
  subject: {
    source: ReviewSubjectSource
    label: string
    bytes: number
    sha256: string
    /** secret-like values replaced with [REDACTED] before the subject left this machine */
    redactions: number
  }
}

export interface ReviewerRunOptions {
  timeoutMs: number
  /** only used to keep project paths out of the reviewer's environment */
  projectRoot: string
}

export interface ReviewDeps {
  runReviewer?: (
    preset: ReviewerPreset,
    prompt: string,
    opts: ReviewerRunOptions,
  ) => Promise<string>
  fetchText?: (url: string) => Promise<string>
}

interface Subject {
  source: ReviewSubjectSource
  label: string
  text: string
}

/**
 * One-shot review of a diff, an answer, or a plan by the paired agent. Works without
 * `between init` for answer/plan reviews; an initialized repo contributes its reviewer pairing
 * and review timeout.
 */
export async function requestReview(
  root: string,
  req: ReviewRequest,
  deps: ReviewDeps = {},
): Promise<ReviewResult> {
  validateRequest(req)
  const realRoot = await realpath(root).catch(() => {
    throw invalid(`root is not an existing directory: ${root}`)
  })
  const config = existsSync(betweenPaths(realRoot).config) ? await loadConfig(realRoot) : null

  const route = resolveReviewer({
    reviewer: req.reviewer,
    from: req.from,
    reviewerCommand: config?.reviewer_command ?? null,
  })
  if (!route) {
    throw invalid(
      'no reviewer agent: pass reviewer (claude | codex), or from (the calling agent) so the other agent reviews, or configure reviewer_command with a claude/codex agent',
    )
  }

  const subject = await loadSubject(realRoot, req, deps)
  const bytes = Buffer.byteLength(subject.text, 'utf8')
  if (bytes > MAX_REVIEW_SUBJECT_BYTES) {
    throw invalid(`subject is ${bytes} bytes; the limit is ${MAX_REVIEW_SUBJECT_BYTES}`)
  }
  const redactedSubject = redactSecrets(subject.text)
  const redactedContext = req.context ? redactSecrets(req.context) : null

  const prompt = buildReviewPrompt({
    kind: req.kind,
    subject: redactedSubject.text,
    subjectLabel: subject.label,
    context: redactedContext?.text,
    focus: req.focus,
    criteria: req.criteria,
    boundary: `BETWEEN-${randomBytes(8).toString('hex')}`,
  })
  const run = deps.runReviewer ?? runReviewerCli
  const timeoutMs = config ? config.review_timeout_seconds * 1000 : DEFAULT_REVIEW_TIMEOUT_MS
  const reply = await run(route.preset, prompt, { timeoutMs, projectRoot: realRoot })

  let parsed: ParsedReview
  try {
    parsed = parseReviewerOutput(reply)
  } catch (e) {
    if (!(e instanceof ReviewerOutputError)) throw e
    throw new BetweenApiError(
      'reviewer_failed',
      `${route.preset} reviewer did not return a valid verdict: ${excerpt(reply)}`,
    )
  }
  return {
    kind: req.kind,
    reviewer: route.preset,
    routed_by: route.routed_by,
    ...parsed,
    rubric: RUBRICS[req.kind].map((c) => c.name),
    subject: {
      source: subject.source,
      label: subject.label,
      bytes,
      sha256: createHash('sha256').update(subject.text).digest('hex'),
      redactions: redactedSubject.redactedCount + (redactedContext?.redactedCount ?? 0),
    },
  }
}

function validateRequest(req: ReviewRequest): void {
  const given = [req.text, req.file, req.url].filter((v) => v !== undefined)
  if (given.length > 1) throw invalid('pass at most one of text, file, url')
  if (req.text !== undefined && !req.text.trim()) throw invalid('text is empty')
  if (req.kind !== 'diff' && given.length === 0) {
    throw invalid(`a ${req.kind} review needs text, file, or url`)
  }
  if (req.base !== undefined && (req.kind !== 'diff' || given.length > 0)) {
    throw invalid('base applies only to a diff review of the working tree')
  }
  if (req.reviewer !== undefined && req.reviewer === req.from) {
    throw invalid(`${req.from} cannot review its own work; the other agent of the pair reviews`)
  }
}

async function loadSubject(root: string, req: ReviewRequest, deps: ReviewDeps): Promise<Subject> {
  if (req.text !== undefined) return { source: 'text', label: 'inline text', text: req.text }
  if (req.file !== undefined) return readProjectFile(root, req.file)
  if (req.url !== undefined) return fetchUrl(req.url, deps.fetchText ?? defaultFetchText)
  const git = new GitAdapter(root)
  if (!(await git.isRepo())) throw invalid(`not a git repository: ${root}`)
  let diff: string
  try {
    diff = await git.diffAgainst(req.base)
  } catch (e) {
    if (e instanceof GitError) throw invalid(e.message)
    throw e
  }
  const label = `git diff ${req.base ?? 'HEAD'}`
  if (!diff.trim()) throw invalid(`no tracked changes to review (${label})`)
  return { source: 'git', label, text: diff }
}

async function readProjectFile(root: string, file: string): Promise<Subject> {
  let real: string
  try {
    real = await realpath(resolve(root, file))
  } catch {
    throw invalid(`file not found: ${file}`)
  }
  const rel = relative(root, real)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw invalid(`file is outside the project root: ${file}`)
  }
  const relPosix = rel.split(sep).join('/')
  if (isDeniedUntrackedPath(relPosix) || relPosix === '.git' || relPosix.startsWith('.git/')) {
    throw invalid(`file is on the review denylist (.between/, .git/, .env*): ${relPosix}`)
  }
  const info = await stat(real)
  if (!info.isFile()) throw invalid(`not a regular file: ${relPosix}`)
  if (info.size > MAX_REVIEW_SUBJECT_BYTES) {
    throw invalid(`file is ${info.size} bytes; the limit is ${MAX_REVIEW_SUBJECT_BYTES}`)
  }
  const content = await readFile(real)
  if (content.includes(0)) throw invalid(`binary file cannot be reviewed: ${relPosix}`)
  return { source: 'file', label: relPosix, text: content.toString('utf8') }
}

async function fetchUrl(
  url: string,
  fetchText: (url: string) => Promise<string>,
): Promise<Subject> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw invalid(`not a valid URL: ${url}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw invalid(`only http(s) URLs can be reviewed: ${url}`)
  }
  const text = await fetchText(parsed.href)
  if (!text.trim()) throw invalid(`URL returned an empty body: ${url}`)
  return { source: 'url', label: parsed.href, text }
}

async function defaultFetchText(url: string): Promise<string> {
  try {
    return await fetchSubjectText(url, {
      maxBytes: MAX_REVIEW_SUBJECT_BYTES,
      timeoutMs: URL_FETCH_TIMEOUT_MS,
    })
  } catch (e) {
    throw invalid(`could not fetch ${url}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

const PROVIDER_AUTH_BY_PRESET: Record<'claude' | 'codex', readonly string[]> = {
  claude: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'],
  codex: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
}

/** Runtime variables a reviewer CLI needs to start, sign in, and reach its provider. */
const REVIEWER_RUNTIME_ENV = new Set([
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TERM',
  'NO_COLOR',
  'CODEX_HOME',
  'CLAUDE_CONFIG_DIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
])

/**
 * Allowlisted reviewer environment: runtime variables plus the reviewer's own provider
 * credentials only (no other provider's key, no other credential). Anything that points into the
 * project (BETWEEN_ROOT, INIT_CWD, PWD, project entries on PATH, ...) is dropped so the reviewer
 * is not told where the repository is. No new keys are needed.
 */
export function reviewerEnv(
  preset: 'claude' | 'codex',
  projectRoot: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const own = new Set(PROVIDER_AUTH_BY_PRESET[preset])
  const roots = projectRoots(projectRoot)
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue
    const upper = name.toUpperCase()
    if (own.has(upper)) {
      env[name] = value
    } else if (upper === 'PATH') {
      env[name] = value
        .split(delimiter)
        .filter((entry) => entry && !pointsInto(roots, entry))
        .join(delimiter)
    } else if (REVIEWER_RUNTIME_ENV.has(upper) && !pointsInto(roots, value)) {
      env[name] = value
    }
  }
  // managed-policy hooks still run under --safe-mode; keep the credential out of their env
  if (preset === 'claude') env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = '1'
  return env
}

/** The project root as given and canonical (symlinks and aliases like /var -> /private/var). */
function projectRoots(projectRoot: string): string[] {
  const lexical = resolve(projectRoot)
  let canonical = lexical
  try {
    canonical = realpathSync.native(lexical)
  } catch {
    // a missing root has no aliases to resolve
  }
  return [...new Set([lexical, canonical])]
}

/** Whether a value names, contains, or resolves (through symlinks) to a path inside the project. */
function pointsInto(roots: readonly string[], value: string): boolean {
  if (roots.some((root) => value.includes(root))) return true
  if (!isAbsolute(value)) return false
  let canonical = resolve(value)
  try {
    canonical = realpathSync.native(canonical)
  } catch {
    // not an existing path: the lexical checks above are all we can do
  }
  return roots.some((root) => isInside(root, resolve(value)) || isInside(root, canonical))
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Find the reviewer CLI on the (already filtered) PATH ourselves and refuse any candidate whose
 * canonical path lies inside the project, so a repository-controlled `claude`/`codex` binary can
 * never receive the prompt or the provider credential.
 */
export async function resolveReviewerBinary(
  name: string,
  env: Record<string, string>,
  projectRoot: string,
): Promise<string | null> {
  const roots = projectRoots(projectRoot)
  const pathValue = Object.entries(env).find(([k]) => k.toUpperCase() === 'PATH')?.[1] ?? ''
  const extValue = Object.entries(env).find(([k]) => k.toUpperCase() === 'PATHEXT')?.[1]
  const exts =
    process.platform === 'win32'
      ? (extValue ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
      : ['']
  // relative entries would be checked against Between's cwd but run from the reviewer's cwd
  for (const dir of pathValue.split(delimiter).filter((entry) => isAbsolute(entry))) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext)
      let canonical: string
      try {
        canonical = await realpath(candidate)
        if (!(await stat(canonical)).isFile()) continue
        if (process.platform !== 'win32') await access(canonical, fsConstants.X_OK)
      } catch {
        continue
      }
      if (roots.some((root) => isInside(root, canonical) || isInside(root, resolve(candidate)))) {
        continue
      }
      // run exactly the file that was checked: no second symlink walk, no cwd-relative lookup
      return canonical
    }
  }
  return null
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name)
  return key === undefined ? undefined : env[key]
}

/**
 * Windows runs `.cmd`/`.bat` shims through `ComSpec` taken from Between's own environment, not
 * the filtered child env. Refuse unless it is the system `cmd.exe`, outside the project, so a
 * substituted interpreter can never receive the prompt or the provider credential.
 */
export function assertTrustedBatchShell(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const systemRoot = envValue(env, 'SYSTEMROOT') ?? envValue(env, 'WINDIR') ?? 'C:\\Windows'
  const trusted = join(systemRoot, 'System32', 'cmd.exe')
  const comspec = envValue(env, 'COMSPEC') ?? trusted
  const canon = (p: string): string => {
    try {
      return realpathSync.native(p)
    } catch {
      return resolve(p)
    }
  }
  const roots = projectRoots(projectRoot)
  const trustedCanon = canon(trusted)
  if (
    canon(comspec).toLowerCase() !== trustedCanon.toLowerCase() ||
    roots.some((root) => isInside(root, trustedCanon))
  ) {
    throw new BetweenApiError(
      'reviewer_failed',
      `ComSpec (${comspec}) is not the system cmd.exe (${trusted}); refusing to run the reviewer's batch shim`,
    )
  }
}

/**
 * Create the reviewer's empty working directory and fail closed if TMPDIR/TEMP/TMP put it inside
 * the project, where the reviewer could rediscover project settings, hooks, or instructions.
 */
export async function makeReviewerWorkdir(
  projectRoot: string,
  base: string = tmpdir(),
): Promise<{ created: string; workdir: string }> {
  const created = await mkdtemp(join(base, 'between-review-'))
  const workdir = await realpath(created)
  const roots = projectRoots(projectRoot)
  if (roots.some((root) => isInside(root, workdir) || isInside(root, resolve(created)))) {
    await removeWorkdir(created)
    throw new BetweenApiError(
      'reviewer_failed',
      `the temporary directory (${base}) is inside the project; point TMPDIR/TEMP/TMP outside it`,
    )
  }
  return { created, workdir }
}

async function removeWorkdir(created: string): Promise<void> {
  // Windows may hold the dir briefly after the child exits; retry, and never let a cleanup
  // failure replace the review result or the reviewer's own error
  await rm(created, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(
    (e: unknown) => {
      process.stderr.write(
        `between: could not remove reviewer temp dir ${created}: ${e instanceof Error ? e.message : String(e)}\n`,
      )
    },
  )
}

/**
 * The reviewer runs in an empty temporary directory, never the project: the subject is fully
 * in the prompt, so a prompt injection inside it finds no repository to read or change.
 */
async function runReviewerCli(
  preset: ReviewerPreset,
  prompt: string,
  opts: ReviewerRunOptions,
): Promise<string> {
  if (preset === 'fake') return fakeReviewerOutput(prompt)
  const { created, workdir } = await makeReviewerWorkdir(opts.projectRoot)
  try {
    return await spawnReviewer(preset, prompt, workdir, opts)
  } finally {
    await removeWorkdir(created)
  }
}

async function spawnReviewer(
  preset: 'claude' | 'codex',
  prompt: string,
  workdir: string,
  opts: ReviewerRunOptions,
): Promise<string> {
  const { file, args } = reviewerInvocation(preset, workdir)
  const env = reviewerEnv(preset, opts.projectRoot)
  const binary = await resolveReviewerBinary(file, env, opts.projectRoot)
  if (!binary) {
    throw new BetweenApiError(
      'reviewer_failed',
      `${preset} CLI not found on PATH outside the project; install it and sign in, or pick another reviewer`,
    )
  }
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(binary)) {
    assertTrustedBatchShell(opts.projectRoot)
  }
  const r = await execa(binary, args, {
    cwd: workdir,
    input: prompt,
    env,
    extendEnv: false,
    timeout: opts.timeoutMs,
    reject: false,
  })
  if (r.timedOut) {
    throw new BetweenApiError(
      'reviewer_failed',
      `${preset} reviewer timed out after ${Math.round(opts.timeoutMs / 1000)}s`,
    )
  }
  const cause: unknown = r.cause
  if (cause instanceof Error && (cause as NodeJS.ErrnoException).code === 'ENOENT') {
    throw new BetweenApiError(
      'reviewer_failed',
      `${preset} CLI not found on PATH; install it and sign in, or pick another reviewer`,
    )
  }
  if (r.exitCode !== 0) {
    throw new BetweenApiError(
      'reviewer_failed',
      `${preset} reviewer exited with code ${r.exitCode ?? 'unknown'}: ${excerpt(String(r.stderr ?? ''))}`,
    )
  }
  return String(r.stdout ?? '')
}

function excerpt(text: string): string {
  const clean = redactSecrets(text.trim()).text
  if (!clean) return '(no output)'
  return clean.length > 300 ? `${clean.slice(0, 300)}...` : clean
}

function invalid(message: string): BetweenApiError {
  return new BetweenApiError('invalid_argument', message)
}
