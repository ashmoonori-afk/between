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

// npm's trailing boilerplate hides the real cause (e.g. "Missing script: typecheck")
const NOISE = /A complete log of this run can be found in|^npm (?:error|ERR!)\s*$/

/** Last meaningful line of stderr (else stdout), capped — the human-meaningful one-liner. */
export function summarize(stdout: string, stderr: string): string {
  const text = stderr.trim() || stdout.trim()
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const meaningful = lines.filter((l) => !NOISE.test(l.trim()))
  // an npm error block states its cause on the first line; other tools summarize at the end
  const npmError = meaningful.find((l) => /^npm (?:error|ERR!)/.test(l.trim()))
  return (npmError ?? meaningful.at(-1) ?? lines.at(-1) ?? '').trim().slice(0, 200)
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
 * Real runner: execute the command line through the platform shell (`/bin/sh` on POSIX,
 * `cmd.exe` on Windows) in `cwd`, so `&&`, `||`, pipes, and env expansion behave as written in
 * config. Previously the line was tokenized and run without a shell, so `a && b` passed `&&`
 * and `b` as arguments to `a` and could report PASS when `b` failed. An optional `timeoutMs`
 * bounds the subprocess so a hung command can't stall the gate; on timeout execa rejects and the
 * caller decides.
 */
export function shellRunner(cwd: string, timeoutMs?: number): CommandRunner {
  return async (command) => {
    if (!command.trim()) return { exitCode: 1, stdout: '', stderr: 'empty command' }
    const r = await execa(command, {
      cwd,
      shell: true,
      reject: false,
      ...(timeoutMs ? { timeout: timeoutMs } : {}),
    })
    return { exitCode: r.exitCode ?? 1, stdout: r.stdout, stderr: r.stderr }
  }
}
