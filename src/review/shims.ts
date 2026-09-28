import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { HostAgent } from './direct'

/**
 * Slash-command shims that let a running Claude Code or Codex session ask Between for a review.
 * Claude Code: project command `.claude/commands/between-review.md` -> `/between-review`.
 * Codex: user prompt `$CODEX_HOME/prompts/between-review.md` -> `/prompts:between-review`.
 * Both call the `between_review` MCP tool and fall back to the CLI. Model-facing: English only.
 */
export function reviewShim(host: HostAgent): string {
  return `---
description: Ask Between for an independent review of a diff, an answer, or a plan by the paired agent
argument-hint: "[diff|answer|plan] [file-or-url] [focus]"
---

Get an independent review from Between. The paired agent reviews, not you; you relay its result.

Arguments: $ARGUMENTS

1. Pick the kind. If the first argument is \`diff\`, \`answer\`, or \`plan\`, use it. Otherwise
   infer it: code changes -> \`diff\`; your previous reply to the user -> \`answer\`; a plan,
   spec, or design -> \`plan\`. Default to \`diff\`.
2. Pick the subject:
   - A file path in the arguments is \`file\`; an http(s) URL is \`url\`.
   - \`diff\` with no subject reviews the working tree against HEAD. Pass \`base\` when the user
     names a branch or commit to compare against.
   - \`answer\` with no subject: pass your most recent reply to the user verbatim as \`text\`, and
     the user's question verbatim as \`context\`.
   - \`plan\` with no subject: pass the most recent plan you wrote verbatim as \`text\`.
   - Any remaining words are the \`focus\`.
3. Call the \`between_review\` MCP tool with \`kind\`, the subject, \`focus\`, and
   \`from: "${host}"\`.
   If that tool is not available, run the CLI from the project root instead:
   \`npx -y between-dev review --kind <kind> --from ${host} --json [file]\`
   (use \`--url <url>\` for a URL; pipe inline text on stdin and pass \`-\` as the file).
4. Report the verdict (APPROVE or REQUEST_CHANGES), the summary, every finding with its severity
   and location, and the reviewer's questions. Do not apply fixes until the user asks.
`
}

export function reviewShimPath(
  host: HostAgent,
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (host === 'claude') return join(root, '.claude', 'commands', 'between-review.md')
  const codexHome = env.CODEX_HOME || join(homedir(), '.codex')
  return join(codexHome, 'prompts', 'between-review.md')
}

export interface ShimInstallResult {
  path: string
  written: boolean
}

export async function installReviewShim(
  host: HostAgent,
  root: string,
  opts: { force?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<ShimInstallResult> {
  const path = reviewShimPath(host, root, opts.env)
  if (existsSync(path) && !opts.force) return { path, written: false }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, reviewShim(host), 'utf8')
  return { path, written: true }
}
