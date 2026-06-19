# Between Deep Review

Date: 2026-06-19
Mode: Ultrawork / HEAVY review
Scope: current clean `main` worktree at `C:\Users\lg\marketing for companies\between`, including broker loop, file contracts, embedded agent transports, Ink UI, package metadata, tests, docs, and real CLI smoke behavior.

Verdict: **REQUEST CHANGES. Do not merge or ship as a self-governing broker yet.**

This is a fresh review of the current worktree, not the older dirty snapshot. The previous optional PTY probe mismatch is now fixed: `doctor` imports `@lydell/node-pty`, and the local root `doctor` output reports the package available. The README is also more honest about alpha limitations. The remaining blockers are in the broker contract itself: reviewer feedback still does not reach the developer, stale diffs can be approved, verification can stall forever, and `.between/` is still treated as both agent-writable IPC and human-control authority.

## Working Tree Snapshot

At review start, `git status --short --untracked-files=all --branch` reported a clean branch:

```text
## main...origin/main
```

This review then created fresh evidence under:

```text
.omo/evidence/current-deep-review-2026-06-19/
.omo/notepads/between-current-deep-review-2026-06-19.md
```

## Blocking Findings

### P1 - Blocking reviewer feedback still does not signal the developer

The core product loop requires the broker to notify the developer after the reviewer writes blocking findings. The implementation only changes phase to `applying_review`; it never sends a developer signal.

Evidence:

- `src/daemon/loop.ts:364-382` reads the review, detects blocking findings, and dispatches `review_applied`.
- `src/adapters/signal-transport.ts:68-74` defines `developerSignalBody()`, but there is no production call that builds or sends a `developer` signal.
- Real CLI smoke reproduced the gap: after a blocking `.between/reviews/cycle-0001.json`, `status --json` showed `phase: "applying_review"` and `waiting_on: "developer"`, while `.between/signals/developer.json` was missing.
- Log: `.omo/evidence/current-deep-review-2026-06-19/smoke-blocking-developer-signal.txt`.

Recommended fix: after accepting a blocking review for the current hash, build and send a `developer` signal, persist a distinct `last_signal` value such as `developer_review_available`, and add an integration test that asserts `.between/signals/developer.json` exists before waiting on the developer.

### P1 - `review_requested` can be stranded after send failure or restart

`openCycleAndSignal()` persists the new cycle and phase before delivering the reviewer signal. If the process crashes, transport send fails, or the machine restarts between those steps, the persisted state says `review_requested` but no signal may exist. Because `last_signal_at` is written only after send, timeout detection can also be disabled.

Evidence:

- `src/daemon/loop.ts:277-294` persists `diff_stable` and moves into `review_requested`.
- `src/daemon/loop.ts:296-303` sends the signal after that state write.
- `src/daemon/loop.ts:304-320` writes `broker.last_signal_at` only after send succeeds.
- `src/daemon/loop.ts:384-388` cannot time out when `last_signal_at` is missing.

Recommended fix: make cycle opening and signal delivery resumable. On startup or every `review_requested` tick, if the expected signal file is missing or `last_signal_at` is null, resend the idempotent signal and stamp `last_signal_at`. Add crash-window tests around persisted `review_requested` with no signal.

### P1 - A changed live diff can be approved by an old review

While the daemon is in `review_requested`, `reviewing`, or `review_written`, it never re-checks the current worktree diff. A developer can change files after the snapshot is sent; a review and verify for the old stored hash can still advance to `human_gate`.

Evidence:

- `src/daemon/loop.ts:151-170` routes review phases to `awaitAck()`, `awaitReview()`, and `handleReviewWritten()`.
- `src/daemon/loop.ts:349-382` compares records to `this.current.diff.hash`, not a freshly computed `currentDiff()`.
- `src/core/findings.ts:53-60` correctly requires review/verify hash agreement, but both can agree with the stale stored hash rather than the live worktree.

Recommended fix: while reviewer work is outstanding, recompute the live diff hash before accepting ack/review/verify completion. If the live hash changes, cancel or supersede the cycle, clear stale review artifacts for that cycle, and open a new debounced review.

### P1 - Clean review without passing verify can stall forever

For a clean review, `handleReviewWritten()` checks verify once per tick. If verify is missing, invalid, mismatched, or `passed: false`, it returns while staying in `review_written`. The FSM has `verify_failed`, but the daemon never emits it here, and no timeout is wired for this phase.

Evidence:

- `src/daemon/loop.ts:168-170` calls `handleReviewWritten()` for `review_written`.
- `src/daemon/loop.ts:369-378` returns when the review is clean but `cycleShouldEnd()` is false.
- `src/core/fsm.ts:38-42` defines `verify_failed`, but this path does not dispatch it.
- The happy-path tests write review and verify together, masking the missing negative path.

Recommended fix: define the verification owner and timeout. Missing/failed/mismatched verify should either signal the developer to verify, return to `developing`, or route to `human_gate` with an explicit recoverable error. Add tests for missing verify, `passed:false`, invalid verify JSON, and hash mismatch.

### P1 - Agent-writable `.between/` files can spoof human approval and review completion

The current trust boundary is cooperative. Any local agent process with write access to `.between/` can write ack/review/verify files and enqueue an `approve` command. That means the "human gate" is not an enforcement boundary; it is only a convention.

Evidence:

- `src/adapters/command-bus.ts:17-23` accepts `approve` command files as a valid command shape.
- `src/daemon/loop.ts:460-473` persists the approval and exits `human_gate`.
- Acks, reviews, verify records, and commands all live under the same writable `.between/` tree used by spawned agents.

Recommended fix: either document this as a non-adversarial local protocol only, or add a real approval boundary: separate OS permissions, signed approval tokens, an out-of-band secret not exposed to agents, or merge/deploy hooks that cannot be written by agent sessions.

## High Priority Findings

### P2 - Command and signal files are still not atomic

The broker uses `.between/commands` and `.between/signals` as durable coordination surfaces, but both write directly to final JSON paths. The command drain deletes corrupt/unreadable files, so a daemon can observe a partially written command and drop it permanently.

Evidence:

- `src/adapters/command-bus.ts:43-50` writes command JSON directly to the final path.
- `src/adapters/command-bus.ts:69-76` deletes invalid or unreadable command files.
- `src/adapters/signal-transport.ts:42-45` writes signal JSON directly to the final path.

Recommended fix: use temp file plus atomic rename, or `write-file-atomic`, for command and signal writes. Treat parse failures on young files as retryable unless size or age proves the file is permanently invalid.

### P2 - Newer state schema refusal is swallowed

The migration layer intends to refuse newer state files, but that refusal is caught by the generic read fallback. A newer `state.json` can therefore look like no state or fall back to `.bak`, risking silent downgrade behavior.

Evidence:

- `src/adapters/state-repository.ts:40-48` catches all read, parse, and migration errors and returns null.
- `src/adapters/state-repository.ts:70-75` throws the intended "newer than this build supports" error.
- `src/runtime.ts:57-61` constructs `initialState()` when no existing state is returned.

Recommended fix: distinguish corrupt JSON from explicit migration refusal. Propagate newer-schema errors through `status`, `start`, and `doctor` so the user must upgrade rather than accidentally overwrite newer state.

### P2 - Tracked `.between/` files can enter review hashes

`between init` now writes `.between/` to `.gitignore`, which helps untracked state. But tracked `.between/**` files are still included in `git diff`, raw diff, and numstat. If `.between/` is ever accidentally tracked, broker state can leak into snapshots and self-trigger review cycles.

Evidence:

- `src/adapters/git.ts:83-96` calls tracked `git diff`, `--raw`, and `--numstat` without an exclude pathspec.
- `src/adapters/git.ts:111-119` excludes `.between/` only for untracked files.

Recommended fix: add `:(exclude).between/**` to tracked diff, raw diff, and summary commands, and add a regression test with a deliberately tracked `.between/state.json`.

### P2 - Hosted agent death is UI-only, not daemon state

The FSM has an `agent_died` interrupt, but hosted process exits only update pane buffers. A real embedded Claude/Codex process can die while the daemon continues waiting for ack/review/verify files.

Evidence:

- `src/core/fsm.ts:77-85` supports `agent_died`.
- `src/adapters/pty-agent-host.ts:87-90` marks the pane exit but does not notify the daemon.
- `src/adapters/pty-transport.ts:54-57` marks one-shot exit only in the host buffer.
- `src/ui/start.tsx:78-97` runs the daemon without a process-death feedback channel.

Recommended fix: add an agent lifecycle event channel from hosts/transports to the daemon. Dispatch `agent_died` with role and exit code when a hosted command exits unexpectedly before the expected ack/review/verify arrives.

### P2 - `review-now` bypasses the cycle cap

The normal debounce path checks `max_cycles_per_goal`, but `review-now` can call `openCycleAndSignal()` directly without the same cap guard.

Evidence:

- `src/daemon/loop.ts:250-257` enforces the cap in the normal stable-diff path.
- `src/daemon/loop.ts:476-498` force-opens a cycle without checking `isCycleCapReached()`.

Recommended fix: apply the same cap guard in `forceReview()` and test repeated `review-now` submissions at the configured limit.

## Quality And Platform Risks

### P3 - Test gates are green only on rerun

The suite can pass, but it is not stable enough for a broker project yet.

Evidence:

- First local `npm test` failed: `test/integration/loop.test.ts` `beforeEach` hook timed out after 10 seconds.
- Focused rerun passed: `.omo/evidence/current-deep-review-2026-06-19/test-loop-isolated.txt`.
- Full rerun passed: `.omo/evidence/current-deep-review-2026-06-19/test-rerun.txt`.
- First local `npm run test:cov` failed with `ENOENT` for `coverage/.tmp/coverage-15.json`.
- Coverage rerun passed: `.omo/evidence/current-deep-review-2026-06-19/test-cov-rerun.txt`.
- QA sub-review reproduced the same pattern: first full test failed, focused and full reruns passed.

Recommended fix: serialize real-git integration tests on Windows, increase hook timeout only where needed, retry temp cleanup on transient Windows handles, and keep a single CI command that is deterministic on both Windows and Ubuntu.

### P3 - Oversized modules concentrate too much behavior

The main loop and CLI command registration are above the local 250 pure LOC guideline and carry most product coupling.

Evidence:

- `src/daemon/loop.ts`: 474 physical lines.
- `src/cli.ts`: 270 physical lines.

Recommended fix: split phase handlers, signal delivery recovery, and CLI command handlers after the behavioral blockers are fixed. Keep the core FSM pure and move side-effect handlers into narrower modules with focused tests.

### P3 - Config exposes knobs that are not enforced

Several config fields are documented and defaulted before the runtime uses them. That makes the project look more complete than it is.

Evidence:

- `src/core/config-schema.ts:18` defines `developer_timeout_seconds`, but the daemon only checks reviewer timeouts in `src/daemon/loop.ts:341` and `src/daemon/loop.ts:356`.
- `src/core/config-schema.ts:22-23` defines merge/deploy human gate booleans, but local approval enforcement is still file-protocol only.
- `src/core/config-schema.ts:40-42` defines rule promotion knobs that are not implemented in the runtime loop.

Recommended fix: either wire the knobs now or mark them as reserved/future in config comments and README. Avoid presenting config fields as active safety controls until tests prove them.

### P3 - Windows terminal output still has portability issues

The source intentionally uses Unicode glyphs in the CLI and Ink UI. In captured Windows logs, these render as mojibake replacement sequences and question marks, reducing trust in a terminal-first product.

Evidence:

- Unicode scan: `.omo/evidence/current-deep-review-2026-06-19/non-ascii-ui-cli.txt` found 50 non-ASCII lines in CLI/UI files.
- Captured command logs show corrupted markers in `doctor`, test reporter output, and dashboard source views.

Recommended fix: add an ASCII/no-glyph mode for Windows, CI, and redirected output. Use Unicode only when stdout is an interactive terminal known to support it.

### P3 - Dev audit has one low advisory

Production audit is clean, but full audit reports one low-severity dev dependency advisory for `esbuild`.

Evidence:

- `npm audit --omit=dev`: pass, 0 production vulnerabilities.
- `npm audit`: fail, 1 low dev advisory.
- Logs: `.omo/evidence/current-deep-review-2026-06-19/audit-prod.txt` and `.omo/evidence/current-deep-review-2026-06-19/audit-full.txt`.

Recommended fix: update the affected dev toolchain when it does not disturb the build. This is lower priority than broker-loop correctness.

## Stale Or Improved Findings Since The Previous Review

- Fixed: optional PTY probe mismatch. `doctor` now checks `@lydell/node-pty`, and local output reports it available.
- Improved: `between init` now writes `.between/` to `.gitignore`.
- Improved: README now clearly warns that blocking reviewer feedback does not yet create a verified developer signal.
- Still current: missing developer signal, verify stall, direct command/signal writes, newer state schema swallow, tracked `.between/` diff inclusion, and test instability.

## Verification Snapshot

Commands run from `C:\Users\lg\marketing for companies\between`:

- `npm run lint`: PASS. Evidence: `.omo/evidence/current-deep-review-2026-06-19/lint.txt`.
- `npm run typecheck`: PASS. Evidence: `.omo/evidence/current-deep-review-2026-06-19/typecheck.txt`.
- `npm test`: FAIL first run, PASS rerun. Evidence: `test.txt`, `test-loop-isolated.txt`, `test-rerun.txt`.
- `npm run test:cov`: FAIL first run, PASS rerun. Evidence: `test-cov.txt`, `test-cov-rerun.txt`.
- `npm run build`: PASS. Evidence: `.omo/evidence/current-deep-review-2026-06-19/build.txt`.
- `npm audit --omit=dev`: PASS. Evidence: `.omo/evidence/current-deep-review-2026-06-19/audit-prod.txt`.
- `npm audit`: FAIL with one low dev advisory. Evidence: `.omo/evidence/current-deep-review-2026-06-19/audit-full.txt`.
- `node dist/cli.js --help`: PASS. Evidence: `.omo/evidence/current-deep-review-2026-06-19/cli-help.txt`.
- `node dist/cli.js doctor` at repo root: expected non-zero because this repo root is not initialized as a target repo; it still verified git and PTY availability. Evidence: `.omo/evidence/current-deep-review-2026-06-19/doctor-root.txt`.
- Real temp-repo blocking-review smoke: FAIL for developer signal handoff. Evidence: `.omo/evidence/current-deep-review-2026-06-19/smoke-blocking-developer-signal.txt`.

## Sub-Reviewer Summary

Five read-only lanes reviewed the current worktree:

- Broker-loop contract lane: REQUEST CHANGES. Confirmed missing developer signal, stale live-diff acceptance, verify stall, and integration gate instability.
- Runtime/state-machine lane: REQUEST CHANGES. Flagged signal-send crash window, verify stall, developer signal gap, schema-refusal swallow, and non-atomic command writes.
- QA lane: REQUEST CHANGES. Confirmed lint/typecheck/build pass, reproduced flaky full tests, and ran CLI smokes.
- Security/runtime lane: REQUEST CHANGES. Flagged file-forged approval/review completion, free-form agent commands, one-shot process lifecycle gaps, partial PTY startup cleanup, and tracked `.between/` leakage.
- Code-quality/test lane: REQUEST CHANGES. Flagged schema swallow, missing agent-death propagation, oversized modules, dead config knobs, and shallow UI/test coverage.

Gate status: **BLOCK / REQUEST CHANGES**. The project is a solid walking skeleton, but it is not yet the safe broker loop described in the blueprint.
