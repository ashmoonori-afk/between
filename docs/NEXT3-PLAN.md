# Between — Synthesized Build Plan (Tasks 1+2+3)

Date: 2026-06-19. Single buildable plan reconciling 4 lenses. Baseline: 17 files / 81 tests green (`npx vitest run`).

## Ordering rationale (avoid daemon/config churn)

All three tasks touch `loop.ts` + config. To avoid rewriting the same lines twice:

1. **Task 2 FIRST (developer signal)** — adds `sendDeveloperSignal()` + edits `handleReviewWritten` in the CURRENT (un-refactored) `loop.ts`. Smallest, highest-value behavioral change; do it while the file is still one place.
2. **Task 3 SECOND (loop.ts refactor)** — extract phase/command handlers into siblings AFTER the developer-signal logic exists, so the new method moves with the rest verbatim (one move, not two). Refactor is behavior-preserving; the 81+new tests are the gate.
3. **Task 1 LAST (real claude/codex + AGENT-CONTRACT + `init --agent`)** — config/init/agent-script + docs. Touches `config-schema.ts`, `init-project.ts`, `cli.ts`, adds wrapper scripts. Independent of loop internals, so it sits cleanly on top of the refactor with no further loop churn.

> Reason for this exact order (vs folding 2+3): the developer-signal change is a 3-line behavioral edit; folding it into the mechanical refactor would mix a behavior change into a "must-be-byte-identical" move and make the refactor un-reviewable. Keep them as separate commits, but order 2 before 3 so the new method is moved exactly once.

---

## TASK 2 — Blocking review -> verified developer signal

**File:** `src/daemon/loop.ts` only (+ new integration test). No FSM/schema/signature changes.

**Step 2.1 — import.** Line 30:
```
import { buildSignal, reviewerSignalBody, developerSignalBody } from '../adapters/signal-transport'
```

**Step 2.2 — add private `sendDeveloperSignal(hash)`** mirroring `openCycleAndSignal`'s send -> stamp-broker -> emit ordering:
```ts
/** Send a verified developer signal; mirrors openCycleAndSignal's send->stamp->emit. */
private async sendDeveloperSignal(hash: string): Promise<void> {
  const sig = buildSignal(
    'developer', this.current.workflow.cycle, hash,
    developerSignalBody(), this.deps.clock.nowIso(),
  )
  await this.deps.transport.send(sig) // oneshot/pty also spawn developer_command here
  await this.persist(touch({
    ...this.current,
    broker: { ...this.current.broker, last_signal: 'developer_review_available',
              last_signal_at: this.deps.clock.nowIso() },
  }, this.deps.clock))
  await this.emit('signal_sent', { target: 'developer', diff_hash: hash })
}
```

**Step 2.3 — wire into the blocking branch** of `handleReviewWritten` (currently line 380-381). Replace the lone `await this.dispatch('review_applied')` with:
```ts
// blocking findings -> signal developer to apply, THEN transition.
// We intentionally do NOT gate applying_review on a developer ack: applying_review
// keeps watchForNewDiff() running, so the developer's new diff opens the next cycle
// (diff_detected -> debouncing). No deadlock, no new FSM phase.
await this.sendDeveloperSignal(record.diff_hash)
await this.dispatch('review_applied')
```

**Invariants preserved:** clean-review/`verify_passed` branch UNTOUCHED -> `reviewed_hash` still recorded only at cycle end. TOCTOU guard (`record.diff_hash !== this.current.diff.hash` return) stays before the branch, so the developer signal's hash is unambiguous. `signal_sent` is an existing EventName; `{target,diff_hash}` already supported by `emit()`. No FSM edit: `review_written --review_applied--> applying_review` and `applying_review --diff_detected--> debouncing` already exist.

**Note on `last_signal` label:** `'developer_review_available'` is a new string value for the observability-only `broker.last_signal` field. Before merge, confirm no consumer switches on `last_signal` string values (current code only ever sets `'review_requested'`; phase-projection keys off phase, not last_signal). If any switch exists, fall back to `'review_applied'`.

**Out of scope for Task 2:** the bundled fake-agent's developer branch writes only an ack (no file edit), so a pure oneshot end-to-end "blocking -> developer edits -> cycle 2" loop will NOT self-advance from the fake-agent alone. Assert the SIGNAL/FILE/EVENT here; drive the next-cycle diff manually in the FileTransport test.

**New test:** `test/integration/developer-signal.test.ts` (see new_tests). Plus a regression assertion on the existing clean-review test: `existsSync(signalPath(p,'developer')) === false` on the clean path.

---

## TASK 3 — Safe `loop.ts` refactor (513 LOC -> seam split)

Behavior-preserving seam extraction (NOT a class split). Public API (`state`, `stopped`, `load`, `run`, `requestStop`, `tick`) unchanged. No test references any private method (verified: Grep over `test/` for handler names = no hits; only `src/runtime.ts` imports `Daemon`).

**Step 3.1 — create `src/daemon/context.ts`** (seam interface only, no logic):
```ts
export interface DaemonContext {
  readonly deps: DaemonDeps
  current(): BetweenState          // GETTER, not a snapshot (live read-after-write)
  persist(next: BetweenState): Promise<void>
  dispatch(event: EventName, mutate?: (s: BetweenState) => BetweenState): Promise<boolean>
  emit(event: string, extra?: { target?: SignalTarget; diff_hash?: string; detail?: Record<string, unknown> }): Promise<void>
  requestStop(): void
}
```
To avoid a value/type import cycle, **move `DaemonDeps` into `context.ts`** and re-export it from `loop.ts` (`export type { DaemonDeps } from './context'`) so `src/runtime.ts`'s `DaemonDeps` import is unaffected.

**Step 3.2 — create `src/daemon/phases.ts`** — move VERBATIM as free functions taking `ctx: DaemonContext`: `currentDiff`, `watchForNewDiff`, `runDebounce`, `openCycleAndSignal`, `sendDeveloperSignal` (from Task 2), `awaitAck`, `awaitReview`, `handleReviewWritten`, `expectedSignalId`, `signalTimedOut`, `timeoutError`, `readReview`, `readVerify`.

**Step 3.3 — create `src/daemon/commands.ts`** — move VERBATIM: `drainCommands`, `applyCommand`, `approve`, `forceReview`. `commands.ts` imports `openCycleAndSignal`/`currentDiff` from `phases.ts` (one-directional: phases <- commands; phases.ts must NOT import commands.ts).

**Step 3.4 — shrink `loop.ts`** to: the `Daemon` class owning `current`/`stopRequested` + seam ops `persist`/`emit`/`dispatch`, a stable `ctx` built once in the constructor, and `tick()` calling the extracted free functions. Keep the `repo_busy` block and `goal_locked -> dev_started` inline in `tick()` (tiny, tick-specific — do not over-extract).

**Mechanical rule (zero behavior change):** copy each body, then `this.current` -> `ctx.current()`, `this.dispatch` -> `ctx.dispatch`, `this.persist` -> `ctx.persist`, `this.emit` -> `ctx.emit`, `this.deps` -> `ctx.deps`, intra-handler `this.foo(...)` -> `foo(ctx, ...)`.

**Critical:** `current` MUST be a getter (`current: () => this.current`), NOT a captured value — `runDebounce`/`openCycleAndSignal`/`forceReview`/`sendDeveloperSignal` read state AFTER `await persist`/`dispatch`. `dispatch`/`persist`/`emit` stay as bound `Daemon` methods surfaced through `ctx` arrow bindings (single state writer stays in one place).

**Gate:** no new test files. `npx vitest run` must show 81 (Task-2 new test makes it 82+) passing, PLUS `npx tsc --noEmit` (verify the type-only seam has no disallowed cycle). Manual diff check: confirm every former `this.current` became `ctx.current()` (a call), no stray `this.` in moved code.

---

## TASK 1 — Real claude/codex commands + AGENT-CONTRACT + `init --agent <fake|claude|codex>`

**Step 1.1 — wrapper agent scripts.** Add two stdlib-only `.mjs` source templates (mirror `FAKE_AGENT_SOURCE` string-concatenation style so tsup bundles them) in new files:
- `src/agents/claude-reviewer.ts` exporting `CLAUDE_REVIEWER_SOURCE`
- `src/agents/codex-developer.ts` exporting `CODEX_DEVELOPER_SOURCE`

Each wrapper: read stdin (signal body); read `.between/state.json` for `cycle`,`diff_hash`; compute signal id `<role>-<cycle4>-<hash12>`; run `git diff HEAD` for context (tolerate failure -> empty diff); invoke the CLI; parse output; write Ack to `.between/acks/<id>.json`; reviewer also writes ReviewRecord (`.between/reviews/cycle-<n>.json`) and VerifyRecord (`.between/verify/cycle-<n>.json`) with exact Zod shapes; exit 0 on success, non-zero on error (logged to stderr — daemon does not block on exit code, it polls for files).

- **Claude reviewer template:** `claude --bare -p <PROMPT> --output-format json --allowedTools 'Read,Bash(git *)'` + stdin; parse the JSON envelope's `.result` field; require `ANTHROPIC_API_KEY` (fail fast with a clear stderr message if missing).
- **Codex developer template:** `codex exec <PROMPT>` + stdin; `--output-schema`/`-o` for structured output; stdout = final message, stderr = progress. NOTE in the doc that exact Codex flags/envelope are MEDIUM-confidence and must be smoke-tested against a live Codex before relying on them.

**Step 1.2 — `init --agent <fake|claude|codex>` preset (default `fake`).** In `src/cli.ts` add `.option('--agent <preset>', 'agent preset: fake | claude | codex', 'fake')` to the `init` command and pass it to `initProject`. In `src/adapters/init-project.ts`:
- Extend `InitOptions` with `agent?: 'fake' | 'claude' | 'codex'` (validate against the set; default `'fake'`).
- `fake` -> current behavior (write `fake-agent.mjs`, config keeps `agent_mode: file` + fake commands).
- `claude` -> write `claude-reviewer.mjs`; set config `agent_mode: oneshot`, `reviewer_command: 'node .between/agents/claude-reviewer.mjs'`, `developer_command` -> codex or claude as chosen.
- `codex` -> write `codex-developer.mjs`; set `agent_mode: oneshot`, `developer_command: 'node .between/agents/codex-developer.mjs'`.
- Config mutation must go through the YAML library (reuse the existing `defaultConfigYaml()` + string-replace pattern already used for `vault_path`, or build via `yamlStringify` to keep quoting/backslashes safe — H1).

**Step 1.3 — AGENT-CONTRACT doc.** New `docs/AGENT-CONTRACT.md` specifying: input sources (signal body via stdin, `.between/state.json`, `git diff HEAD`); env (`BETWEEN_ROOT`, cwd); output contracts with exact Zod shapes (Ack `{signal_id,target,cycle,diff_hash,acked_at}`, ReviewRecord `{cycle,diff_hash,findings:[{id,severity,summary,target_hash}],complete}`, VerifyRecord `{diff_hash,passed,summary}`); signal id format `<role>-<cycle4>-<hash12>`; exit semantics (0=files written, non-zero logged, daemon polls independently); risks (auth env vars, 10MB stdin cap, `.between/` is a non-adversarial local protocol not an enforcement boundary).

**Honesty constraint (CLAUDE.md rule 2):** do NOT claim the broker is validated end-to-end with real claude/codex. Only the fake-agent is. README/ADR-0002 wording stays the source of truth; the doc and review.md must say "wireable, fake-agent validated."

**New tests:** `test/unit/config-agent.test.ts` extension (assert each `--agent` preset produces the expected `agent_mode`/commands and writes the right `.mjs`), and a config round-trip assertion. Full CLI/real-CLI invocation is NOT unit-tested (no live keys); document the smoke-test command instead.

---

## FINAL — review.md update (always last on the todo list, per CLAUDE.md rule 6)

After Tasks 1-3 land, replace `review.md` with the reconciled body (see review_md output): mark the developer-signal P1 RESOLVED, mark the loop.ts oversized-module debt RESOLVED (now split into context/phases/commands), keep the remaining four P1 broker-contract blockers (stale-diff, send-failure window, verify stall, file-protocol approval) STILL-OPEN, and record the real-CLI = wireable-not-validated honesty note.

## Gate after every task
`npx vitest run` (81 -> grows with new tests, never red) + `npx tsc --noEmit` + `npm run lint`.