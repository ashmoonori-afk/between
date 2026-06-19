# Between Deep Review

Date: 2026-06-19 (reconciled after commits `6785f47` Node/CI/lockfile/--interval, `43adb0a` live embed, and the developer-signal + loop.ts-refactor + real-CLI-wiring slice)
Mode: Ultrawork / HEAVY review — reconciliation pass
Scope: current `main` worktree at `C:\Users\lg\marketing for companies\between` — broker loop, file contracts, embedded agent transports, Ink UI, package metadata, tests, docs, agent wiring.

Verdict: **REQUEST CHANGES. Do not ship as a self-governing broker yet.** Platform/CI/packaging findings are RESOLVED. The developer-signal gap and the oversized-loop debt are now RESOLVED by this slice. The remaining four broker-contract P1s (stale-diff, send-failure window, verify stall, file-protocol approval) stand as the merge gate.

## Resolved Since Previous Review

- RESOLVED — Node unified at `>=22.12`. `package.json` engines `>=22.12.0`, `README.md:49`, `tsup.config.ts target: 'node22'`, CI matrix `node: [22, 24]`. Commit `6785f47`.
- RESOLVED — Lint wired into CI between typecheck and `test:cov` (`npm run lint` = `prettier --check`). `.github/workflows/ci.yml:26-27`.
- RESOLVED — `--interval` validated at the CLI boundary (`src/cli/args.ts parseInterval`, `>=250ms` integer, `InvalidArgumentError`); covered by `test/unit/args.test.ts`.
- RESOLVED — Lockfile regenerated so `npm ci` syncs; `@emnapi/*` entries are the expected transitive native-binding fallback chain (via `@vitest/coverage-v8`/rollup wasm), not an inconsistency.
- RESOLVED — Live agent embedding shipped (OneShot/Pty transports, Pipe/Pty hosts, `EmbeddedDashboard`, `between start --embed`, ADR-0002, bundled `fake-agent`). Commit `43adb0a`.
- RESOLVED (this slice) — **Blocking reviewer feedback now signals the developer.** `handleReviewWritten()` blocking branch calls `sendDeveloperSignal(record.diff_hash)` before `dispatch('review_applied')`; `developerSignalBody()` is now a production caller; `.between/signals/developer.json` is written (and, under oneshot/pty, `developer_command` is spawned). `applying_review` keeps `watchForNewDiff()` so the developer's new diff opens the next cycle — no ack-gate, no deadlock, no new FSM phase. Covered by `test/integration/developer-signal.test.ts`.
- RESOLVED (this slice) — **Oversized-module debt.** `src/daemon/loop.ts` (was 513 LOC) split into `context.ts` (seam) + `phases.ts` (phase handlers) + `commands.ts` (command handlers); `loop.ts` now holds only the `Daemon` class + state-writer seam. Behavior-preserving (verbatim move, `this.x`->`ctx.x`, live `current()` getter); full suite + `tsc --noEmit` green.
- RESOLVED (this slice) — **Real `claude`/`codex` are wireable via presets.** `between init --agent <fake|claude|codex>` (default `fake`) writes the matching wrapper `.mjs` and sets `agent_mode: oneshot` + the matching `developer_command`/`reviewer_command`; `docs/AGENT-CONTRACT.md` documents the I/O contract.
- IMPROVED — Test gate green on a SINGLE run (was-flaky first run did not reproduce locally). Keep watching CI Windows runners before retiring the stability note.

## Blocking Findings (STILL-OPEN)

### P1 — `review_requested` can be stranded after send failure or restart
STILL-OPEN. `openCycleAndSignal()` persists cycle/phase before delivering the reviewer signal and stamps `last_signal_at` only after send; a crash/transport-failure/restart between leaves `review_requested` with no signal and no timeout basis. (The new `sendDeveloperSignal()` mirrors this ordering, so the developer leg shares the same window.)
- Fix: make cycle-open + signal delivery resumable; on startup / each `review_requested`|`applying_review` tick, resend the idempotent signal and stamp `last_signal_at` if the signal file/timestamp is missing. Add crash-window tests.

### P1 — A changed live diff can be approved by an old review
STILL-OPEN. While reviewer/developer work is outstanding, the daemon compares records to the stored `current.diff.hash`, never to a freshly computed live diff. Edits after the snapshot can be reviewed/verified against the stale hash and advance to `human_gate`.
- Fix: recompute the live diff hash before accepting ack/review/verify; if changed, supersede the cycle, clear stale artifacts, open a new debounced review.

### P1 — Clean review without passing verify can stall forever
STILL-OPEN. For a clean review, `handleReviewWritten()` returns while staying in `review_written` when verify is missing/invalid/mismatched/`passed:false`. The FSM defines `verify_failed` but this path never dispatches it and no timeout is wired.
- Fix: define the verification owner + timeout; route missing/failed verify to a signal, `developing`, or `human_gate`. Add negative-path tests (missing verify, `passed:false`, invalid JSON, hash mismatch).

### P1 — `applying_review` has no developer timeout (new, low-but-named)
NEW/STILL-OPEN. The developer signal now fires, but `applying_review` only runs `watchForNewDiff()` — there is no `developer_timeout` path, so a developer that never produces a diff leaves the daemon watching forever. `config.developer_timeout_seconds` and the FSM `developer_timeout` interrupt exist but are unwired.
- Fix: wire `signalTimedOut(developer_timeout_seconds)` into the `applying_review` tick -> `developer_timeout` -> `human_gate`. Document that until then `applying_review` has no watchdog.

### P1 — Agent-writable `.between/` can spoof approval and review completion
STILL-OPEN. Ack/review/verify files and `approve` commands live in the same writable tree spawned agents use, so the human gate is a convention, not an enforced boundary.
- Fix: document as a non-adversarial local protocol only (now stated in `docs/AGENT-CONTRACT.md`), or add a real boundary (OS perms, signed approval token, out-of-band secret, or merge/deploy hooks agents cannot write).

## High Priority Findings

### P2 — Command and signal files are still not atomic
STILL-OPEN. `write-file-atomic` is a dependency, but command/signal writes hit final paths directly and the drain deletes unreadable files, so a partial write can be dropped permanently.
- Fix: temp-file + atomic rename for command/signal writes; treat parse failures on young files as retryable.

### P2 — Newer state-schema refusal is swallowed
STILL-OPEN. The generic read fallback returns null on all errors, masking the intended "newer than this build supports" refusal and risking silent downgrade.
- Fix: distinguish corrupt JSON from migration refusal; propagate newer-schema errors through `status`/`start`/`doctor`.

### P2 — Tracked `.between/` files can enter review hashes
STILL-OPEN. `.between/` is excluded only for untracked files; tracked `.between/**` still enters `git diff`/`--raw`/`--numstat`.
- Fix: add `:(exclude).between/**` to tracked diff/raw/summary commands; regression-test a deliberately tracked `.between/state.json`.

### P2 — Hosted agent death is UI-only, not daemon state
STILL-OPEN. The FSM supports `agent_died`, but hosted process exits update only pane buffers; a dead embedded agent leaves the daemon waiting on ack/review/verify.
- Fix: add an agent-lifecycle channel from hosts/transports to the daemon and dispatch `agent_died` with role + exit code.

### P2 — `review-now` bypasses the cycle cap
STILL-OPEN. `forceReview()` opens a cycle without the `max_cycles_per_goal` guard the normal path enforces.
- Fix: apply the cap guard in `forceReview()`; test repeated `review-now` at the limit.

## Quality And Platform Risks

### P3 — Config exposes knobs that are not enforced
STILL-OPEN. `developer_timeout_seconds` (see new P1), merge/deploy gate booleans, and rule-promotion knobs are defined but not wired.
- Fix: wire them or mark them reserved/future in config + README.

### P3 — Windows terminal output portability
STILL-OPEN. Unicode glyphs in CLI/Ink UI render as mojibake in redirected Windows logs.
- Fix: ASCII/no-glyph mode for Windows/CI/redirected output.

### P3 — Dev audit low advisory
STILL-OPEN, low. Production audit clean; full audit reports one low dev advisory (`esbuild`).

## Remaining-Risks Summary (honest)

- Developer signal now WIRED; the central loop notifies the developer after a blocking review. But `applying_review` has no developer timeout yet (new P1) and the send/restart window is shared (P1).
- Stale-diff acceptance, verify stall, and file-protocol approval keep the broker from being a safe self-governing gate (P1).
- `loop.ts` is now split into `context.ts`/`phases.ts`/`commands.ts`; the module-size debt is RESOLVED, but the remaining P1 fixes (signal-recovery, live-diff recheck, developer timeout) land in `phases.ts` and must not regress the moved behavior.
- Real `claude`/`codex` are now wireable via `between init --agent claude|codex`, but only the bundled `fake-agent` is validated end-to-end. Claude headless flags are HIGH-confidence; Codex `--output-schema`/`--json` envelope is MEDIUM-confidence and must be smoke-tested live. README/ADR-0002/AGENT-CONTRACT.md remain the source of truth — do NOT claim real-CLI validation.
- Single-run local green is not CI-matrix proof; keep the P3 stability note until CI (ubuntu/windows x node 22/24) shows repeated green.

## Verification Snapshot

Commands run from `C:\Users\lg\marketing for companies\between`:

- `npx vitest run`: PASS (81 baseline + new developer-signal/config-agent tests).
- `npx tsc --noEmit`: PASS (type-only `DaemonDeps` seam erases cleanly; no import cycle).
- Developer-signal smoke: now PASSES — `handleReviewWritten` blocking branch sends the developer signal; `.between/signals/developer.json` exists before `applying_review`.
- `init --agent`: presets `fake|claude|codex` write the matching `.mjs` and config; default `fake`.

Gate status: **REQUEST CHANGES.** Platform/packaging/CI RESOLVED; developer-signal + oversized-loop RESOLVED; the four broker-contract P1s (plus the new `applying_review` timeout) remain the merge gate.