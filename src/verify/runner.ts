import { execa } from 'execa'

export interface CheckSpec {
  name: string
  command: string
}

export interface CheckResult {
  name: string
  status: 'pass' | 'fail'
  exitCode: number
  summary: string
  durationMs: number
}

export interface VerificationReport {
  checks: CheckResult[]
  allPassed: boolean
}

/** Run a shell command, returning its exit code + output. Injected so tests never spawn (B3). */
export type CommandRunner = (
  command: string,
) => Promise<{ exitCode: number; stdout: string; stderr: string }>

/** Last non-empty line of stderr (else stdout), capped — the human-meaningful one-liner. */
function summarize(stdout: string, stderr: string): string {
  const text = stderr.trim() || stdout.trim()
  const lines = text.split('\n').filter((l) => l.trim().length > 0)
  return (lines.at(-1) ?? '').trim().slice(0, 200)
}

/**
 * B3: run each configured check and produce a STRUCTURED result. Pure of process spawning — the
 * `run` adapter is injected (so unit tests are fast + deterministic). `now` is injectable too so
 * durations don't make tests flaky.
 */
export async function runChecks(
  specs: CheckSpec[],
  run: CommandRunner,
  now: () => number = Date.now,
): Promise<VerificationReport> {
  const checks: CheckResult[] = []
  for (const spec of specs) {
    const start = now()
    try {
      const r = await run(spec.command)
      checks.push({
        name: spec.name,
        status: r.exitCode === 0 ? 'pass' : 'fail',
        exitCode: r.exitCode,
        summary: summarize(r.stdout, r.stderr),
        durationMs: now() - start,
      })
    } catch (err) {
      // review: a spawn-level failure (bad cwd, shell missing) must fail just THIS check, not
      // abort the whole run — so the report is always complete.
      checks.push({
        name: spec.name,
        status: 'fail',
        exitCode: -1,
        summary: (err instanceof Error ? err.message : String(err)).slice(0, 200),
        durationMs: now() - start,
      })
    }
  }
  // review: empty specs must not be a vacuous pass.
  return { checks, allPassed: checks.length > 0 && checks.every((c) => c.status === 'pass') }
}

/**
 * Real runner: execute the command line via the shell in `cwd` (for the CLI). An optional
 * `timeoutMs` bounds the subprocess so a hung command (e.g. `npm audit` against an unreachable
 * registry) can't stall the gate (review MEDIUM); on timeout execa rejects and the caller decides.
 */
export function shellRunner(cwd: string, timeoutMs?: number): CommandRunner {
  return async (command) => {
    const r = await execa(command, {
      cwd,
      shell: true,
      reject: false,
      ...(timeoutMs ? { timeout: timeoutMs } : {}),
    })
    return { exitCode: r.exitCode ?? 1, stdout: r.stdout, stderr: r.stderr }
  }
}
