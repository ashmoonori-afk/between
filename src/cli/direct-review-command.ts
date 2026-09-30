import type { Command } from 'commander'
import { print, printJson } from './output'
import { fail, root } from './shared'
import { BetweenApiError } from '../api/errors'
import type { ModelsResult, ReviewerModels } from '../api/models'
import type { ReviewRequest, ReviewResult } from '../api/review'
import {
  HOST_AGENTS,
  REVIEWER_PRESETS,
  REVIEW_KINDS,
  type HostAgent,
  type ReviewKind,
  type ReviewerPreset,
} from '../review/direct'

interface ReviewCliOptions {
  kind: string
  text?: string
  url?: string
  base?: string
  context?: string
  focus?: string
  criterion: string[]
  reviewer?: string
  model?: string
  from?: string
  json?: boolean
}

export function registerDirectReviewCommands(program: Command): void {
  program
    .command('review')
    .description('Ask the paired agent for a one-shot review of a diff, an answer, or a plan')
    .argument('[subject]', 'subject file, or - to read the subject from stdin')
    .option('--kind <kind>', 'diff | answer | plan', 'diff')
    .option('--text <text>', 'inline subject text')
    .option('--url <url>', 'http(s) URL of the subject')
    .option('--base <ref>', 'diff only: commit to diff the working tree against (default HEAD)')
    .option('--context <text>', "answer: the user's question; otherwise background")
    .option('--focus <text>', 'what the reviewer should look at hardest')
    .option('--criterion <text>', 'extra review criterion (repeatable)', collect, [])
    .option('--reviewer <agent>', 'claude | codex | fake (fake never consults a model)')
    .option('--model <name>', 'reviewer model; omit for the reviewer CLI default')
    .option('--from <agent>', 'the calling agent (claude | codex); the other one reviews')
    .option('--json', 'print the structured verdict as JSON')
    .action(async (subject: string | undefined, opts: ReviewCliOptions) => {
      try {
        const req = await buildRequest(subject, opts)
        const { requestReview } = await import('../api/review')
        const result = await requestReview(root(), req)
        if (opts.json) printJson(result)
        else printResult(result)
      } catch (e) {
        await fail(e)
      }
    })

  program
    .command('models')
    .description('List available direct-review models')
    .option('--refresh', 'bypass the 24-hour model cache')
    .option('--json', 'print model lists as JSON')
    .action(async (opts: { refresh?: boolean; json?: boolean }) => {
      try {
        const { listModels } = await import('../api/models')
        const result = await listModels({ refresh: opts.refresh })
        if (opts.json) printJson(result)
        else printModels(result)
      } catch (e) {
        await fail(e)
      }
    })

  program
    .command('review-shim')
    .description('Install the /between-review slash command for Claude Code or Codex')
    .argument('<host>', 'claude (project .claude/commands) | codex ($CODEX_HOME/prompts)')
    .option('--force', 'overwrite an existing shim')
    .option('--print', 'print the shim instead of writing it')
    .action(async (host: string, opts: { force?: boolean; print?: boolean }) => {
      try {
        const agent = pick(host, HOST_AGENTS, 'host')
        const { installReviewShim, reviewShim } = await import('../review/shims')
        if (opts.print) {
          process.stdout.write(reviewShim(agent))
          return
        }
        const { path, written } = await installReviewShim(agent, root(), { force: opts.force })
        print(
          written
            ? `between: installed ${path}`
            : `between: ${path} already exists (use --force to overwrite)`,
        )
      } catch (e) {
        await fail(e)
      }
    })
}

async function buildRequest(
  subject: string | undefined,
  opts: ReviewCliOptions,
): Promise<ReviewRequest> {
  const kind = pick<ReviewKind>(opts.kind, REVIEW_KINDS, 'kind')
  let text = opts.text
  let file: string | undefined
  if (subject === '-') text = await readStdin()
  else if (subject !== undefined) file = subject
  else if (kind !== 'diff' && text === undefined && !opts.url && !process.stdin.isTTY) {
    text = await readStdin()
  }
  return {
    kind,
    ...(text !== undefined ? { text } : {}),
    ...(file !== undefined ? { file } : {}),
    ...(opts.url ? { url: opts.url } : {}),
    ...(opts.base ? { base: opts.base } : {}),
    ...(opts.context ? { context: opts.context } : {}),
    ...(opts.focus ? { focus: opts.focus } : {}),
    ...(opts.criterion.length > 0 ? { criteria: opts.criterion } : {}),
    ...(opts.reviewer
      ? { reviewer: pick<ReviewerPreset>(opts.reviewer, REVIEWER_PRESETS, 'reviewer') }
      : {}),
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.from ? { from: pick<HostAgent>(opts.from, HOST_AGENTS, 'from') } : {}),
  }
}

function pick<T extends string>(value: string, allowed: readonly T[], name: string): T {
  if ((allowed as readonly string[]).includes(value)) return value as T
  throw new BetweenApiError('invalid_argument', `--${name} must be one of: ${allowed.join(', ')}`)
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value]
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks).toString('utf8')
}

function printResult(r: ReviewResult): void {
  const model = r.model ? `, model ${r.model}` : ''
  print(`between review: ${r.verdict} (${r.kind}, reviewed by ${r.reviewer}${model})`)
  if (r.model_note) print(`  model note: ${r.model_note}`)
  if (r.verdict_adjusted)
    print('  verdict raised to REQUEST_CHANGES: a critical/major finding exists')
  print(`  subject: ${r.subject.label} (${r.subject.bytes} bytes)`)
  if (r.subject.redactions > 0) print(`  redacted ${r.subject.redactions} secret-like value(s)`)
  print('')
  print(r.summary)
  if (r.findings.length > 0) {
    print('')
    print('Findings:')
    for (const f of r.findings) {
      const where = f.location ? ` (${f.location})` : ''
      const crit = f.criterion ? ` [${f.criterion}]` : ''
      print(`  ${f.id} ${f.severity}${crit}: ${f.title}${where}`)
      if (f.detail) print(`      ${f.detail}`)
    }
  }
  if (r.questions.length > 0) {
    print('')
    print('Questions:')
    for (const q of r.questions) print(`  - ${q}`)
  }
}

function printModels(result: ModelsResult): void {
  printModelTable('claude', result.claude)
  print('')
  printModelTable('codex', result.codex)
}

function printModelTable(reviewer: string, result: ReviewerModels): void {
  print(`${reviewer} (${result.source})`)
  print('  MODEL')
  for (const model of result.models) print(`  ${model}`)
  if (result.note) print(`  note: ${result.note}`)
}
