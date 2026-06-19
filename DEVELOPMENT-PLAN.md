# Between — Development Plan

> Phased Node.js + TypeScript build plan for **Between**, a local terminal broker for AI pair development.
> Product baseline: `between/BETWEEN-BROKER-BLUEPRINT.md` (referenced as §N). Implementation source of truth: this plan, which updates the blueprint for a Node.js + TypeScript build, incorporates the adversarial design review (improvement IDs `I1`–`I26`), and resolves its open architectural decisions before any code is written.

---

## 1. Overview

Between launches and observes three terminals — a developer (Claude), a reviewer (Codex), and a broker dashboard — and coordinates a diff-driven review loop without the agents ever talking to each other (§1, §3.1). The blueprint's value proposition is observability and recoverability (§17), so the plan is sequenced to make the **durable, headless control loop correct and crash-safe first**, and to treat terminals as an output/transport adapter that is added last behind a tested interface.

Three hard truths drive the sequencing:

1. **Windows Terminal cannot inject keystrokes into a running pane from the CLI** (`I1`). `send_keys` (§10) is the transport every signal depends on, so Between must *own* the agent processes via a PTY (`node-pty`) rather than drive `wt.exe`. This is the single riskiest assumption and is de-risked in a throwaway spike in **M0** before any feature work.
2. **The recoverability promise (§5 "valid JSON and recoverable after process restart", §3.9) is unbacked unless writes are atomic and single-writer** (`I2`, `I3`). These are built in **M1**, before anything writes durable state.
3. **The same-hash guardrail (§3.7, §15.6, §16 "Token Waste") rests entirely on a deterministic, cross-machine diff hash** (`I4`, `I5`, `I15`). The hasher is isolated, pinned, and CI-tested across OSes in **M2**.

The build follows a **walking-skeleton-first** strategy: a fully headless `edit → poll → hash → debounce → snapshot → cycle++ → ack → event → status` loop is validated behind a `SignalTransport` interface (first impl: `FileTransport`) and gated behind a green CI matrix **before** any PTY/terminal code exists (`I19`, `I20`). Terminals then swap in as an adapter.

Architecture is **hexagonal**: a pure, deterministic `core` (FSM, diff-hash, debounce, cycle math, config schema, analytics reducers) with an injected `Clock`; `adapters` (git, fs repositories, Obsidian writer, signal transports, PTY); `cli` (commander verbs); and `daemon` (the poll loop composing core + adapters).

---

## 2. Tech Stack

| Concern | Library | Rationale |
|---|---|---|
| Runtime / language | **Node.js 20 LTS + TypeScript 5.x (strict)** | Single distributable surface, native to the `claude`/`codex` CLI ecosystem, npm-installable. `strict` enforces the project's fail-fast boundary rules. |
| CLI framework | **commander** | Mature, declarative subcommand/flag parsing for the §14 verbs (`init`/`start`/`status`/`pause`/`resume`/`review-now`/`summarize`) plus added `stop`/`doctor`/`approve` (`I26`, `I9`). |
| Config validation | **zod** | One typed schema for `config.yaml`; fail-fast at the system boundary; single source of defaults (`I10`). |
| YAML | **yaml** (eemeli/yaml) | Round-trips comments so `between init` can write a *documented* `config.yaml`. |
| Git interop | **execa** | Child-process wrapper with argv arrays (no shell injection) for all pinned `git diff/status/rev-parse` calls (`I15`). |
| Atomic state writes | **write-file-atomic** | temp + fsync + rename with Windows-EPERM retry; backs the §5 recoverability guarantee (`I2`). |
| Single-writer lock | **proper-lockfile** | pidfile-based exclusive lock on `.between/` with stale-lock reclaim; prevents two-daemon corruption (`I3`). |
| PTY host | **node-pty** | ConPTY on Windows 10 1809+, `forkpty` elsewhere. The broker OWNS the agent children; `send_keys` = `ptyProcess.write()` — the only transport that can actually deliver a signal (`I1`). |
| TUI / dashboard | **Ink** (React-for-CLI) | Renders the broker-dominant 3-region §2/§11 layout and embeds the two PTY regions in ONE Between-owned window. |
| File watching | **chokidar** | Debounced fs watcher as a cheap trigger to decide *when* to run the expensive git-diff hash; also watches the review sidecar; slow safety poll as backstop (`I24`). |
| Hashing | **node:crypto** SHA-256 | Deterministic dedup key over a canonical serialized diff payload (`I5`). |
| Logging | **pino** (NDJSON) | Broker diagnostics, kept separate from the durable `events.jsonl`. |
| Testing | **vitest** + **@sinonjs/fake-timers** (via injected `Clock`) | Fast, TS-native unit + integration; deterministic debounce/FSM tests; real-git tmp-dir integration harness. |
| Lint / format | **eslint + prettier** | Standard gate. |
| Build / dist | **tsup** (esbuild) | Single CJS/ESM bundle exposing a `between` bin; published to npm. |
| CI | **GitHub Actions** matrix (`windows-latest` + `ubuntu-latest`) | `tsc --noEmit`, lint, vitest, coverage gate; protects diff-hash determinism. Terminal E2E stays a manual smoke checklist. |

**Platform floor** (Decision): Windows 10 1809+ (build 18309+) for ConPTY; the PTY path is cross-platform, so WSL/tmux is **not** a required dependency (optional "attach to existing tmux" mode only).

---

## 3. Proposed Repo / Project Structure

```text
between/
├─ package.json                 # bin: { "between": "dist/cli.js" }, scripts, deps
├─ tsconfig.json                # strict: true, noUncheckedIndexedAccess, isolatedModules
├─ tsup.config.ts               # bundle src/cli.ts -> dist, shebang for the bin
├─ vitest.config.ts             # coverage thresholds (80% on src/core, see §4)
├─ .eslintrc.cjs / .prettierrc
├─ .github/
│  └─ workflows/ci.yml          # matrix: {windows-latest, ubuntu-latest}; tsc/lint/test/coverage; node-pty build check
├─ docs/
│  └─ adr/                       # ADRs; ADR-0001 = transport decision (M0)
│  └─ agent-contract.md          # required agent file-write protocol (M0/M3)
├─ src/
│  ├─ cli.ts                     # commander entrypoint; wires verbs
│  ├─ cli/                       # one file per verb: init, start, status, pause,
│  │                            #   resume, review-now, summarize, stop, doctor, approve
│  ├─ core/                      # PURE, no IO, injected Clock — 100% unit-tested
│  │  ├─ fsm.ts                  # explicit transition table (I6)
│  │  ├─ diff-hash.ts            # canonical serialization + SHA-256 (I5, I15)
│  │  ├─ debounce.ts             # candidate-hash debounce model (I11, I24)
│  │  ├─ cycle.ts                # cycle-id + cycles_this_goal math (I11)
│  │  ├─ phase-projection.ts     # phase -> waiting_on/agent-status mapping (I12)
│  │  ├─ config-schema.ts        # zod schema + defaults (I10)
│  │  ├─ findings.ts             # blocking/non-blocking schema + cycle-end calc (I13)
│  │  ├─ redact.ts               # secret denylist + entropy scrub (I17)
│  │  └─ analytics.ts            # pure reducers over events + records (§12)
│  ├─ adapters/
│  │  ├─ git.ts                  # execa, pinned flags, abnormal-state detection (I15, I21)
│  │  ├─ state-repository.ts     # atomic write + .bak + migration chain (I2, I23)
│  │  ├─ events-log.ts           # single-queue append, fsync, repair reader (I2, I23)
│  │  ├─ lock.ts                 # proper-lockfile single-writer (I3)
│  │  ├─ command-bus.ts          # CLI->daemon request files / IPC (I3)
│  │  ├─ obsidian-writer.ts      # vault scaffolding + path containment (I25)
│  │  ├─ snapshot-store.ts       # gzip, retention/size pruning (I18)
│  │  ├─ signal-transport.ts     # interface + FileTransport + PtyTransport (I19)
│  │  ├─ ack-store.ts            # .between/acks reconciliation (I7)
│  │  ├─ review-watcher.ts       # chokidar on review sidecar (I8)
│  │  └─ pty-host.ts             # node-pty session mgmt + liveness (I1, I16)
│  ├─ daemon/
│  │  ├─ loop.ts                 # composes core + adapters; the §8 poll loop
│  │  └─ reconcile.ts            # on-load recovery (debounce/in-flight/invariants)
│  └─ ui/                        # Ink components for the §11 dashboard
├─ test/
│  ├─ unit/                      # core/* with fake-timers
│  ├─ integration/               # real git in tmp dirs (I20: §15.4–§15.6)
│  ├─ fake-agents/               # scripted Claude/Codex stand-ins for ack/review/verify contracts
│  ├─ fixtures/                  # v1 state.json, golden diffs, crash-injection helpers
│  └─ e2e-smoke.md              # MANUAL terminal checklist (§15.2)
└─ .between/                     # created by `between init` in a target repo (NOT in this repo)
   ├─ config.yaml               # commented, zod-validated (see schema below)
   ├─ state.json  + state.json.bak
   ├─ events.jsonl
   ├─ broker.lock
   ├─ commands/                 # CLI->daemon request inbox (I3)
   ├─ acks/                     # <signal_id>.json receipts (I7)
   ├─ signals/                  # signal-reviewer.json / signal-developer.json (I7)
   ├─ reviews/                  # cycle-NNNN.json structured review records (I8, I13)
   ├─ verify/                   # cycle-NNNN.json verification records (I13)
   ├─ snapshots/                # cycle-NNNN.diff.gz (bounded, scrubbed) (I17, I18)
   └─ cycles/
```

### `config.yaml` schema (single zod source of defaults — `I10`)

All tunables live here; `state.json` holds runtime state only (Decision). Keys are **forward-declared in full now** so later milestones don't reshape the schema (critique: "M4–M6 config keys not forward-declared"):

```yaml
schema_version: 1
# --- §7 watch / debounce / cycle ---
watch_interval_seconds: 6
diff_debounce_seconds: 25
max_cycles_per_goal: 8
review_timeout_seconds: 900
developer_timeout_seconds: 900        # symmetric timeout, was missing (I7)
same_hash_review_policy: skip
# --- §7 human gate ---
human_gate_required_for_merge: true
human_gate_required_for_deploy: true
# --- diff scope (I5, I17) ---
review_untracked: false               # OFF by default, opt-in (I17)
untracked_file_globs: []
binary_hash_max_bytes: 262144         # above this, hash blob OID not content (I5)
# --- snapshots (I18) ---
snapshot_retention_cycles: 50
snapshot_max_total_mb: 200
# --- vault (I25) ---
vault_path: ""                        # validated existing writable dir
# --- §13 rule promotion ---
auto_propose_rules: true
auto_promote_rules: false
promotion_requires_human: true
```

### `.between/state.json` schema additions over §5

The §5 example is extended with fields the critique proved necessary (`I4`, `I6`, `I11`, `I12`):

```jsonc
{
  "schema_version": 1,
  "workflow": {
    "phase": "reviewing",            // SINGLE SOURCE OF TRUTH (I12)
    "previous_phase": "review_requested", // for resume (I6)
    "cycle": 7,                       // monotonic id
    "cycles_this_goal": 3,            // distinct from id; drives max_cycles (I11)
    "last_reviewed_hash": "abc123",   // keystone dedup field (I4)
    "reviewed_hashes": ["abc123"],    // bounded ring; handles revert (I4)
    "error": null                     // {code,message,occurred_at,recoverable} (I6)
  },
  "debounce": {                       // persisted so a mid-debounce crash recovers (I11)
    "candidate_hash": null,
    "candidate_first_seen_at": null,
    "debounce_restarts": 0
  },
  "approval": null                    // {actor:"human",scope,diff_hash} token (I9)
  // ... §5 project/diff/developer/reviewer/broker blocks retained ...
}
```
`waiting_on` and per-agent `status` are **derived** from `phase` on render and reconciled-with-correction on load — never an independent third copy (`I12`). `diff.previous_hash` is observability-only and MUST NOT drive dedup (`I4`).

---

## 4. Testing & CI Strategy

The blueprint specifies no tests, module boundaries, or CI (`I20`); this section fills that gap.

**Test pyramid (vitest):**

- **Unit (`test/unit`, fast, deterministic):** all of `src/core`. An injected `Clock` interface + `@sinonjs/fake-timers` makes debounce/FSM/timeout logic deterministic. Golden-diff hashing tests assert that `.between/` paths and timestamps are excluded and that staging an unchanged file is hash-invariant (`I5`). FSM tests cover **every** `(from,event,guard,to)` edge (`I6`). JSONL crash-safety tests assert a trailing partial line is repaired, not fatal (`I2`).
- **Integration (`test/integration`, real git in tmp dirs):** map directly to acceptance criteria — diff detected within one interval (§15.4), review only after debounce (§15.5), same-hash no-repeat (§15.6). **Crash-injection** tests `kill -9` the process between writes and assert recovery (`I2`). The CLI→daemon **command bus** is tested here so single-writer IPC is not unverified (critique: "I3 IPC untested in M1").
- **Manual E2E smoke (`test/e2e-smoke.md`):** real terminals / real `claude`/`codex` PTYs (§15.2). Not in CI.

**Coverage gate:** vitest enforces **≥80% on `src/core`** (the deterministic surface), per the project rule. Adapters/UI are covered by integration where feasible; PTY/Ink are smoke-tested manually. The threshold is enforced in `vitest.config.ts` and fails CI if breached (critique: "no coverage gate").

**CI (`ci.yml`), required green before merge:**

1. Matrix `{windows-latest, ubuntu-latest}`.
2. `tsc --noEmit` → lint → `vitest run --coverage`.
3. **Cross-OS determinism test:** assert an identical logical diff yields an identical hash on both runners (`I15`) — this is the foundation of the same-hash guardrail and silently diverges per-OS without it.
4. **`node-pty` build check** on both runners (it has a native build step); if a runner cannot build it, the job records a documented fallback so the headless path stays releasable (critique: "no node-pty CI fallback").

---

## 5. Dependency-Ordering Note

The milestone DAG is **acyclic** and ordered by *risk* and *write-safety*, not by the blueprint's §18 library-first listing (which would surface hashing/FSM bugs only after terminal integration and hit the `wt.exe` dead-end last — `I19`):

```text
M0 ──> M1 ──> M2 ──> M3 ──> M4 ──┐
                       │         ├──> M5 ──> M6 ──> M7
                       └─────────┘
```

Adversarial-review fixes applied to the ordering:

- **ACK protocol (`I7`) moved into M3, not M6.** The FSM gates the `reviewing` phase on a received ack; building the FSM (M3) with a stubbed/fire-and-forget send would be a false-green. M3 closes the ack loop against `FileTransport` so the loop logic is proven before real terminals.
- **Secret-scrub (`I17`) moved before any snapshot is persisted.** `redact.ts` lands in M3 (core, unit-tested) and is applied the first time M3 writes a snapshot — never after (critique: "scrub after snapshot write").
- **The M0 PTY spike is continuous, not one-shot.** The `node-pty` build check and the one-shot-vs-injection decision stay live through M5; M5 does not "discover" a new runtime.
- **One-shot branch is dual-transport.** If `claude`/`codex` support a file-fed/stdin one-shot mode (Decision 2), `PtyTransport` invokes them per-signal and the keystroke-injection/pane-readiness problem disappears; if not, it injects a one-line pointer. Both implement the same `SignalTransport` interface, so M3 is unaffected either way.
- **M5 (PTY) depends on M3, not M4.** Terminal orchestration needs the tested loop + transport interface (M3), not the Obsidian/snapshot layer (M4). M4 and M5 both depend on M3 and can proceed in parallel; M6 depends on both.
- **`between doctor` defers its PTY-runtime check.** In M3, `doctor` checks git/repo/vault; the "PTY runtime available" probe is added in M5 when that runtime exists (critique: "doctor checks a PTY runtime absent until M5").

Each milestone is shippable-internal: it ends green on CI and its acceptance criteria are machine-checkable.

---

## 6. Milestone Roadmap

### M0 — Transport spike, project skeleton, CI · Effort: **M**

**Goal:** De-risk the `wt.exe` dead-end (`I1`) and stand up the buildable TS project before any feature work.

**Tasks (ordered):**
1. [ ] Spike: spawn `claude` and `codex` via `node-pty`, write a line, observe it consumed by the agent.
2. [ ] Investigate whether the CLIs support a one-shot / file-fed / stdin mode (Decision 2); record the chosen signal-delivery model.
3. [ ] Write **ADR-0001**: broker-owned PTY vs one-shot invocation; commit it.
4. [ ] Scaffold hexagonal project (`src/core|adapters|cli|daemon|ui`), `tsconfig` strict, `tsup` bundle with `between` bin.
5. [ ] Add eslint + prettier + vitest; define the `SignalTransport` and `Clock` interfaces (injected everywhere; no wall-clock in core).
6. [ ] Add `ci.yml` matrix (`windows-latest`+`ubuntu-latest`): `tsc --noEmit`, lint, vitest, and a `node-pty` build check with a documented fallback.

**Dependencies:** none.

**Acceptance criteria:**
- A spike script writes a line into a running `claude` PTY and the agent acts on it (or a one-shot mode is empirically proven instead) (`I1`).
- ADR-0001 committed and decides the transport model.
- CI matrix is green on the empty skeleton (typecheck + lint + one trivial test) on **both** Windows and Linux, and the `node-pty` build check passes or records its fallback.

---

### M1 — Durable state core: config, atomic state.json, events.jsonl, single-writer lock · Effort: **L**

**Goal:** Make the durable contract crash-safe and concurrency-safe before anything writes to it (§5, §3.9).

**Tasks (ordered):**
1. [ ] Implement the unified zod `config.yaml` schema with full forward-declared keys (§3 above); ship code defaults; fail-fast on unknown/invalid keys (`I10`).
2. [ ] `StateRepository`: `write-file-atomic` (temp + fsync + rename, Windows-EPERM retry) + `.bak` before each rename; on load fall back to `.bak`, then `events.jsonl` reconstruction, else `error` phase (`I2`).
3. [ ] `EventsLog` appender: single in-process queue, one complete `\n`-terminated line per write, fsync on transition records; reader skips/repairs a trailing partial line; **version the JSONL line shape** so format evolution is migratable (`I2`, `I23`; critique: "events.jsonl migration unversioned").
4. [ ] Single-writer lock via `proper-lockfile` (pid+host+ts, `O_EXCL`, stale reclaim on dead pid); refuse a second writer naming the owning pid (`I3`).
5. [ ] `command-bus`: CLI verbs write a request file the daemon consumes (no direct `state.json` edits from CLI) (`I3`).
6. [ ] `schema_version` load policy: ordered migration chain for older, refuse-to-start with "upgrade Between" for newer, `.bak` before migrate (`I23`).

**Dependencies:** M0.

**Acceptance criteria (machine-checkable):**
- Crash-injection test (`kill -9` mid-write) leaves either valid `state.json` or a recoverable `.bak` — never an unreadable broker (`I2`).
- A second writer is refused with the owning pid; a stale lock from a dead pid is reclaimed (`I3`).
- An integration test drives a state mutation **through the command bus** and asserts only the daemon wrote it (`I3` IPC tested).
- `config.yaml` with an unknown/invalid key fails fast with a precise message; a `v1` state fixture loads into the current binary via migration (`I10`, `I23`).

---

### M2 — Deterministic diff hashing + watcher · Effort: **L**

**Goal:** Produce a stable, cross-machine-comparable diff hash the same-hash guardrail can rely on (§8, §3.7, §15.6).

**Tasks (ordered):**
1. [ ] Git access via execa with pinned flags: `-c core.autocrlf=false -c core.quotepath=false --no-renames --no-color --no-ext-diff`, fixed `--src-prefix/--dst-prefix`, stable `LC_ALL`/`TZ` (`I15`).
2. [ ] Canonical serialization: `SHA256('UNSTAGED\0'+diff + '\0CACHED\0'+cached + '\0UNTRACKED\0'+untrackedBlob)`, all sections always present (empty when absent); unstaged+cached concatenated so `git add` is hash-invariant; blob-OID hashing for binary/large files above `binary_hash_max_bytes` (`I5`).
3. [ ] Untracked handling: `path + NUL + content OID` for files passing the text/gitignore filter; exclude mtime/size-proxy (`I5`).
4. [ ] Exclude `.between/` at the git level via pathspec `':(exclude).between/**'` (applied to untracked too); verify `.between/` is gitignored (`I22`).
5. [ ] Abnormal-state detection (`MERGE_HEAD`, `rebase-merge/`, `rebase-apply/`, `CHERRY_PICK_HEAD`, empty repo via `rev-parse -q --verify HEAD`, detached HEAD, porcelain `UU`) → `repo_busy` holding substate; catch per-tick git errors without killing the loop (`I21`).
6. [ ] chokidar debounced watcher (exclude `.git/`, `.between/`) as the cheap trigger to run the hash, with a ~30s safety poll backstop **and a polling-only fallback where recursive `fs.watch` is unsupported** (`I24`; critique: "polling fallback absent").

**Dependencies:** M1.

**Acceptance criteria:**
- Cross-OS CI test: identical logical diff yields identical hash on Windows and Linux (`I15`).
- Staging an already-changed file with no content modification does NOT change the hash (`I5`, §15.6 prerequisite).
- Between's own writes to `.between/` never change the hash; a mid-rebase/conflict state enters `repo_busy` instead of producing a review object (`I21`, `I22`).
- A changed git diff is detected within one polling interval (§15.4).

---

### M3 — Phase FSM, debounce, cycle model, ack loop (headless walking skeleton) · Effort: **XL**

**Goal:** Prove `edit → poll → hash → debounce → snapshot(scrubbed) → cycle++ → signal → ack → event → status` end-to-end with terminals stubbed via `FileTransport` (§15.1, §15.3, §15.4, §15.5, §15.6, §15.8).

**Tasks (ordered):**
1. [ ] Encode the explicit transition table as a pure FSM — every `(from,event,guard,to,side-effect)` — with `previous_phase` + `error` block persisted; `done`/`error` terminal-with-explicit-exits (`I6`). Happy path `goal_locked→developing→diff_detected→debouncing→review_requested→reviewing→review_written→applying_review→verifying→human_gate`, plus branches: `verifying`-fail→`developing`; debounce hash-change self-loop; debounce-reverts-to-`last_reviewed`→`developing` (abort, no cycle, log); any phase + pause→`paused`; `paused`+resume→`previous_phase`; `review_timeout`→`human_gate`; `repo_busy` hold; agent death→`error`/`human_gate`; `max_cycles`→`human_gate`.
2. [ ] Persist debounce state `{candidate_hash, candidate_first_seen_at, debounce_restarts}`; reload rule recomputes the live hash and either proceeds (≥ window) or restarts; state the real guarantee: review only after `N = ceil(25/6) = 5` consecutive equal polls spanning ≥ `diff_debounce_seconds` (`I11`, `I24`).
3. [ ] Add `last_reviewed_hash` + bounded `reviewed_hashes` ring; same-hash skip = emit review only if `current != last_reviewed AND not in reviewed_hashes`; `previous_hash` observability-only (`I4`).
4. [ ] Atomic cycle increment at the new-stable-never-reviewed snapshot, persisted **before** any signal; `cycles_this_goal` vs monotonic `cycle` id; `cycles_this_goal >= max_cycles_per_goal` → `human_gate` (`I11`).
5. [ ] Derive `waiting_on` + agent statuses from `phase` (single source of truth) with reconcile-on-load + a fail-fast invariant assertion (`I12`).
6. [ ] **Apply `redact.ts` secret-scrub before the first snapshot write** (denylist + entropy/token redaction; record that a file was redacted) (`I17`, moved earlier).
7. [ ] Define `SignalTransport`; implement `FileTransport` (writes one-line pointer to `.between/signals/` + full payload file); **implement the ack loop now**: gate the `reviewing` phase on `.between/acks/<signal_id>.json` appearing, not on the send; embed `(cycle, diff_hash)` idempotency key so re-sends are receiver no-ops (`I7`, pulled forward from M6).
8. [ ] Implement CLI verbs: `between init` (idempotent), `between status` (+ `--json`), `between start --headless`, `between stop`, `between doctor` (git/repo/vault checks only; PTY probe deferred to M5) (`I19`, `I26`).

**Dependencies:** M2.

**Acceptance criteria:**
- FSM unit tests cover every edge incl. debounce-revert→`developing` (no cycle), pause→`paused`→resume→`previous_phase`, `max_cycles`→`human_gate` (`I6`).
- Same diff hash does not trigger repeated reviews; diff reviewed only after the debounce window (§15.5, §15.6, `I4`).
- The `reviewing` phase is entered only after an ack file appears; a lost signal does not silently advance the loop (`I7`).
- `events.jsonl` records every phase transition; `status --json` reflects phase/cycle/hash/waiting actor (§15.8, §15.3).
- `between init` creates all state files idempotently and is re-run-safe (§15.1); **`between start --headless` runs the loop, `between stop` cleanly terminates the daemon, and resume restores `previous_phase`** — all asserted by integration tests (critique: "start/stop/resume unaccepted").
- A crash mid-debounce recovers deterministically on reload (`I11`); a snapshot containing a `.env`/key file is redacted, never written verbatim (`I17`).

---

### M4 — Obsidian scaffolding + bounded snapshot store · Effort: **M**

**Goal:** Generate the human-readable memory layer (§5 vault) and persist review objects without leaking secrets or filling disk (`I17`, `I18`, `I25`).

**Tasks (ordered):**
1. [ ] Validate `--vault` at init (existing writable dir; warn/flag if no `.obsidian/`); slug-sanitize `<project>`, reject/escape separators and `..`, assert the resolved path is contained within the vault root before any write; store vault root separately and re-derive `obsidian_project_path` on start (`I25`).
2. [ ] Generate the §5 Obsidian project tree (`00-current.md` … `06-retrospectives.md`); "Creates or links" defaults to **real directories** (portable), symlink is explicit opt-in with a Windows elevation/developer-mode caveat (`I25`).
3. [ ] `between init` adds `.between/` (and any in-repo vault/coordination path) to `.gitignore` (create if absent) and verifies on start (`I22`).
4. [ ] Snapshot store: gzip (`cycle-NNNN.diff.gz`), prune by `snapshot_retention_cycles` + `snapshot_max_total_mb` on each write and on start, exclude binaries from the persisted snapshot per §5's intent, free-space precheck before writes (`I18`). (Scrubbing already applied in M3.)

**Dependencies:** M3.

**Acceptance criteria:**
- `between init` creates the Obsidian project tree and a `.gitignore` entry for `.between/` (§15.1, `I22`).
- `snapshots/` stays within the configured retention/size budget across many cycles (`I18`).
- A stale or non-containable vault path fails with a clear message, not a wrong-location write (`I25`).

---

### M5 — Terminal orchestration (broker-owned PTY) + dashboard · Effort: **L**

**Goal:** Replace `FileTransport` with a real, swappable `PtyTransport` and render the broker-dominant 3-region workspace (§2, §11, §15.2). Depends on M3 (tested loop + interface), runs in parallel with M4.

**Tasks (ordered):**
1. [ ] Implement `create_session / send_keys(write) / focus / read_recent_output(ring buffer) / close_session` over `node-pty` per ADR-0001; if one-shot mode was chosen, `PtyTransport` invokes the CLI per-signal instead of injecting (`I1`, Decision 2).
2. [ ] Render the §2/§11 broker-dominant layout in Ink, embedding the two agent PTY regions; show phase, `cycle N/max`, waiting actor, diff, timers, recent events, last-ack age (`I1`, `I16`).
3. [ ] Attach `onExit`/`onData` + liveness timeout per agent: agent death → `error`/`human_gate` (offer `between resume` to respawn); `review_timeout`/`developer_timeout` → `human_gate` (no silent re-loop) (`I16`).
4. [ ] Pane-readiness gate (prompt sentinel) before any write; one-line file-pointer signals only — never multi-line typing (`I7`).
5. [ ] Add the PTY-runtime probe to `between doctor` (deferred from M3).

**Dependencies:** M3.

**Acceptance criteria (rewritten §15.2 per `I1`):**
- `between start` opens a broker-owned 3-region workspace where the developer/reviewer regions are **PTY-backed and accept programmatic signals with verifiable receipt** — not three display-only panes.
- The broker pane visibly tracks phase, cycle, diff hash, and waiting actor (§15.3).
- Killing an agent process transitions to `error`/`human_gate` and surfaces it on the dashboard rather than hanging (`I16`).

---

### M6 — Close the review loop: structured records + developer signal · Effort: **L**

**Goal:** Make the review feed machine-detectable and the loop advance correctly under concurrency (§6 `review_written`, §15.7, `I8`, `I13`, `I14`). (Ack protocol already built in M3.)

**Tasks (ordered):**
1. [ ] Structured review record `.between/reviews/cycle-NNNN.json` `{cycle, diff_hash, findings:[{id,severity:'blocking'|'non-blocking',summary,target_hash}], complete:true}`; treat `02-review-feed.md` as the human-readable mirror (`I8`, `I13`).
2. [ ] Verification record `.between/verify/cycle-NNNN.json` `{diff_hash, passed, summary}`; cycle-end #2 (§7.2) computed from `blocking-count == 0 AND passed` — not a magic string. Severity is reviewer-set, not developer-downgradable; a disputed finding routes to `human_gate` (`I13`).
3. [ ] Watch the review sidecar (chokidar, debounced); fire the developer signal only when `complete:true AND diff_hash == current reviewed hash` (`I8`).
4. [ ] TOCTOU guard (`I14`): the reviewer reviews the immutable `.between/snapshots/cycle-NNNN.diff` (already in state), not live `git diff`; re-verify the live hash immediately before send (abort + re-debounce on mismatch); the `diff_detected`→new-cycle transition cancels the outstanding reviewer signal for the superseded hash; tag every review with `target_hash` and discard reviews whose `target_hash != current reviewed hash`; surface `reviewed_hash` vs `current_hash` drift on the dashboard.
5. [ ] Persist per-signal lifecycle `{target,cycle,diff_hash,sent_at,acked_at,completed_at}` for restart reconciliation (`I7`).

**Dependencies:** M5.

**Acceptance criteria:**
- A structured review record for the current cycle+hash triggers a developer signal; unrelated/stale human edits to `02-review-feed.md` do NOT (§15.7, `I8`).
- A lost signal is re-sent only when the expected ack/record is absent past timeout, and re-sends are no-ops for already-handled hashes (`I7`).
- An edit during `reviewing` cancels the superseded reviewer signal and does not produce a stale-hash "reviewed" mark (`I14`).

---

### M7 — Analytics, human gate, conservative rule proposal · Effort: **M**

**Goal:** Deliver first-class observability/summaries, an enforced human gate, and safe rule promotion (§12, §13, §15.9, §15.10, `I9`, `I20`).

**Tasks (ordered):**
1. [ ] Pure analytics reducers over `events.jsonl` + records for the §12 metrics (`blocking_findings_per_cycle`, `verification_failures`, `same_hash_skips`, etc.); `between summarize` writes `05-cycle-analysis.md` (`I20`).
2. [ ] `between approve <merge|deploy|promote-rule>` writes an approval token `{actor:"human", scope, diff_hash}` to `state.json`; `human_gate` exits keyed on it; render the §9 To-Human prompt as a blocking dashboard banner (`I9`).
3. [ ] Detective gate: broker watches `refs`/branch/HEAD/remote (not just diff); any unapproved push or history rewrite → `error`/`human_gate`. **Honest trust boundary:** Between is an observer, not a sandbox; document prompt rules (§16) as defense-in-depth only and recommend withheld push credentials + a repo-local pre-push hook checking the approval token (`I9`).
4. [ ] Rule proposal: repeated-finding detection → proposed rule in `06-retrospectives.md`; `auto_propose_rules` on, `auto_promote_rules` off, `promotion_requires_human` (§13).

**Dependencies:** M6.

**Acceptance criteria:**
- `between summarize` produces readable cycle analysis (§15.9); §12 metrics are computed from the durable log (`I20`).
- Merge and deploy remain human-gated and an unapproved push is **detected and surfaced** (§15.10, `I9`).
- Repeated findings produce a proposed rule that is never auto-promoted without human approval (§13).

---

## 7. Cut Lines / Deferred (out of the first version)

Intentionally **excluded** from v1 to keep the MVP shippable and honest:

- **tmux / Fast-terminal native integration** (§10 items 2–3). The PTY transport is cross-platform and sufficient for Windows-first (§10); `attach to existing tmux` stays a future optional adapter behind `SignalTransport`.
- **Multi-OS-window UX.** v1 is one Between-owned window embedding two PTY regions (Decision); separate OS windows would require fragile SendInput/AutoHotkey automation (`I1`).
- **True merge/deploy *prevention* (sandboxing).** v1 ships **detective** control (refs watch) + recommended pre-push hook + withheld credentials. Between cannot intercept a full-shell agent's `git push` (`I9`); preventive sandboxing is deferred and the limitation is documented, not hidden.
- **Automatic rule promotion.** Always human-approved in v1 (§13); auto-promotion is permanently conservative by design.
- **Deep terminal output scraping.** The MVP only sends signals and shows broker state from files (§10: "The MVP does not need deep terminal scraping"); durable truth comes from `.between/`, never from parsing pane output.
- **More than two agents / non-Claude-non-Codex roles.** v1 fixes the developer/reviewer pair (§1).
- **Cross-machine / multi-host coordination.** Single-host, single-writer only (`I3`); distributed locking is out of scope.
- **`config.yaml` hot-reload.** Config is read and validated on `start`/`status`; live editing mid-run is deferred (re-validation only on command boundaries).
- **Rich analytics dashboards / charts.** v1 produces a Markdown `05-cycle-analysis.md` summary (§12); interactive visualization is deferred.

---

### Acceptance-criteria coverage map (§15 → milestone)

| §15 criterion | Milestone |
|---|---|
| §15.1 init creates state + Obsidian files | M3 (state) + M4 (vault) |
| §15.2 3-pane broker-dominant layout *(rewritten: PTY-backed, signalable — `I1`)* | M5 |
| §15.3 broker tracks phase/cycle/hash/actor | M3 (`--json`) + M5 (dashboard) |
| §15.4 diff detected within one interval | M2 |
| §15.5 reviewed only after debounce | M3 |
| §15.6 same hash no repeat | M2 (hash) + M3 (skip logic) |
| §15.7 reviewer feedback triggers developer signal | M6 |
| §15.8 events.jsonl records every transition | M1 (appender) + M3 (transitions) |
| §15.9 summarize produces readable analysis | M7 |
| §15.10 merge/deploy human-gated | M7 |
