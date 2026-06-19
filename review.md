# Between Ultrawork Review

Date: 2026-06-19
Scope: current working tree in `C:\Users\lg\marketing for companies\between`, including the CLI/TUI surface, package/runtime metadata, CI, daemon loop, adapter changes, tests, and evidence artifacts.

Verdict: **Not ready to merge.** The headless broker and one-shot dashboard now have encouraging evidence, but the current tree still has release-contract drift, a failing local lint gate, broad behavior changes outside the originally supplied file list, and rejected gate reviews.

## Findings

### P1 - Node support metadata is inconsistent across package, lockfile, docs, build target, and CI

`package.json:10-11` now requires Node `>=22.12.0`, and `.github/workflows/ci.yml:15-16` tests Node `[22, 24]`. That aligns with `commander@15.0.0` requiring Node `>=22.12.0` and `ink@7.1.0` requiring Node `>=22` in `package-lock.json:1776-1782` and `package-lock.json:2126-2159`.

However, the root package metadata inside `package-lock.json:39-40` still says Node `>=20`. `README.md:19` and `DEVELOPMENT-PLAN.md:28` still describe the stack as Node.js 20 LTS, `tsup.config.ts:6` still targets `node20`, and the optional PTY CI probe still uses Node 20 at `.github/workflows/ci.yml:43-47`.

Evidence: `.omo/evidence/task-3-runtime-compat.txt`, `.omo/evidence/task-3-node20-runtime.txt`, `.omo/evidence/between-security-runtime-gate-review.md`

Recommended fix: pick one support floor and update every source of truth together. If the floor is Node `>=22.12.0`, regenerate `package-lock.json`, update README/plan text, move or justify the `tsup` target, and align the optional PTY probe.

### P1 - Local lint gate is red, while CI does not run it

`package.json:24` maps `lint` to a Prettier check, and the latest sequential run fails because `src/daemon/loop.ts` is not formatted. CI does not run `npm run lint` at `.github/workflows/ci.yml:23-29`, so this quality gate can fail locally while the configured main CI path remains blind to it.

Evidence: `.omo/evidence/between-ulw-review/lint-latest.txt`, `.omo/evidence/task-5-sequential-summary.txt`, `.omo/evidence/between-qa-evidence-gate-review.md`

Recommended fix: format `src/daemon/loop.ts`, then decide whether `lint` means Prettier only or semantic linting. If it is a required gate, add it to CI; if it is formatting only, rename it to `format:check` and update docs.

### P1 - The active diff is broader than the original review list and includes behavior changes

The original review list named `package-lock.json`, `package.json`, `src/cli.ts`, `vitest.config.ts`, `.gitattributes`, `src/ui/*`, and `test/unit/dashboard.test.tsx`. The current working tree is broader: adapter files, `src/daemon/loop.ts`, and integration tests are also modified.

This is not just formatting. Examples include ack schema validation and atomic ack writes in `src/adapters/ack-store.ts:8-20` and `src/adapters/ack-store.ts:34-38`, command schema validation and bounded drain in `src/adapters/command-bus.ts:17-34` and `src/adapters/command-bus.ts:61-77`, event write error propagation in `src/adapters/events-log.ts:21-28`, state shape validation in `src/adapters/state-repository.ts:52-63`, and review hash lifecycle behavior in `src/daemon/loop.ts:364-375`.

Evidence: `.omo/evidence/task-1-scope.txt`, `.omo/evidence/between-gate-review.md`

Recommended fix: review these behavior changes as first-class scope. Do not describe the adapter/core/daemon/test changes as formatting-only.

### P2 - `dash --interval` accepts unsafe values and can collapse to a 1ms refresh loop

`src/cli.ts:263` parses `--interval <ms>` with `Number(v)` and passes it into `runDashboard` at `src/cli.ts:267`. The live dashboard then uses it directly in `setInterval` at `src/ui/dash.tsx:36`. Node turns `NaN` and `0` interval values into a 1ms timer, which can create a tight polling loop against `.between/state.json` and `events.jsonl`.

Evidence: `.omo/evidence/task-2-interval-runtime.txt`, `.omo/evidence/between-code-quality-gate-review.md`

Recommended fix: validate this flag at the CLI boundary as a finite positive integer with a sensible lower bound, for example `>=250` or `>=1000`, and add CLI tests for invalid, zero, and negative values.

### P2 - Edited TypeScript files exceed the local size guideline

The current diff edits two files over the local 250 pure-LOC ceiling: `src/cli.ts` is 258 pure LOC and `src/daemon/loop.ts` is 458 pure LOC. This is not a request to refactor them inside this review, but it should be tracked because both files sit on high-risk command/daemon paths.

Evidence: `.omo/evidence/between-code-quality-gate-review.md`

Recommended fix: after functional blockers are handled, split responsibilities incrementally around command registration/validation and daemon phase handlers.

### P2 - Slop / overfit coverage remains incomplete as a primary artifact

The gate reviewers consulted the local programming and remove-ai-slops criteria and rejected the earlier draft because the primary `review.md` did not show explicit overfit/slop coverage. This updated artifact records that gap instead of claiming the review gate is complete.

Evidence: `.omo/evidence/between-gate-review.md`, `.omo/evidence/between-code-quality-gate-review.md`, `.omo/evidence/between-review-artifact-gate-review.md`

Recommended fix: run a dedicated slop/overfit pass against the current diff after the tree stops moving, then record concrete findings or an approval with checked artifact paths.

### P3 - Supply-chain audit is mostly clean, with one low dev/transitive advisory

`npm audit --omit=dev` reports zero production vulnerabilities. Full `npm audit` reports one low-severity dev/transitive advisory for `esbuild`.

Evidence: `.omo/evidence/task-9-audit-prod.txt`, `.omo/evidence/task-9-audit-full.txt`, `.omo/evidence/between-security-runtime-gate-review.md`

Recommended fix: run `npm audit fix` or update the affected dev toolchain when safe; this is lower priority than the runtime metadata and lint failures.

### P3 - Evidence artifacts contain local absolute workspace paths

Several evidence files contain paths under `C:\Users\lg\marketing for companies\between`. That is fine for local review, but the evidence directory should not be published or pasted externally without redaction.

Evidence: `.omo/evidence/between-security-runtime-gate-review.md`

Recommended fix: keep `.omo/evidence` local or generate a redacted evidence bundle before sharing.

## Verification

Latest sequential verification snapshot: `.omo/evidence/task-5-sequential-summary.txt`

- FAIL: `npm run lint` (`src/daemon/loop.ts` Prettier issue)
- PASS: `npm run typecheck`
- PASS: `npm test` (10 files, 54 tests)
- PASS: `npm run test:cov` (10 files, 54 tests; statements 93.84%, branches 91.46%, functions 90.9%, lines 95.9%)
- PASS: `npm run build` (`tsup` still reports target `node20`)

Earlier parallel runs produced intermittent integration-test failures (`beforeEach` hook timeout / Windows `EBUSY`). The latest sequential run passed tests, so the reliable current blocker is lint plus the metadata/scope issues above, not a consistently red test suite.

## Real CLI/TUI Evidence

- PASS: fresh temp repo `node dist/cli.js init`
- PASS: fresh temp repo `node dist/cli.js status`
- PASS: fresh temp repo `node dist/cli.js dash --once`
- PASS: 80-column TUI width check, max width 80/80 with no overflow in the captured frame
- PASS: Node 20 runtime smoke for `--help`, `init`, and `dash --once`
- PASS: no-state `status` exits 1 with init guidance
- PASS: no-state `dash --once` prints init guidance and exits 0
- PASS: invalid `approve ship` exits 1 with allowed scopes

Evidence: `.omo/evidence/task-6-real-cli-tui.txt`, `.omo/evidence/between-ulw-review/visual-qa-tui.txt`, `.omo/evidence/task-7-cli-error-paths.txt`

The PTY/three-terminal product promise is still not complete. Current implementation uses `FileTransport` as the load-bearing transport, with `node-pty` treated as optional/future per `docs/adr/ADR-0001-transport.md`. The real TUI proof verifies the dashboard frame, not live Claude/Codex PTY embedding.

## Scope Notes

Supplied review scope and current dirty-tree scope diverged during the review. The latest dirty tree includes `.github/workflows/ci.yml`, `package.json`, adapter files, `src/cli.ts`, core files, `src/daemon/loop.ts`, UI files, and tests. `package-lock.json`, `vitest.config.ts`, `.gitattributes`, and `src/ui/theme.ts` were in the supplied list but are not currently shown as modified by `git diff --name-only`.

Treat this review as a moving-target snapshot, not a final approval. The source tree continued changing while gates were running, and the gate reviewers correctly rejected the earlier draft for stale line references, incomplete scope reconciliation, and pending gate status.

## Sub-Reviewer Gate

- Goal/scope: **REJECT**. Scope reconciliation was incomplete, and the earlier draft downplayed behavior changes outside the supplied list. See `.omo/evidence/between-gate-review.md`.
- Code quality: **REJECT**. The earlier draft had stale line references and missed the edited oversized `src/cli.ts`. See `.omo/evidence/between-code-quality-gate-review.md`.
- QA/evidence: **REJECT**. The earlier draft had stale verification claims; latest sequential evidence now supersedes it. See `.omo/evidence/between-qa-evidence-gate-review.md` and `.omo/evidence/task-5-sequential-summary.txt`.
- Security/supply-chain/runtime: **REJECT**. Runtime metadata remains split, audit state needed to be recorded, and evidence contains local absolute paths. See `.omo/evidence/between-security-runtime-gate-review.md`.
- Final artifact gate: **REJECT**. The previous artifact still had stale `src/cli.ts` line references, a stale LOC count, and incomplete slop/overfit coverage. This revision fixes the stale references and leaves slop/overfit coverage as an explicit blocker. See `.omo/evidence/between-review-artifact-gate-review.md`.

This review artifact has been updated to include those gate rejections instead of claiming approval.
