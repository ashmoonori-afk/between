import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { execa } from 'execa'
import { buildAgentSandboxEnv } from '../adapters/agent-env'
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
  cwd: string
  timeoutMs: number
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
  const reply = await run(route.preset, prompt, { cwd: realRoot, timeoutMs })

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
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS) })
  } catch (e) {
    throw invalid(`could not fetch ${url}: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!res.ok) throw invalid(`could not fetch ${url}: HTTP ${res.status}`)
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_REVIEW_SUBJECT_BYTES) {
    throw invalid(`URL body is ${declared} bytes; the limit is ${MAX_REVIEW_SUBJECT_BYTES}`)
  }
  return res.text()
}

/**
 * Spawn the reviewer CLI read-only with the same sandboxed environment the broker gives agents:
 * provider auth passes through, every other credential is stripped. No new keys are needed.
 */
async function runReviewerCli(
  preset: ReviewerPreset,
  prompt: string,
  opts: ReviewerRunOptions,
): Promise<string> {
  if (preset === 'fake') return fakeReviewerOutput(prompt)
  const { file, args } = reviewerInvocation(preset)
  const { env } = buildAgentSandboxEnv(
    { BETWEEN_ROOT: opts.cwd },
    { role: 'reviewer', baseEnv: process.env },
  )
  const r = await execa(file, args, {
    cwd: opts.cwd,
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
