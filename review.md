# Between Deep Review

Date: 2026-06-19
Mode: Ultrawork / HEAVY review
Scope: current local repository at `C:\Users\lg\marketing for companies\between`, including committed implementation, current dirty package metadata, CLI/TUI behavior, daemon loop, durable state adapters, tests, CI, README, TASKS, and review artifacts.

Verdict: **Not ready to merge or ship.**

The earlier Node/runtime metadata and lint-in-CI blockers are mostly fixed: `package.json` and `package-lock.json` now require Node `>=22.12.0`, `tsup.config.ts` targets `node22`, and CI runs `npm run lint`. The current blockers are deeper: the broker still does not complete the developer feedback handoff, the CI coverage gate is red on this Windows host, and several durable-file boundaries still behave like optimistic local files rather than crash-safe broker contracts.

## Current Working Tree

Latest verified working-tree snapshot during this review (`git status --short --untracked-files=all`) reports:

```text
 M package-lock.json
 M package.json
 M review.md
 M src/core/config-schema.ts
?? docs/EMBED-PLAN.md
?? src/adapters/agent-host.ts
?? src/adapters/pipe-agent-host.ts
?? src/adapters/pty-agent-host.ts
?? src/adapters/pty-transport.ts
```

The package diff adds `@lydell/node-pty` as an optional dependency. `review.md` is this review artifact. `src/core/config-schema.ts`, `docs/EMBED-PLAN.md`, `src/adapters/agent-host.ts`, `src/adapters/pipe-agent-host.ts`, `src/adapters/pty-agent-host.ts`, and `src/adapters/pty-transport.ts` changed or appeared during the review window after the main verification pass; they were not edited by this review, so findings below focus on the implementation snapshot and evidence captured before those concurrent edits. This section is a timestamped review snapshot, not a claim that no later concurrent files can appear while another coding agent is still writing.

## Findings

### P1 - Blocking reviewer feedback does not signal the developer

The core product loop says the broker should notify the developer when the reviewer writes findings. The implementation transitions to `applying_review`, but it never sends a developer signal.

Evidence:

- `src/daemon/loop.ts:364-381` handles a blocking review by dispatching `review_applied`.
- `src/adapters/signal-transport.ts:68-74` defines `developerSignalBody()`, but `rg` found no call site for it.
- Real CLI smoke wrote a valid blocking `.between/reviews/cycle-0001.json`; `status --json` then showed `phase: "applying_review"` and `waiting_on: "developer"`, while `.between/signals/developer.json` was missing.
- Log: `.omo/evidence/deep-review-2026-06-19/developer-signal-missing-clean.txt`.

Recommended fix: after accepting a complete blocking review for the current hash, build and send a developer signal, persist `last_signal: "developer_review_available"` (or equivalent), and add an integration test that asserts `.between/signals/developer.json` exists before the daemon waits on the developer.

### P1 - CI coverage gate is currently red

CI runs `npm run test:cov` on both Windows and Ubuntu (`.github/workflows/ci.yml:28-31`). On this host, `npm test` passes when rerun alone, but `npm run test:cov` fails in `test/integration/loop.test.ts` with `beforeEach` timeout and `EBUSY` temp cleanup errors.

Evidence:

- PASS: `npm run lint` -> `.omo/evidence/deep-review-2026-06-19/lint.txt`.
- PASS: `npm run typecheck` -> `.omo/evidence/deep-review-2026-06-19/typecheck.txt`.
- PASS: `npm test` after agent activity stopped -> 12 files, 61 tests -> `.omo/evidence/deep-review-2026-06-19/test-rerun-after-agents.txt`.
- FAIL: `npm run test:cov` -> 1 failed file, 2 failed integration tests -> `.omo/evidence/deep-review-2026-06-19/test-cov-rerun.txt`.

Recommended fix: make the real-git integration harness reliable under coverage on Windows. Likely fixes are longer hook timeout, serializing the integration file, retrying temp cleanup on `EBUSY`, and ensuring all git child processes are fully awaited before `rm`.

### P1 - Clean review without passing verify can stall forever

For a clean review, `handleReviewWritten()` reads verify once per tick. If verify is missing or `passed: false`, it returns while staying in `review_written`; there is no transition to `verifying`, no `verify_failed` dispatch, and `developer_timeout_seconds` is not wired into this path.

Evidence:

- `src/daemon/loop.ts:168-170` calls `handleReviewWritten()` for `review_written`.
- `src/daemon/loop.ts:369-378` returns when the review is clean but there is no passing verify.
- `src/daemon/loop.ts:151-173` has no timeout handling for `review_written` or `verifying`.
- The happy-path integration test writes review and verify together, masking the missing negative path.

Recommended fix: define the owner of verification explicitly. If the developer must verify, send a developer/verify signal and route missing or failed verify to `developing` or `human_gate` with timeout. Add tests for missing verify, `passed:false`, and mismatched verify hash.

### P2 - Current optional PTY dependency does not satisfy the runtime probe

The dirty package diff adds `@lydell/node-pty`, but `doctor` dynamically imports `node-pty`.

Evidence:

- `package.json` currently has `optionalDependencies: { "@lydell/node-pty": "^1.2.0-beta.12" }`.
- `src/cli.ts:219-223` probes `import('node-pty')`.
- Local import check: `@lydell/node-pty` imports successfully, while `node-pty` fails with `ERR_MODULE_NOT_FOUND`.
- `node dist/cli.js doctor` still reports `node-pty unavailable`.

Recommended fix: either depend on the package name that provides the `node-pty` specifier, or change the runtime adapter/probe to use `@lydell/node-pty`. Do not ship the current package diff as a PTY readiness improvement.

### P2 - Command and signal files are not written atomically

The broker treats `.between/commands` and `.between/signals` as durable coordination surfaces, but both write directly to the final JSON path. The command drain also deletes corrupt/unreadable files, so a daemon can observe a partially written command and drop it permanently.

Evidence:

- `src/adapters/command-bus.ts:43-50` writes directly to the final command `.json`.
- `src/adapters/command-bus.ts:69-76` deletes JSON parse/read failures.
- `src/adapters/signal-transport.ts:42-45` writes signals directly to the final signal path.

Recommended fix: write to a temp filename and atomically rename into place, or use `write-file-atomic`. For command drains, treat a parse failure on a just-created file as retryable unless the file is oversized or clearly invalid after a stable-age threshold.

### P2 - Newer state schema refusal is swallowed

`migrate()` throws for `schema_version > 1`, but `tryRead()` catches every error and returns `null`. That turns a required "upgrade Between" refusal into "no readable state", allowing later code to proceed from an initial in-memory state.

Evidence:

- `src/adapters/state-repository.ts:40-48` catches all read/migrate errors and returns `null`.
- `src/adapters/state-repository.ts:70-75` contains the intended newer-than-binary refusal.

Recommended fix: distinguish parse/corruption fallback from explicit migration refusal. Let newer-schema errors propagate to `start`, `status`, and `doctor` so the user cannot silently overwrite newer state.

### P2 - `.between/` is not excluded from tracked diffs

The plan says `.between/` should be excluded at the git level, but the tracked diff and summary paths do not include an exclude pathspec. `.gitignore` only protects untracked files; if `.between/` is ever tracked by mistake, broker state can enter the review hash and self-trigger cycles.

Evidence:

- `src/adapters/git.ts:83-96` calls `git diff <base>` and `git diff <base> --numstat` without `:(exclude).between/**`.
- `src/adapters/git.ts:111-119` excludes `.between/` only from untracked files.
- `TASKS.md:62-66` marks `.between/` git-level exclusion as part of M2.

Recommended fix: apply the same `.between/**` exclusion pathspec to tracked diff, raw diff, and summary, and add a regression test with a deliberately tracked `.between/state.json`.

### P2 - Human approval is a protocol token, not an enforcement boundary

The current command bus validates `approve` shape, but any local process with write access to `.between/commands` can enqueue `{ "kind": "approve", "scope": "merge" }`, and the daemon will persist an approval token.

Evidence:

- `src/adapters/command-bus.ts:12-23` defines `approve` as a valid command shape.
- `src/daemon/loop.ts:449-472` persists the approval token and exits `human_gate`.
- README correctly marks detective merge/deploy enforcement as planned, but "Human-controlled merge/deploy" can be misread as enforcement rather than cooperative protocol.

Recommended fix: document this as a trust boundary now. If Between should enforce human approval against local agents, add an out-of-band approval secret, OS-level permissions, a signed approval file, or a pre-push hook that cannot be written by agent sessions.

### P3 - Documentation and tracker status are stale

Some docs now overstate the completed loop and quality gate status.

Evidence:

- `README.md:17-23` says the broker routes reviewer results back to the developer; the current code does not write developer signals.
- `README.md:217-220` says the headless loop and file-based signal/ack/review flow are implemented; the reviewer side is implemented, but the developer handoff is not.
- `TASKS.md:8-11` says the loop is implemented/tested/runnable and still cites 54 tests; the current suite has 61 tests and `test:cov` is red.
- `TASKS.md:8-10` also claims a CLI-proven end-to-end loop, which conflicts with the real CLI smoke showing no developer signal after a blocking review.

Recommended fix: update README/TASKS after the P1 loop defects are fixed, not before. Until then, describe the implementation as reviewer-signal-only plus dashboard and human gate.

### P3 - Large command/daemon files remain review-risk hotspots

The local programming guideline prefers files under 250 pure LOC. `src/daemon/loop.ts` and `src/cli.ts` are above that and now contain most of the behavioral coupling.

Evidence:

- `src/daemon/loop.ts`: about 451 pure-ish LOC.
- `src/cli.ts`: about 259 pure-ish LOC.

Recommended fix: after behavioral blockers are fixed, split daemon phase handlers and CLI command registration/handlers into narrower modules with focused tests.

### P3 - Supply-chain audit has one low dev-only advisory

`npm audit --omit=dev` reports zero production vulnerabilities. Full `npm audit` reports one low-severity dev/transitive advisory for `esbuild`.

Evidence:

- `.omo/evidence/deep-review-2026-06-19/audit-prod.txt`
- `.omo/evidence/deep-review-2026-06-19/audit-full.txt`

Recommended fix: update the affected dev toolchain when it does not disturb the build; this is lower priority than the broker loop and CI gate failures.

## Verification Snapshot

Commands run from `C:\Users\lg\marketing for companies\between`:

| Check | Result | Evidence |
|---|---:|---|
| `npm run lint` | PASS | `.omo/evidence/deep-review-2026-06-19/lint.txt` |
| `npm run typecheck` | PASS | `.omo/evidence/deep-review-2026-06-19/typecheck.txt` |
| `npm test` | PASS when rerun alone | `.omo/evidence/deep-review-2026-06-19/test-rerun-after-agents.txt` |
| `npm run test:cov` | FAIL | `.omo/evidence/deep-review-2026-06-19/test-cov-rerun.txt` |
| `npm run build` | PASS | `.omo/evidence/deep-review-2026-06-19/build.txt` |
| `npm audit --omit=dev` | PASS, 0 prod vulns | `.omo/evidence/deep-review-2026-06-19/audit-prod.txt` |
| `npm audit` | FAIL, 1 low dev advisory | `.omo/evidence/deep-review-2026-06-19/audit-full.txt` |
| CLI temp repo smoke | PARTIAL PASS | `.omo/evidence/deep-review-2026-06-19/cli-smoke.txt` |
| Blocking review developer signal | FAIL | `.omo/evidence/deep-review-2026-06-19/developer-signal-missing-clean.txt` |

## Sub-Reviewer Summary

- Planner: completed review plan at `.omo/plans/between-deep-review-2026-06-19.md`.
- Documentation/contract lane: confirmed PTY and Obsidian are mostly documented as deferred, but developer result routing is overclaimed.
- QA lane: reproduced missing developer signal and reported test/coverage instability under real Windows temp repos.
- Security/runtime lane: flagged local file-forgery trust boundaries, non-atomic command/signal writes, schema refusal swallow, and `.between/` diff exclusion gaps.
- Code-quality lane: requested changes for test instability, clean-review verify stall, signal-send persistence hazards, command bus atomicity, and schema refusal handling.

Gate status: **REQUEST CHANGES / artifact approval not obtained**. Product blockers are recorded above. The artifact gate repeatedly rejected while the working tree continued to receive concurrent files after each snapshot; treat this review as a blocker list for the verified implementation snapshot, not as merge approval for the actively moving tree.
