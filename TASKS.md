# Between — Build Tracker (phase → task)

Granular, living task breakdown derived from `DEVELOPMENT-PLAN.md` (milestones M0–M7) and
`IMPROVEMENTS.md` (`I1`–`I26`). This is the execution source of truth; update statuses as work lands.

**Legend:** ✅ done · 🟡 in progress · ⬜ todo · ⛔ blocked (env)

**Progress snapshot (updated):** the headless review loop is IMPLEMENTED, TESTED, and RUNNABLE.
- **Done:** M0 skeleton+ports, **M1** (config, atomic state, events log, lock, command-bus, migration), **M2** (deterministic hash, pinned git adapter, abnormal-state detection, untracked handling), **M3** (FSM, debounce, cycle, projection, redact, FileTransport+ack, daemon loop, reconcile, full CLI, integration tests), **M5 UI** (cmux/Kiro Ink dashboard + `dash`), snapshot store w/ retention (M4 T4.4), `.gitignore` guard (T4.3), `approve` gate (M7 T7.2), basic `summarize`.
- **Green:** `tsc --noEmit` clean · **54 tests passing** (52 logic + 2 UI render) · CLI-proven end-to-end (`init→goal→edit→review→ack→human_gate→approve→done`) · dashboard renders both states.
- **Deferred / blocked:** M0 PTY spike + real `node-pty` transport (⛔ no MSVC compiler on this host — headless path is fully functional without it); chokidar push-watcher (poll loop works); Obsidian vault file scaffolding (T4.1–T4.2); full TOCTOU guard (T6.4); detective merge/deploy gate (T7.3); rule proposal (T7.4); CI yaml; coverage gate verification.

**Environment note:** no MSVC compiler on this host → `node-pty` (native) cannot build here. The headless
core + `FileTransport` are built with **zero native deps** and are fully runnable now; `node-pty` is an
**optional** dependency loaded lazily so install/run never break (degrades with a clear message).

---

## Resolved architectural decisions (from IMPROVEMENTS.md → Open Decisions)

| # | Decision | Resolution | Status |
|---|---|---|---|
| D1 | One window vs three OS windows | One Between-owned window (Ink) embedding two PTY regions | ✅ settled (ADR-0001 todo) |
| D2 | Do `claude`/`codex` support one-shot/file-fed mode? | Empirical probe in M0 spike; `SignalTransport` abstracts both branches | ⬜ probe pending |
| D3 | Obsidian vault inside vs outside repo | Default OUTSIDE; if inside, force `.gitignore` at init | ✅ settled |
| D4 | review_timeout exit transition | → `human_gate` (visible, no silent re-loop) | ✅ implemented in FSM |
| D5 | cycle increment point + monotonicity | Atomic at new stable+never-reviewed snapshot, persisted before signal; monotonic id + `cycles_this_goal` | ✅ implemented in core |
| D6 | merge/deploy enforcement | Detective (refs watch) + pre-push hook + withheld creds; prompts = defense-in-depth only | ⬜ M7 |
| D7 | snapshot retention | Bounded window (`snapshot_retention_cycles`, gzipped) | ⬜ M4 (config key ✅) |
| D8 | untracked inclusion default | OFF by default, opt-in, honor `.gitignore` + denylist | ✅ config + redact ready |
| D9 | min Windows / WSL dependency | Win10 1809+ ConPTY; no WSL/tmux dependency | ✅ settled |
| D10 | where tunables live | All in `config.yaml` (one zod schema); `state.json` = runtime only | ✅ implemented |

---

## M0 — Transport spike, skeleton, CI · Effort M

| ID | Task | Status | Refs |
|---|---|---|---|
| T0.1 | TS project scaffold (`tsconfig` strict, `tsup`, `vitest`, hexagonal `src/{core,adapters,cli,daemon,ui}`) | ✅ | I19,I20 |
| T0.2 | `Clock` + `SignalTransport` ports (injected; no wall-clock in core) | ✅ | I11 |
| T0.3 | node-pty spike: spawn `claude`/`codex`, write a line, confirm consumed | ⛔ blocked (no compiler) → revisit on a build-tools host | I1 |
| T0.4 | Probe one-shot/file-fed mode of the CLIs (Decision D2) | ⬜ | D2 |
| T0.5 | ADR-0001 (PTY vs one-shot) committed | ⬜ | I1 |
| T0.6 | `.github/workflows/ci.yml` matrix (win+linux): tsc, lint, vitest, node-pty build check w/ documented fallback | ⬜ | I20 |

## M1 — Durable state core · Effort L

| ID | Task | Status | Refs |
|---|---|---|---|
| T1.1 | Unified zod `config.yaml` schema + defaults + fail-fast + documented YAML body | ✅ | I10 |
| T1.2 | `StateRepository`: atomic write (temp+fsync+rename) + `.bak` + load fallback chain | ⬜ | I2 |
| T1.3 | `EventsLog`: single-queue append, fsync on transitions, partial-line repair reader, versioned line shape | ⬜ | I2,I23 |
| T1.4 | Single-writer lock (`proper-lockfile`, stale reclaim) | ⬜ | I3 |
| T1.5 | `command-bus`: CLI writes request files; daemon is the only state writer | ⬜ | I3 |
| T1.6 | `schema_version` migration chain + newer-than-binary refusal | ⬜ | I23 |

## M2 — Deterministic diff hashing + watcher · Effort L

| ID | Task | Status | Refs |
|---|---|---|---|
| T2.1 | Canonical diff serialization + SHA-256 (sections always present, sorted untracked) | ✅ | I5,I15 |
| T2.2 | `git` adapter via execa with pinned flags (autocrlf/locale/renames/quotepath) over `git diff HEAD` | ⬜ | I15 |
| T2.3 | Untracked handling (`path+NUL+oid`, gitignore + text filter, opt-in) | ⬜ | I5,I17 |
| T2.4 | Exclude `.between/` at git level (pathspec) + verify gitignored | ⬜ | I22 |
| T2.5 | Abnormal-state detection (merge/rebase/cherry-pick/empty/detached) → `repo_busy` | ⬜ | I21 |
| T2.6 | chokidar watcher (cheap trigger) + safety poll + polling-only fallback | ⬜ | I24 |

## M3 — Phase FSM, debounce, cycle, ack loop (headless walking skeleton) · Effort XL

| ID | Task | Status | Refs |
|---|---|---|---|
| T3.1 | Explicit transition table (every from/event/to), `previous_phase` + `error` block | ✅ | I6 |
| T3.2 | Persisted debounce model + deterministic mid-crash recovery | ✅ | I11,I24 |
| T3.3 | `last_reviewed_hash` + bounded `reviewed_hashes` ring; same-hash skip | ✅ (core) | I4 |
| T3.4 | Atomic cycle increment before signal; `cycles_this_goal` vs monotonic id; cap → human_gate | ✅ (core) | I11 |
| T3.5 | Derive `waiting_on`/agent status from phase (single source of truth) | ✅ | I12 |
| T3.6 | `redact.ts` secret-scrub applied before first snapshot write | ✅ (module) | I17 |
| T3.7 | `SignalTransport` + `FileTransport` + ack loop (gate `reviewing` on ack file) | ⬜ | I7,I19 |
| T3.8 | CLI verbs: `init`, `status` (+`--json`), `start --headless`, `stop`, `doctor` | ⬜ | I19,I26 |
| T3.9 | `daemon/loop.ts` (poll→hash→debounce→snapshot→cycle→signal→ack→event→status) | ⬜ | §8 |
| T3.10 | `daemon/reconcile.ts` on-load recovery (debounce/in-flight/invariants) | ⬜ | I11 |
| T3.11 | Integration tests on real git tmp repos (§15.4–§15.6, crash injection) | ⬜ | I2,I20 |

## M4 — Obsidian scaffolding + bounded snapshot store · Effort M

| ID | Task | Status | Refs |
|---|---|---|---|
| T4.1 | Vault path validation + containment + slug sanitize | ⬜ | I25 |
| T4.2 | Generate `00-current.md … 06-retrospectives.md` project tree | ⬜ | §5 |
| T4.3 | `init` adds `.between/` (+ in-repo vault) to `.gitignore` | ⬜ | I22 |
| T4.4 | Snapshot store: gzip + retention by cycles + size cap + free-space precheck | ⬜ | I18 |

## M5 — Terminal orchestration (PTY) + dashboard · Effort L

| ID | Task | Status | Refs |
|---|---|---|---|
| T5.0 | UI design spec from cmux + kiro (`docs/ui-design-spec.md`) | ✅ | — |
| T5.1 | `pty-host` over node-pty (lazy/optional); one-shot branch per D2 | ⛔ build-blocked; interface + fallback shipped | I1 |
| T5.2 | Ink broker-dominant 3-region dashboard (design tokens applied) | ⬜ | §2,§11 |
| T5.3 | Agent liveness (onExit/onData + timeout) → error/human_gate | ⬜ | I16 |
| T5.4 | Pane-readiness gate; one-line pointer signals only | ⬜ | I7 |
| T5.5 | `doctor` PTY-runtime probe | ⬜ | — |

## M6 — Close the review loop · Effort L

| ID | Task | Status | Refs |
|---|---|---|---|
| T6.1 | Structured review record `.between/reviews/cycle-NNNN.json` | ⬜ | I8,I13 |
| T6.2 | Verify record + cycle-end calc (blocking==0 && passed) | ✅ (core calc) / ⬜ wiring | I13 |
| T6.3 | Review-feed watcher → developer signal on complete+matching hash | ⬜ | I8 |
| T6.4 | TOCTOU guard (review immutable snapshot; re-verify hash before send; cancel superseded) | ⬜ | I14 |
| T6.5 | Per-signal lifecycle persistence for restart reconciliation | ⬜ | I7 |

## M7 — Analytics, human gate, rule proposal · Effort M

| ID | Task | Status | Refs |
|---|---|---|---|
| T7.1 | Pure analytics reducers over `events.jsonl` + `between summarize` → `05-cycle-analysis.md` | ⬜ | §12,I20 |
| T7.2 | `between approve <merge|deploy|promote-rule>` token + gated human_gate exit | ⬜ | I9 |
| T7.3 | Detective gate: watch refs/HEAD/remote → error/human_gate on unapproved push | ⬜ | I9 |
| T7.4 | Rule proposal from repeated findings (propose-only, human-promoted) | ⬜ | §13 |

---

## Cross-cutting / quality gates

| ID | Task | Status |
|---|---|---|
| Q1 | `tsc --noEmit` clean + `prettier --check` clean | ✅ |
| Q2 | vitest suite green | ✅ (59) |
| Q3 | ≥80% coverage on `src/core` | ✅ (95.8% lines / 91% branch) |
| Q4 | code-review + security-review pass (spaghetti, consistency, security, progress) | ✅ addressed |
| Q5 | Runnable proof: CLI drives a real tmp git repo end-to-end + dashboard renders | ✅ |

### Review hardening applied (parallel code + security reviewers, + external omo wave)

Fixed: events-log error surfacing (no silent swallow); **command-bus zod validation + drain cap** (a hand-written `approve` file can no longer bypass the human gate, C1) + flood guard; **ack-store zod validation + atomic write**; **vault path YAML-safe serialization + existence check** (I25/H1); `recordReviewedHash` moved to cycle-commit (verify_passed, I4/HIGH-3); review TOCTOU hash guard (I14/HIGH-2); `openCycleAndSignal` single-projection persist (I12/HIGH-1); snapshot prune keeps file on stat-failure; `isBetweenState` validates `reviewed_hashes`/counters; `git hash-object` chunked (HIGH-9); redact patterns expanded (connection-string/`*_KEY`/Stripe/SendGrid/Google) + replace-all; lock `realpath:true` + owner sanitization; **engine floor `>=22.12.0`** (ink@7/commander@15 require it; Node 20 is EOL); status shows max-cycles; CLI parse errors surfaced.
Deferred (documented): events.jsonl rotation (M1), full BetweenState zod schema (H3), `npm audit fix` esbuild dev-only advisory (L4), real `node-pty` transport (build-tools host).
