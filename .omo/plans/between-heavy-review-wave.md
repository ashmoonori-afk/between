# Between HEAVY Review Wave Plan

## TL;DR
> Summary:      Execute a HEAVY, evidence-bound review of Between's CLI, Ink dashboard, package/runtime compatibility, CI, and review documentation. The parent agent must write `review.md` with findings grounded in command output and file references.
> Deliverables:
> - `review.md` at the project root
> - Evidence transcripts under `.omo/evidence/`
> - Sub-reviewer gate results for goal/scope, code quality, real QA, and security/supply-chain
> Effort:       Short
> Risk:         Medium - the declared Node `>=20` engine conflicts with locked runtime dependencies requiring Node `>=22`/`>=22.12.0`.

## Scope
### Must have
- Review project root `C:\Users\lg\marketing for companies\between`.
- Treat the review as HEAVY because the requested review spans CLI, TUI, dependency/runtime, CI, tests, and documentation surfaces.
- Produce `review.md` in English with severity-ordered findings, verified command results, evidence paths, and concrete next actions.
- Explicitly reconcile the user-provided changed file list with the current working tree. Based on exploration, current `git status --short` showed `M TASKS.md` and untracked `.github/`, while the user-provided scope named `package-lock.json`, `package.json`, `src/cli.ts`, `vitest.config.ts`, `.gitattributes`, `src/ui/*`, and `test/unit/dashboard.test.tsx`.
- Include at least one real CLI/TUI surface proof. Unit render tests alone are not enough.
- Include the dependency/runtime engine mismatch review: `package.json:10-11` declares Node `>=20`; `package-lock.json:2126-2160` locks `ink@7.1.0` with Node `>=22`; `package-lock.json:1776-1783` locks `commander@15.0.0` with Node `>=22.12.0`.
- Note `src/daemon/loop.ts` as a size risk only. It measured at 443 pure LOC during exploration. Do not expand the review into a daemon refactor plan.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- Do not edit source, config, package, lockfile, or tests as part of this review assignment.
- Do not treat `npm run typecheck`, `npm test`, or `npm run build` as proof of user-facing TUI behavior.
- Do not make unsupported claims about Node 20 compatibility. Either provide a Node 20 execution transcript or state the claim as lockfile evidence.
- Do not refactor `src/daemon/loop.ts`; only mention it as a bounded architectural risk if relevant.
- Do not write a marketing-style summary. `review.md` must be a code review artifact with evidence.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: tests-after + Vitest, TypeScript compiler, tsup build, lockfile/runtime command probes, and real CLI/TUI smoke commands
- QA policy: every task has agent-executed scenarios
- Evidence: `.omo/evidence/task-<N>-<slug>.<ext>`

## Execution strategy
### Parallel execution waves
> Target 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks to maximize parallelism.

Wave 1 (no dependencies):
- Task 1: Reconcile review scope and create evidence ledger
- Task 2: Review CLI/TUI source and tests against design intent
- Task 3: Review dependency, runtime, package, and CI compatibility
- Task 4: Review docs/design alignment and bounded daemon risk

Wave 2 (after Wave 1):
- Task 5: Re-run automated verification commands
- Task 6: Execute real CLI/TUI surface proof in a temp repo
- Task 7: Execute negative CLI/TUI/error-path proof

Wave 3 (after Wave 2):
- Task 8: Write `review.md` and run sub-reviewer gate

Critical path: Task 1 -> Task 5 -> Task 6 -> Task 8

### Dependency matrix
| Task | Depends on | Blocks | Can parallelize with |
|------|------------|--------|----------------------|
| 1    | none       | 5, 6, 7, 8 | 2, 3, 4 |
| 2    | none       | 8      | 1, 3, 4 |
| 3    | none       | 8      | 1, 2, 4 |
| 4    | none       | 8      | 1, 2, 3 |
| 5    | 1          | 6, 8   | 7 |
| 6    | 1, 5       | 8      | 7 |
| 7    | 1, 5       | 8      | 6 |
| 8    | 1, 2, 3, 4, 5, 6, 7 | none | none |

## Todos
> Implementation + Test = ONE task. Never separate.
> Every task MUST have: References + Acceptance Criteria + QA Scenarios + Commit.

- [ ] 1. Reconcile Review Scope And Evidence Ledger

  What to do: Capture the actual working tree state, the user-provided changed-file list, and the evidence directory layout. Record the mismatch between the current observed `git status` and the supplied changed-file list so `review.md` does not overclaim.
  Must NOT do: Do not discard either scope source. Do not clean, reset, stage, or edit product files.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [5, 6, 7, 8] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `README.md:3-4` - product is a local terminal broker coordinated through durable surfaces
  - Pattern:  `README.md:17-23` - chosen stack and PTY/TUI design constraint
  - Pattern:  `package.json:1-48` - package scripts, bin, dependencies, and engine declaration
  - Pattern:  `.github/workflows/ci.yml:14-29` - CI matrix and verification gates if `.github/` remains untracked
  - Test:     `test/unit/dashboard.test.tsx:14-37` - focused UI test scope already present
  - External: `package-lock.json:2126-2160` - locked Ink runtime engine evidence

  Acceptance criteria (agent-executable only):
  - [ ] `bash -lc 'cd "/c/Users/lg/marketing for companies/between" && test -d .omo/evidence && test -f .omo/evidence/task-1-scope.txt'`
  - [ ] `.omo/evidence/task-1-scope.txt` contains `git status --short --untracked-files=all`, `git diff --name-only`, and the user-provided changed-file list.

  QA scenarios (MANDATORY - task incomplete without these):
  > Name the exact tool AND its exact invocation - not "verify it works". Browser use: use Chrome to drive the page; if Chrome is not available, download and use agent-browser (https://github.com/vercel-labs/agent-browser). Computer use: OS-level GUI automation for a non-browser desktop app.
  ```
  Scenario: Scope inventory captured
    Tool:     bash
    Steps:    bash -lc 'cd "/c/Users/lg/marketing for companies/between" && mkdir -p .omo/evidence && { echo "CURRENT_STATUS"; git status --short --untracked-files=all; echo "CURRENT_DIFF"; git diff --name-only; echo "USER_PROVIDED_CHANGED_FILES"; printf "%s\n" "package-lock.json" "package.json" "src/cli.ts" "vitest.config.ts" ".gitattributes" "src/ui/dash.tsx" "src/ui/Dashboard.tsx" "src/ui/theme.ts" "test/unit/dashboard.test.tsx"; } > .omo/evidence/task-1-scope.txt'
    Expected: `.omo/evidence/task-1-scope.txt` exists and includes both CURRENT_STATUS and USER_PROVIDED_CHANGED_FILES sections.
    Evidence: .omo/evidence/task-1-scope.txt

  Scenario: Scope mismatch is not hidden
    Tool:     bash
    Steps:    bash -lc 'cd "/c/Users/lg/marketing for companies/between" && grep -q "USER_PROVIDED_CHANGED_FILES" .omo/evidence/task-1-scope.txt && grep -q "CURRENT_STATUS" .omo/evidence/task-1-scope.txt'
    Expected: command exits 0.
    Evidence: .omo/evidence/task-1-scope-check.txt
  ```

  Commit: NO | Message: `docs(review): document between heavy review` | Files: [`.omo/evidence/task-1-scope.txt`]

- [ ] 2. Review CLI/TUI Source And Tests Against Design Intent

  What to do: Inspect CLI command surfaces, dashboard render path, dashboard component, theme mapping, and focused UI tests. Identify correctness, UX, encoding, lifecycle, test coverage, and consistency findings for `review.md`.
  Must NOT do: Do not fix source. Do not expand this into a redesign.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [8] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `src/cli.ts:34-48` - `init` command behavior
  - Pattern:  `src/cli.ts:51-80` - `status` command behavior and no-state path
  - Pattern:  `src/cli.ts:83-96` - headless `start` command behavior
  - Pattern:  `src/cli.ts:232-243` - `dash` command loads the Ink dashboard
  - Pattern:  `src/ui/dash.tsx:43-47` - live dashboard no-state render path
  - Pattern:  `src/ui/dash.tsx:54-68` - `runDashboard` once/live behavior
  - Pattern:  `src/ui/Dashboard.tsx:40-149` - main dashboard layout
  - Pattern:  `src/ui/Dashboard.tsx:132-147` - human approval footer
  - API/Type: `src/core/types.ts:14-32` - phase vocabulary consumed by `theme.ts`
  - Pattern:  `src/ui/theme.ts:47-83` - exhaustive phase styling
  - Pattern:  `src/ui/theme.ts:99-102` - `NO_COLOR` helper exists and should be checked for use
  - Test:     `test/unit/dashboard.test.tsx:14-37` - current UI render assertions
  - External: `docs/ui-design-spec.md:1-40` - dashboard visual system intent

  Acceptance criteria (agent-executable only):
  - [ ] `bash -lc 'cd "/c/Users/lg/marketing for companies/between" && test -f .omo/evidence/task-2-source-review.md'`
  - [ ] `.omo/evidence/task-2-source-review.md` contains at least one PASS/WARN/FAIL assessment for CLI command routing, dashboard rendering, theme/phase mapping, and test adequacy.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: Source review surfaces captured
    Tool:     bash
    Steps:    bash -lc 'cd "/c/Users/lg/marketing for companies/between" && { echo "# CLI"; sed -n "34,96p;232,248p" src/cli.ts; echo "# DASH"; sed -n "1,80p" src/ui/dash.tsx; echo "# DASHBOARD"; sed -n "40,149p" src/ui/Dashboard.tsx; echo "# THEME"; sed -n "47,102p" src/ui/theme.ts; echo "# TEST"; sed -n "14,37p" test/unit/dashboard.test.tsx; } > .omo/evidence/task-2-source-surfaces.txt'
    Expected: transcript includes `command('dash')`, `runDashboard`, `Dashboard`, `phaseStyle`, and `renders the broker-dominant layout`.
    Evidence: .omo/evidence/task-2-source-surfaces.txt

  Scenario: Review notes cover required source dimensions
    Tool:     bash
    Steps:    bash -lc 'cd "/c/Users/lg/marketing for companies/between" && grep -Eq "CLI|dashboard|theme|test" .omo/evidence/task-2-source-review.md'
    Expected: command exits 0 after the reviewer writes source review notes.
    Evidence: .omo/evidence/task-2-source-review.md
  ```

  Commit: NO | Message: `docs(review): document cli tui findings` | Files: [`.omo/evidence/task-2-source-review.md`]

- [ ] 3. Review Dependency, Runtime, Package, And CI Compatibility

  What to do: Verify whether the declared Node engine, `tsup` target, dependency engine requirements, and CI matrix tell a coherent support story. Treat the Node 20 versus locked dependency engine mismatch as a likely blocking finding unless runtime proof disproves it.
  Must NOT do: Do not change dependency versions or regenerate the lockfile.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [8] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `package.json:10-11` - root package declares Node `>=20`
  - Pattern:  `package.json:21-35` - npm scripts and runtime dependencies
  - Pattern:  `package-lock.json:39-40` - lockfile root package engine is Node `>=20`
  - External: `package-lock.json:1776-1783` - `commander@15.0.0` requires Node `>=22.12.0`
  - External: `package-lock.json:2126-2160` - `ink@7.1.0` requires Node `>=22`
  - Pattern:  `tsup.config.ts:4-13` - built CLI targets `node20` and comments on externals
  - Pattern:  `.github/workflows/ci.yml:14-29` - CI matrix includes Node 20 and Node 22
  - Test:     `vitest.config.ts:7-16` - coverage gate currently targets `src/core/**`, not UI/CLI

  Acceptance criteria (agent-executable only):
  - [ ] `.omo/evidence/task-3-runtime-compat.txt` lists root engine and dependency engines for `ink` and `commander`.
  - [ ] `review.md` either includes a blocking/major finding for Node engine mismatch or includes a Node 20 transcript proving install/build/runtime success despite the lockfile engines.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: Lockfile engine evidence captured
    Tool:     bash
    Steps:    bash -lc 'cd "/c/Users/lg/marketing for companies/between" && node -e "const fs=require(\"node:fs\"); const pkg=JSON.parse(fs.readFileSync(\"package.json\",\"utf8\")); const lock=JSON.parse(fs.readFileSync(\"package-lock.json\",\"utf8\")); for (const key of [\"node_modules/commander\",\"node_modules/ink\"]) { const p=lock.packages[key]; console.log(`${key} ${p.version} requires node ${p.engines?.node}`); } console.log(`root package requires node ${pkg.engines.node}`);" > .omo/evidence/task-3-runtime-compat.txt'
    Expected: output includes `node_modules/commander 15.0.0 requires node >=22.12.0`, `node_modules/ink 7.1.0 requires node >=22`, and `root package requires node >=20`.
    Evidence: .omo/evidence/task-3-runtime-compat.txt

  Scenario: Node 20 strict install attempt is recorded if executable
    Tool:     bash
    Steps:    bash -lc 'cd "/c/Users/lg/marketing for companies/between" && tmp="$(mktemp -d)" && cp package.json package-lock.json "$tmp"/ && npm_cli="$(npm root -g 2>/dev/null)/npm/bin/npm-cli.js" && { cd "$tmp" && NPM_CONFIG_ENGINE_STRICT=true npx -y -p node@20.18.3 node "$npm_cli" ci --ignore-scripts; } > "$PWD/.omo/evidence/task-3-node20-ci.txt" 2>&1; rc=$?; rm -rf "$tmp"; exit 0'
    Expected: evidence file exists. PASS if it shows an `EBADENGINE`/engine incompatibility under Node 20; if the probe cannot run, `review.md` must state that Node 20 runtime proof was inconclusive and rely on lockfile engine evidence.
    Evidence: .omo/evidence/task-3-node20-ci.txt
  ```

  Commit: NO | Message: `docs(review): document runtime compatibility findings` | Files: [`.omo/evidence/task-3-runtime-compat.txt`, `.omo/evidence/task-3-node20-ci.txt`]

- [ ] 4. Review Docs Alignment And Bounded Daemon Risk

  What to do: Compare the implemented CLI/TUI and package claims with the README/design docs. Add only a bounded note about `src/daemon/loop.ts` file size if relevant to maintainability.
  Must NOT do: Do not turn this into a full daemon refactor or milestone planning exercise.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [8] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `README.md:3-4` - intended durable coordination surfaces
  - Pattern:  `README.md:17-23` - chosen stack and PTY design context
  - Pattern:  `README.md:46-48` - stated immediate next action still references M0 transport spike
  - Pattern:  `TASKS.md` - changed progress snapshot currently claims headless loop/UI state
  - Pattern:  `src/daemon/loop.ts` - measured at 443 pure LOC; mention as bounded maintainability risk only
  - Test:     `test/integration/loop.test.ts` - integration coverage surface for daemon loop, if consulted
  - External: None

  Acceptance criteria (agent-executable only):
  - [ ] `.omo/evidence/task-4-docs-risk.md` exists and includes doc alignment notes, not daemon refactor steps.
  - [ ] `review.md` mentions `src/daemon/loop.ts` only if it is framed as a bounded risk and not as an implementation demand in this review.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: Documentation and daemon risk context captured
    Tool:     bash
    Steps:    bash -lc 'cd "/c/Users/lg/marketing for companies/between" && { echo "# README selected"; sed -n "1,48p" README.md; echo "# TASKS diff"; git diff -- TASKS.md; echo "# loop pure LOC"; awk "!/^[[:space:]]*$/ && !/^[[:space:]]*\\/\\// { n++ } END { print n }" src/daemon/loop.ts; } > .omo/evidence/task-4-docs-risk.txt'
    Expected: transcript includes README intent, TASKS diff if present, and a numeric loop pure LOC value.
    Evidence: .omo/evidence/task-4-docs-risk.txt

  Scenario: Risk notes stay bounded
    Tool:     bash
    Steps:    bash -lc 'cd "/c/Users/lg/marketing for companies/between" && grep -q "bounded" .omo/evidence/task-4-docs-risk.md && ! grep -qi "refactor now" .omo/evidence/task-4-docs-risk.md'
    Expected: command exits 0 after the reviewer writes notes.
    Evidence: .omo/evidence/task-4-docs-risk.md
  ```

  Commit: NO | Message: `docs(review): document docs alignment findings` | Files: [`.omo/evidence/task-4-docs-risk.md`]

- [ ] 5. Re-run Automated Verification Commands

  What to do: Re-run the known green checks and capture transcripts: TypeScript compile, focused dashboard tests, full tests, and build. Include cleanup status after commands.
  Must NOT do: Do not skip full tests just because focused tests pass. Do not hide warnings.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [6, 8] | Blocked by: [1]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `package.json:21-35` - scripts: `build`, `typecheck`, `test`, `test:cov`
  - Test:     `test/unit/dashboard.test.tsx:14-37` - focused dashboard test file
  - Test:     `vitest.config.ts:5-16` - test include and coverage threshold configuration
  - External: None

  Acceptance criteria (agent-executable only):
  - [ ] `npm run typecheck` exits 0 and transcript is saved.
  - [ ] `npx vitest run test/unit/dashboard.test.tsx` exits 0 and transcript is saved.
  - [ ] `npm test` exits 0 and transcript is saved.
  - [ ] `npm run build` exits 0 and transcript is saved.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: Automated verification is green
    Tool:     bash
    Steps:    bash -lc 'cd "/c/Users/lg/marketing for companies/between" && { echo "$ npm run typecheck"; npm run typecheck; echo "$ npx vitest run test/unit/dashboard.test.tsx"; npx vitest run test/unit/dashboard.test.tsx; echo "$ npm test"; npm test; echo "$ npm run build"; npm run build; } > .omo/evidence/task-5-automated-verification.txt 2>&1'
    Expected: command exits 0; transcript includes successful typecheck, focused dashboard tests, full Vitest run, and build completion.
    Evidence: .omo/evidence/task-5-automated-verification.txt

  Scenario: Failure transcript is preserved
    Tool:     bash
    Steps:    bash -lc 'cd "/c/Users/lg/marketing for companies/between" && test -s .omo/evidence/task-5-automated-verification.txt'
    Expected: command exits 0 even if the previous scenario failed; `review.md` must then mark automated verification as FAIL with the transcript path.
    Evidence: .omo/evidence/task-5-automated-verification.txt
  ```

  Commit: NO | Message: `docs(review): record verification evidence` | Files: [`.omo/evidence/task-5-automated-verification.txt`]

- [ ] 6. Execute Real CLI/TUI Surface Proof In Temp Repo

  What to do: Use the built CLI against a fresh temporary git repo to prove `init`, `status`, and `dash --once` behave through the real command surface. This is the required real CLI/TUI proof.
  Must NOT do: Do not run this against the source repo root. Do not count `ink-testing-library` output as the real surface proof.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [8] | Blocked by: [1, 5]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `src/cli.ts:34-48` - `init` command creates `.between/` state
  - Pattern:  `src/cli.ts:51-80` - `status` command prints current broker state
  - Pattern:  `src/cli.ts:232-243` - `dash` command invokes `runDashboard`
  - Pattern:  `src/ui/dash.tsx:54-68` - once/live dashboard render behavior
  - Pattern:  `src/adapters/init-project.ts:20-65` - initialization writes `.between/` scaffolding
  - Test:     `test/unit/dashboard.test.tsx:14-37` - unit render baseline to compare against real output
  - External: None

  Acceptance criteria (agent-executable only):
  - [ ] `.omo/evidence/task-6-real-cli-tui.txt` contains output from `between init`, `between status`, and `between dash --once`.
  - [ ] Transcript includes `between: initialized`, `phase:`, and `BETWEEN`.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: Fresh repo CLI and one-shot TUI render
    Tool:     bash
    Steps:    bash -lc 'cd "/c/Users/lg/marketing for companies/between" && repo="$PWD" && tmp="$(mktemp -d)" && git -C "$tmp" init >/dev/null && { cd "$tmp" && echo "$ node $repo/dist/cli.js init"; node "$repo/dist/cli.js" init; echo "$ node $repo/dist/cli.js status"; node "$repo/dist/cli.js" status; echo "$ node $repo/dist/cli.js dash --once"; node "$repo/dist/cli.js" dash --once; } > "$repo/.omo/evidence/task-6-real-cli-tui.txt" 2>&1; rc=$?; rm -rf "$tmp"; exit $rc'
    Expected: command exits 0; evidence includes `between: initialized`, status lines including `phase:`, and a dashboard frame containing `BETWEEN`.
    Evidence: .omo/evidence/task-6-real-cli-tui.txt

  Scenario: Real-surface proof is not substituted by unit tests
    Tool:     bash
    Steps:    bash -lc 'cd "/c/Users/lg/marketing for companies/between" && grep -q "node .*dist/cli.js dash --once" .omo/evidence/task-6-real-cli-tui.txt && grep -q "BETWEEN" .omo/evidence/task-6-real-cli-tui.txt'
    Expected: command exits 0.
    Evidence: .omo/evidence/task-6-real-cli-tui.txt
  ```

  Commit: NO | Message: `docs(review): record cli tui surface evidence` | Files: [`.omo/evidence/task-6-real-cli-tui.txt`]

- [ ] 7. Execute Negative CLI/TUI/Error-Path Proof

  What to do: Prove the CLI handles uninitialized state and invalid approval scope through real commands. Capture exact stdout/stderr and exit behavior.
  Must NOT do: Do not infer error handling from code alone.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [8] | Blocked by: [1, 5]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `src/cli.ts:22-26` - common failure path sets exit code and reports errors
  - Pattern:  `src/cli.ts:51-80` - `status` no-state path
  - Pattern:  `src/cli.ts:131-145` - invalid approval scope handling
  - Pattern:  `src/ui/dash.tsx:56-64` - `dash --once` no-state path exits after message
  - Test:     `test/unit/dashboard.test.tsx:25-37` - approval footer happy path does not cover CLI invalid scope
  - External: None

  Acceptance criteria (agent-executable only):
  - [ ] `.omo/evidence/task-7-cli-error-paths.txt` records command, exit code, stdout, and stderr for each negative scenario.
  - [ ] `status` before init exits non-zero and mentions no state/init.
  - [ ] `dash --once` before init exits 0 or non-zero consistently with current implementation and prints the no-state guidance.
  - [ ] invalid `approve` exits non-zero and includes allowed scopes.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: Uninitialized status and dashboard behavior
    Tool:     bash
    Steps:    bash -lc 'cd "/c/Users/lg/marketing for companies/between" && repo="$PWD" && tmp="$(mktemp -d)" && git -C "$tmp" init >/dev/null && { cd "$tmp"; echo "$ node $repo/dist/cli.js status"; node "$repo/dist/cli.js" status; echo "status_exit=$?"; echo "$ node $repo/dist/cli.js dash --once"; node "$repo/dist/cli.js" dash --once; echo "dash_exit=$?"; } > "$repo/.omo/evidence/task-7-cli-error-paths.txt" 2>&1; rm -rf "$tmp"; exit 0'
    Expected: evidence includes a no-state/init message for both `status` and `dash --once`; `status_exit` is non-zero.
    Evidence: .omo/evidence/task-7-cli-error-paths.txt

  Scenario: Invalid approval scope is rejected
    Tool:     bash
    Steps:    bash -lc 'cd "/c/Users/lg/marketing for companies/between" && repo="$PWD" && tmp="$(mktemp -d)" && git -C "$tmp" init >/dev/null && { cd "$tmp"; node "$repo/dist/cli.js" init >/dev/null; echo "$ node $repo/dist/cli.js approve ship"; node "$repo/dist/cli.js" approve ship; echo "approve_exit=$?"; } >> "$repo/.omo/evidence/task-7-cli-error-paths.txt" 2>&1; rm -rf "$tmp"; exit 0'
    Expected: evidence includes `scope must be one of: merge, deploy, promote_rule` and `approve_exit` is non-zero.
    Evidence: .omo/evidence/task-7-cli-error-paths.txt
  ```

  Commit: NO | Message: `docs(review): record cli error path evidence` | Files: [`.omo/evidence/task-7-cli-error-paths.txt`]

- [ ] 8. Write `review.md` And Run Sub-Reviewer Gate

  What to do: Produce `review.md` in English. Start with findings ordered by severity, then verified commands/evidence, then non-blocking notes and next actions. Run the sub-reviewer gate before declaring the review ready.
  Must NOT do: Do not claim approval if any sub-reviewer lane fails or is inconclusive. Do not hide the scope mismatch from Task 1.

  Parallelization: Can parallel: NO | Wave 3 | Blocks: [] | Blocked by: [1, 2, 3, 4, 5, 6, 7]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `README.md:3-4` - product summary to keep review grounded
  - Pattern:  `package.json:10-35` - engine, scripts, and dependencies
  - Pattern:  `package-lock.json:1776-1783` - Commander engine requirement
  - Pattern:  `package-lock.json:2126-2160` - Ink engine requirement
  - Pattern:  `src/cli.ts:34-48` - `init` CLI behavior
  - Pattern:  `src/cli.ts:51-80` - `status` CLI behavior
  - Pattern:  `src/cli.ts:131-145` - approval scope validation
  - Pattern:  `src/cli.ts:232-243` - dashboard command route
  - Pattern:  `src/ui/dash.tsx:54-68` - dashboard render modes
  - Pattern:  `src/ui/Dashboard.tsx:40-149` - rendered dashboard surface
  - Test:     `test/unit/dashboard.test.tsx:14-37` - focused TUI test coverage
  - External: `.omo/evidence/task-1-scope.txt` through `.omo/evidence/task-7-cli-error-paths.txt` - all evidence to cite

  Acceptance criteria (agent-executable only):
  - [ ] `bash -lc 'cd "/c/Users/lg/marketing for companies/between" && test -f review.md'`
  - [ ] `review.md` includes sections for Findings, Verification, Real CLI/TUI Evidence, Scope Notes, and Sub-Reviewer Gate.
  - [ ] `review.md` includes the Node engine mismatch finding or a documented Node 20 proof outcome.
  - [ ] `review.md` cites `.omo/evidence/task-6-real-cli-tui.txt`.
  - [ ] `review.md` does not recommend refactoring `src/daemon/loop.ts` as part of this review scope.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: Review document contains required evidence-backed sections
    Tool:     bash
    Steps:    bash -lc 'cd "/c/Users/lg/marketing for companies/between" && grep -Eq "^## Findings" review.md && grep -Eq "^## Verification" review.md && grep -Eq "Real CLI/TUI" review.md && grep -Eq "Sub-Reviewer Gate" review.md && grep -Eq ".omo/evidence/task-6-real-cli-tui.txt" review.md'
    Expected: command exits 0.
    Evidence: .omo/evidence/task-8-review-md-check.txt

  Scenario: Unsupported conclusion guard
    Tool:     bash
    Steps:    bash -lc 'cd "/c/Users/lg/marketing for companies/between" && ! grep -Eiq "probably|obviously|clearly works|tests prove done" review.md'
    Expected: command exits 0.
    Evidence: .omo/evidence/task-8-review-md-unsupported-claims.txt
  ```

  Commit: NO | Message: `docs(review): add between review findings` | Files: [`review.md`]

## Final verification wave (MANDATORY - after all implementation tasks)
> Runs in PARALLEL. ALL must APPROVE. Surface results to the caller and wait for an explicit "okay" before declaring complete.
- [ ] F1. Plan compliance audit - every task done, every acceptance criterion met
- [ ] F2. Code quality review - diagnostics clean, idioms match, no dead code
- [ ] F3. Real manual QA - every QA scenario executed with evidence captured
- [ ] F4. Scope fidelity - nothing extra shipped beyond Must-Have, nothing Must-NOT-Have introduced

Sub-reviewer gate required before the parent says the review is ready:
- Goal/scope reviewer: verify `review.md` answers "ultrawork review once through" and includes the scope reconciliation.
- Code quality reviewer: verify findings are grounded in `src/cli.ts`, `src/ui/*`, tests, package files, and CI references.
- QA reviewer: verify Task 5, Task 6, and Task 7 evidence files exist and contain the exact commands/results.
- Security/supply-chain reviewer: verify dependency/runtime findings cover package engines, lockfile engines, CI Node matrix, and no secrets/PII are exposed in evidence.

Exact final gate command:
```bash
bash -lc 'cd "/c/Users/lg/marketing for companies/between" && for f in .omo/evidence/task-{1,3,5,6,7}-*.txt review.md; do ls $f >/dev/null; done && grep -Eq "Sub-Reviewer Gate" review.md && grep -Eq "Node|engine|Ink|commander" review.md && grep -Eq ".omo/evidence/task-6-real-cli-tui.txt" review.md'
```

## Commit strategy
- One logical change per commit. Conventional Commits (`<type>(<scope>): <subject>` body + footer).
- Atomic: every commit builds and passes tests on its own.
- No "WIP" / "fix typo squash later" commits on the final branch - clean up before merge.
- Reference the plan file path in the final commit footer: `Plan: .omo/plans/between-heavy-review-wave.md`.
- This assignment does not request a commit. Default final state: `review.md` and `.omo/evidence/*` present but uncommitted unless the user explicitly asks to commit.

## Success criteria
- All Must-Have shipped; all QA scenarios pass with captured evidence; F1-F4 approved; commit history clean.
