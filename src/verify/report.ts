import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { betweenPaths } from '../adapters/paths'
import type { VerificationReport } from './runner'

/**
 * Single source of truth for reading the structured `between verify` report from
 * `.between/verify-report.json`. Validated at this boundary (the file is self-produced but still
 * external state) so consumers — the evidence manifest and the cockpit — get a typed report or a
 * clean null, never a half-shaped object.
 */
const CheckResultSchema = z.object({
  name: z.string(),
  status: z.enum(['pass', 'fail']),
  exitCode: z.number(),
  summary: z.string(),
  durationMs: z.number(),
})

const VerificationReportSchema = z.object({
  checks: z.array(CheckResultSchema),
  allPassed: z.boolean(),
})

/**
 * Compile-time lockstep guard (review HIGH): the zod schema and runner's `VerificationReport` must
 * stay structurally identical. zod strips unknown keys, so if runner.ts adds/renames a field, the
 * schema would silently drop it while the return type still claimed `VerificationReport`. These
 * bidirectional `extends` checks collapse to `false` on any drift, so `= true` fails typecheck.
 */
type SchemaReport = z.infer<typeof VerificationReportSchema>
const _schemaMatchesRunner: SchemaReport extends VerificationReport ? true : false = true
const _runnerMatchesSchema: VerificationReport extends SchemaReport ? true : false = true
void _schemaMatchesRunner
void _runnerMatchesSchema

/** Read + validate the verify report, or null when absent/unreadable/malformed. */
export async function readVerifyReport(root: string): Promise<VerificationReport | null> {
  try {
    const raw = await readFile(betweenPaths(root).verifyReport, 'utf8')
    const parsed = VerificationReportSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
