A prioritized critique of the Between broker blueprint (`BETWEEN-BROKER-BLUEPRINT.md`), produced against a chosen stack of **Node.js 20 LTS + TypeScript 5.x (strict)** and the §10 Windows-Terminal-first target. Each item names the blueprint section it touches (§N), why it blocks or degrades the build, and a concrete, buildable fix. Severities run **critical** (the loop cannot work or cannot recover) down to **low** (ergonomics). The adversarial pass has already been folded in: the ACK protocol moves into the walking-skeleton milestone, secret-scrubbing precedes the first snapshot write, the PTY-vs-one-shot decision is treated as a load-bearing fork rather than a committed bet, and acceptance criteria are restated as machine-checkable assertions.

## Summary Table

| ID | Title | Severity | §Ref |
|----|-------|----------|------|
| I1 | wt.exe cannot inject keystrokes — re-architect on a broker-owned PTY | critical | §10, §2, §15.2 |
| I2 | state.json / events.jsonl writes are not atomic/fsync'd/backed up | critical | §5, §3.9 |
| I3 | No single-writer rule — daemon + CLI commands corrupt shared state | critical | §5, §8, §14 |
| I4 | `last_reviewed_hash` is never persisted — dedup guarantee unimplementable | critical | §5, §3.7, §7, §14, §15.6 |
| I5 | Diff-hash spec has correctness bugs (order, staging, `--binary`, untracked) | critical | §8, §5, §3.7, §15.6 |
| I6 | Phase model is 14 names with zero transitions/guards/terminal semantics | critical | §6, §7, §4 |
| I7 | No acknowledgement/delivery protocol; multi-line §9 bodies can't be typed | critical | §9, §6, §3.6, §16, §15.7 |
| I8 | Review-feed change detection undefined; feed lives outside the watched repo | high | §6, §9, §15.7, §5 |
| I9 | Human-gated merge/deploy is prose-only — Between is an observer, not a sandbox | high | §3.8, §16, §15.10, §4, §14 |
| I10 | config.yaml has no unified schema or validation | high | §14, §7, §13, §5, §8 |
| I11 | Debounce/in-flight cycle state not persisted — unrecoverable mid-debounce | high | §3.9, §5, §8, §7 |
| I12 | phase / waiting_on / agent statuses are three unbound copies of one fact | high | §5, §11 |
| I13 | Blocking vs non-blocking classification has no schema/parser/authority | high | §16, §7, §12 |
| I14 | TOCTOU: stable hash at signal time ≠ stable tree at review time | high | §8, §7, §6 |
| I15 | Diff hash not stable across CRLF/locale/rename/git-config | high | §8, §3.9, §15.6 |
| I16 | No detection/recovery for agent death, hung CLI, or PTY EOF | high | §10, §16, §6, §7 |
| I17 | Full diff captured verbatim — secret-spreading surface with no scrubbing | high | §5, §8, §9 |
| I18 | No snapshot retention policy — `.between/snapshots/` grows unbounded | high | §5, §8, §14 |
| I19 | §18 has no `init` milestone and no headless-test gate before terminal work | high | §18, §14, §15.1, §10 |
| I20 | No testing strategy, TS structure, or CI defined for Between itself | high | §18, §15.4–§15.8, §10 |
| I21 | Undefined abnormal git states (rebase/merge/conflict, empty repo, errors) | medium | §5, §8, §6 |
| I22 | `.between/` not guaranteed gitignored — self-triggering review loop | medium | §8, §5, §14 |
| I23 | `schema_version` shipped as `1` with no migration or mismatch policy | medium | §5, §3.9 |
| I24 | 6s poll cannot guarantee 25s stability; fs-watch vs poll unexamined | medium | §8, §7, §15.4 |
| I25 | `--vault` unvalidated; `<project>` unsanitized (path-escape risk) | medium | §14, §5, §10 |
| I26 | CLI gaps: no headless/daemon distinction, no stop, no `--json`, no doctor | low | §14, §15.3 |

---

## Critical

### I1 — wt.exe cannot inject keystrokes; re-architect on a broker-owned PTY (node-pty), demote wt.exe to observer-only
**§10, §2, §15.2**

**Problem.** `send_keys(pane_id, text)` (§10) is the transport for every signal, but Windows Terminal exposes `sendInput` only as an in-app keybinding, not a CLI argument. The runtime the blueprint recommends first (§10: "1. Windows Terminal panes.") cannot satisfy the one interface the whole loop depends on. node-pty ownership and wt.exe display are mutually exclusive and §10 never picks one.

**Why it matters.** §15.2 ("`between start` opens three panes in the 2/1 broker-dominant layout") can pass visually — three panes shown — while the product is non-functional because no signal is deliverable. That is a false-green acceptance gate on the headline command.

**Recommendation.** Make Between the PTY host: each agent is one node-pty child (ConPTY on Windows 10 1809+, forkpty elsewhere); `send_keys` becomes `ptyProcess.write()`. Render the §2/§11 broker-dominant 3-region layout inside ONE Ink-hosted Between window that embeds the two agent PTY regions. Drop wt.exe as the agent transport. Add a "Process Ownership" subsection to §10. Run a week-1 spike that spawns `claude` via node-pty, writes a line, and confirms it is consumed *before* any state-model work. Rewrite §15.2 to require a writable PTY-backed region with verifiable signal receipt, not just a visible pane. Keep the spike continuous through M0 so a node-pty build failure surfaces on day 1, not at terminal-integration time.

**Source lens(es):** Terminal Orchestration Feasibility.

### I2 — state.json / events.jsonl writes are not atomic, fsync'd, or backed up
**§5, §3.9**

**Problem.** §5 promises state.json "must be valid JSON and recoverable after process restart." and §3.9 promises the system "should survive restart by loading `.between/state.json`." No write strategy is specified. The broker writes on every phase transition (14 phases) and every diff change (~6s).

**Why it matters.** A crash mid-write (Ctrl+C, OOM, power loss) leaving truncated/invalid JSON is a when-not-if event, and it lands exactly on the recoverability promise. `events.jsonl` (§5: "`.between/events.jsonl` is append-only.") has the same gap: a partial final line breaks the strict-JSONL analytics and recovery source. No last-known-good backup exists.

**Recommendation.** Mandate temp-file + fsync + atomic rename for every state.json write (write-file-atomic, Windows-EPERM retry aware); keep a `.bak` before each rename; on load fall back to `.bak`, then to events.jsonl reconstruction, before entering the error phase. Append events as single complete `\n`-terminated lines through one in-process queue with `O_APPEND` + fsync on transition-recording writes; make the reader skip/repair a trailing partial line. Add crash-injection tests (kill the process between writes) to §15. MVP-blocking; build in M1.

**Source lens(es):** State Model & Recoverability; Security, Data Integrity & Failure Modes.

### I3 — No single-writer rule; concurrent daemon + CLI commands corrupt shared state
**§5, §8, §14**

**Problem.** §14 CLI commands (`pause`, `resume`, `review-now`) mutate workflow state while the §8 poll loop writes every ~6s, and nothing prevents a second `between start`. Two state machines interleave writes.

**Why it matters.** Interleaved writers double-advance/rollback cycles, garble events.jsonl, and send duplicate review signals — directly violating §3.7 ("The same diff hash must not trigger duplicate review loops."). The exact crash scenario §3.9 must survive is left unguarded.

**Recommendation.** The `between start` daemon is the ONLY writer. Acquire an exclusive `.between/broker.lock` (proper-lockfile: pid + host + ts, `O_EXCL`, stale-lock reclaim on dead pid). CLI commands send a request the daemon consumes (a small command file or IPC) rather than editing state.json directly. Refuse a second daemon with a clear message naming the owning pid. Add an M1 integration test that fires a CLI command concurrently with a poll-tick write and asserts no corruption — the IPC path must be tested, not just asserted in prose.

**Source lens(es):** State Model & Recoverability; Security, Data Integrity & Failure Modes.

### I4 — `last_reviewed_hash` is never persisted; the central idempotency/dedup guarantee is unimplementable
**§5, §3.7, §7, §14, §15.6**

**Problem.** §7 cycle-start condition 3 ("The hash differs from the last reviewed hash.") and §15.6 ("The same diff hash does not trigger repeated reviews.") require comparing against the last *reviewed* hash. §14 gates `review-now` ("Forces a review request for the current diff hash, unless already reviewed."). But §5 stores only `diff.hash` and `diff.previous_hash`, and `previous_hash` is the last *detected* diff, not the last *reviewed* one.

**Why it matters.** The two diverge on revert/skip/force, and after restart the broker cannot honor `same_hash_review_policy: skip` (§7). The keystone field for the whole dedup guarantee is simply absent.

**Recommendation.** Add `workflow.last_reviewed_hash` plus a bounded `reviewed_hashes` ring (handles revert-to-prior-state), written atomically at the moment a review is committed. Define skip precisely: emit a review only if `current_hash != last_reviewed_hash` AND `current_hash` not in `reviewed_hashes`. State that `previous_hash` is observability-only and MUST NOT drive dedup. Give `review-now` a `--force` flag to bypass. Unit-test: detect X → review → detect X again → no signal.

**Source lens(es):** State Model & Recoverability; MVP Scope, Build Sequencing & DX; Coordination Protocol & Safety.

### I5 — Diff-hash spec has correctness bugs: undefined concat order, staging re-fires reviews, `--binary` inflates cost, untracked undefined
**§8, §5, §3.7, §15.6**

**Problem.** §8 lists three hash inputs (`git diff --binary`, `git diff --cached --binary`, `normalized untracked file metadata when enabled`) with no defined order or separator, so §3.7 dedup is not guaranteed. `git add` of unchanged content moves the payload from the unstaged stream to the cached stream, flipping the hash and starting a needless cycle unless both streams are always concatenated in a fixed order. `--binary` embeds full base85 blobs re-encoded every 6s, contradicting §5's intent ("Large binary files should be recorded in the state but excluded from direct review prompts."). Untracked files never appear in `git diff` (only `??` in porcelain), so §8's "normalized untracked file metadata" is undefined, and a metadata-only key silently misses same-size edits.

**Why it matters.** Each bug independently breaks the same-hash guardrail (§15.6) — either by spurious re-review (cost, token waste) or missed review (correctness hole).

**Recommendation.** Define a canonical wire format: `SHA256( 'UNSTAGED\0'+diff + '\0CACHED\0'+cachedDiff + '\0UNTRACKED\0'+untrackedBlob )`, all three sections always present (empty when absent). Hash unstaged+cached together so `git add` is hash-invariant. Do NOT use `--binary` for the hash: hash blob OIDs (`git hash-object`) for binary/large files above a configurable threshold; keep `--binary` only for the persisted snapshot. For untracked files passing the text/gitignore filter, hash `path + NUL + content OID` (exclude mtime/size-proxy). Pin under `schema_version`. Add a §15 test: staging without a content change does NOT start a cycle.

**Source lens(es):** Diff watching, hashing & concurrency; MVP Scope, Build Sequencing & DX.

### I6 — Phase model is a flat list of 14 names with zero transitions, guards, or terminal/recovery semantics
**§6, §7, §4**

**Problem.** §6 gives prose meanings but no `(from, event, guard, to, side-effect)` edges, so reachability and determinism cannot be verified. `error` and `paused` have no defined entry triggers or exits; `resume` has nowhere to return because `previous_phase` is not persisted. `review_timeout` (§7) has no target phase. `max_cycles` termination (§7 cycle-end 5) dead-ends with no designated phase.

**Why it matters.** A list of names is not a state machine; it cannot be implemented or tested for determinism. Multiple lenses independently flag this as the root unbuildable gap.

**Recommendation.** Add an explicit transition table; encode it as a pure FSM in `src/core` and unit-test every edge. Happy path: `goal_locked → developing → diff_detected → debouncing → review_requested → reviewing → review_written → applying_review → verifying → human_gate`. Branches: `verifying`-fail → `developing`; debounce hash-change self-loop; debounce-revert-to-`last_reviewed` → `developing` (abort, no cycle, log event); any phase + pause → `paused`; `paused` + resume → `previous_phase`; `review_timeout` → `human_gate` (not silent re-loop); repo merge/rebase/conflict → `repo_busy` holding state; agent PTY death → `error`/`human_gate`; `max_cycles_per_goal` reached → `human_gate` and STOP auto-starting cycles. Persist `previous_phase` and an `error{code,message,occurred_at,recoverable}` block. Mark `done`/`error` terminal-with-explicit-exits.

**Source lens(es):** State Model & Recoverability; MVP Scope, Build Sequencing & DX; Security, Data Integrity & Failure Modes; Coordination Protocol & Safety.

### I7 — No acknowledgement/delivery protocol; multi-line §9 signal bodies cannot be typed into a TUI
**§9, §6, §3.6, §16, §15.7**

**Problem.** The only transport is `send_keys`; signals assume the agent is at a ready input prompt (unverified) and that delivery succeeded (no ACK). The `reviewing` phase (§6) is entered because the broker *sent*, not because the reviewer *received*. §3.6 claims "Signals are short and idempotent." but no idempotency key exists. The §9 bodies are 6–9-line multi-line blocks whose embedded newlines would each prematurely submit the prompt.

**Why it matters.** A lost reviewer signal wastes up to `review_timeout_seconds: 900`; a lost developer signal has NO timeout and stalls forever. A restart/retry re-sends and double-reviews, violating §3.7.

**Recommendation.** Redefine §9 signals as FILE payloads: `send_keys` injects ONE line ("`Between: review requested for cycle N, diff <hash> — read .between/signal-reviewer.json`"); the full text lives in that file. Require each agent to write a tiny `.between/acks/<signal_id>.json` (plus the structured review/verify record) on receipt; treat a signal as delivered only after the ack appears, and gate the `reviewing` phase on the ACK, not the send. Add a symmetric `developer_timeout_seconds`. Embed `(cycle, diff_hash)` in every signal so re-sends are receiver-side no-ops. Add a pane-readiness precondition (prompt sentinel) before writing. Persist per-signal lifecycle `{target, cycle, diff_hash, sent_at, acked_at, completed_at}` for restart reconciliation. **Sequencing fix (per adversarial pass):** pull this ACK contract into the M3 walking skeleton over FileTransport so the FSM is never validated against an un-acked fire-and-forget stub; the M5/M6 PTY work only swaps the transport, not the protocol.

**Source lens(es):** Coordination Protocol & Safety; Terminal Orchestration Feasibility; State Model & Recoverability.

---

## High

### I8 — Review-feed change detection is undefined and the feed lives OUTSIDE the watched repo
**§6 (review_written), §9, §15.7, §5**

**Problem.** `review_written` is defined as "The review feed changed for the current cycle." (§6) and §15.7 fires the developer signal on it. But `02-review-feed.md` lives in the Obsidian vault — a separate tree that §5 explicitly allows to be messy ("Human-editable notes are allowed to be messy.") — while the only watcher (§8) polls `git diff` in the repo. The trigger mechanism is unspecified.

**Why it matters.** A naive mtime/content watcher fires on unrelated human edits, mid-write flushes, or stale prior-cycle reviews. There is no per-cycle freshness anchor and no debounce analogous to the diff debounce, so §15.7 is untestable and prone to false developer signals.

**Recommendation.** Have the reviewer write a machine record in the repo's `.between` tree: `.between/reviews/cycle-NNNN.json {cycle, diff_hash, findings:[{id,severity,summary,target_hash}], complete:true}`; treat `02-review-feed.md` as the human-readable mirror. Watch that sidecar (chokidar, debounced) and fire the developer signal only when `complete:true` AND `diff_hash == current reviewed hash`. Specify this in the §9 reviewer signal. Make §15.7 deterministic against the marker.

**Source lens(es):** Coordination Protocol & Safety; MVP Scope, Build Sequencing & DX; State Model & Recoverability.

### I9 — Human-gated merge/deploy is advertised as a guarantee but enforced only by prose
**§3.8, §16 (Hidden Agent Action), §15.10, §4, §14**

**Problem.** §16 enforces the prohibition via "Encode hard rules in project Obsidian notes and broker prompts." — advisory only. The developer pane is a full shell that can run `git push --force`, `gh pr merge`, or a deploy regardless of prompts, and Between only observes `git diff`, with no interception point and no detection of history rewrites. §14 has no `approve` command and `human_gate` has no approval-recording transition, so "explicit human action" (§16) is undefined in machine terms.

**Why it matters.** §3.8 and §15.10 ("Merge and deploy actions remain human-gated.") read as guarantees the architecture cannot keep — a trust hazard for users.

**Recommendation.** State the trust boundary honestly: observer, not sandbox; control is detective + defense-in-depth. Add `between approve <merge|deploy|promote-rule>` (§14) writing an approval token `{actor:human, scope, diff_hash}` to state.json; key the `human_gate` exit on that token. For real prevention recommend withholding push credentials from the agent env and/or a repo-local pre-push/pre-merge hook that checks for the approval token. Have the broker watch refs/branch/HEAD/remote (not just diff) and enter `error`/`human_gate` on any unapproved push or history rewrite.

**Source lens(es):** Coordination Protocol & Safety; Security, Data Integrity & Failure Modes.

### I10 — config.yaml has no unified schema or validation
**§14, §7, §13, §5, §8**

**Problem.** §14 creates `config.yaml` but never defines its schema. Keys live in two unrelated blocks (§7 watch/debounce/timeouts/gate, §13 rule-promotion) and several referenced toggles are unnamed: §5 untracked "when configured", §8 untracked metadata "when enabled", the binary size threshold, and the vault path.

**Why it matters.** An unschema'd config read at a system boundary is a defect per the project fail-fast rule; a typo'd key silently falls back to a default and the broker appears to work while ignoring user intent.

**Recommendation.** Define ONE zod-validated `config.yaml` schema as the single source of defaults: unify §7 + §13 keys plus `vault_path`, `review_untracked:bool`, `untracked_file_globs`, `binary_hash_max_bytes`, `snapshot_retention_cycles` / `snapshot_max_total_mb`, `developer_timeout_seconds`. Ship defaults in code, write a commented `config.yaml` on init, fail-fast with a precise message on unknown/invalid keys, and re-validate on every `start`/`status`. **Forward-declare every config key the later milestones (M4–M6) consume in this M1 schema** so no milestone introduces an unvalidated knob after the schema is frozen.

**Source lens(es):** MVP Scope, Build Sequencing & DX.

### I11 — Debounce/pending-hash and in-flight cycle state are not persisted
**§3.9, §5, §8, §7**

**Problem.** §8 starts a 25s timer on hash change; §3.9 promises reload recovery. But state.json persists none of the debounce machinery (candidate hash, first-seen time, restart count). Separately, §7 end-condition 1 ("Claude applies review feedback and creates a new stable diff.") is ALSO the start condition, yet the cycle-counter increment point is never specified.

**Why it matters.** A crash while debouncing leaves the broker unable to know what it was waiting on or whether the window elapsed. A crash at the cycle boundary can double-increment or skip; `max_cycles` has no field distinguishing a single cycle id from cycles-this-goal.

**Recommendation.** Add a debounce block `{candidate_hash, candidate_first_seen_at, debounce_restarts}`; on reload while `diff_detected`/`debouncing`, recompute the live hash and either proceed (≥ debounce window) or restart it. Define the cycle increment as a single atomic transition persisted BEFORE any signal is sent. Add `cycles_this_goal` distinct from the monotonic `cycle` id; `cycles_this_goal >= max_cycles_per_goal → human_gate`. Zero-pad snapshot filenames; keep the counter monotonic across pause/resume.

**Source lens(es):** State Model & Recoverability; MVP Scope, Build Sequencing & DX.

### I12 — phase, waiting_on, and per-agent statuses are three unbound copies of one fact
**§5, §11**

**Problem.** The §5 example encodes "who acts next" three ways — `workflow.phase`, `workflow.waiting_on`, and `developer`/`reviewer.status` — with no invariant or single source of truth. The §11 dashboard reads all three.

**Why it matters.** Any partial update (common after a crash mid-write) leaves them contradictory, so the loop can deadlock (both idle) or double-act (both signaled).

**Recommendation.** Declare `phase` the single source of truth; derive `waiting_on` and each agent status from `phase` via a documented mapping (compute on render, or persist + reconcile-on-load with a logged correction). Add a self-check assertion that fails fast on an invariant violation. State the mapping explicitly so tests can assert it.

**Source lens(es):** State Model & Recoverability.

### I13 — Blocking vs non-blocking finding classification has no schema/parser/authority
**§16, §7 (cycle-end 2), §12**

**Problem.** Loop termination depends on it: §7 cycle-end 2 ("Codex writes \"no blocking findings\" and verification passes.") and §16's infinite-loop guardrail both lean on the classification. Today the only sink is free-text Markdown, forcing a brittle string-match on "no blocking findings".

**Why it matters.** If the reviewer omits the exact phrase, the loop never terminates and falls back to `max_cycles` (itself defeatable by continued edits). Authority is undefined (can the developer downgrade a finding?).

**Recommendation.** Use the structured review record from I8: `findings:[{id, severity:'blocking'|'non-blocking', summary, target_hash}]`. Compute cycle-end 2 from `blocking-count == 0` AND a verification-pass record, not a magic string. Severity is reviewer-set and not developer-downgradable; a disputed finding routes to `human_gate`, not auto-close. Populate §12 metrics (`blocking_findings_per_cycle`, `verification_failures`) from these records.

**Source lens(es):** Coordination Protocol & Safety; MVP Scope, Build Sequencing & DX.

### I14 — TOCTOU race: a stable hash at signal time does not mean a stable tree when the reviewer reads
**§8, §7, §6 (reviewing)**

**Problem.** Between debounce-fire/signal and the reviewer actually running `git diff`, an editing developer can change the tree, so the reviewer reviews a diff that no longer matches the hash recorded as reviewed. Nothing pauses the developer during `reviewing`, so the §8 poll can start a new cycle for H′ while the in-flight review targets H.

**Why it matters.** The same-hash skip then marks a stale hash reviewed and the real current diff may never be reviewed — a silent correctness hole.

**Recommendation.** Make the immutable snapshot authoritative: write `.between/snapshots/cycle-NNNN.diff` at debounce-fire and have the reviewer review THAT file (already in state.json), not live `git diff`. Re-verify the live hash immediately before sending; abort + re-debounce on mismatch. Tag every review record with `target_hash` and discard/recompute reviews whose `target_hash != current reviewed hash`. The `diff_detected → new-cycle` transition explicitly cancels the outstanding reviewer signal for the superseded hash. Record `reviewed_hash` vs `current_hash` and surface drift on the dashboard.

**Source lens(es):** Diff watching, hashing & concurrency; Coordination Protocol & Safety.

### I15 — Diff hash is not stable across CRLF/autocrlf, locale, rename-detection, or git-config
**§8, §3.9, §15.6**

**Problem.** `git diff` output (hence the hash) depends on `core.autocrlf`, `.gitattributes`, `core.quotepath`, rename detection, locale, and Between version. A hash computed under one config differs after a config change or on another machine even when nothing changed.

**Why it matters.** That causes a spurious cycle on every restart or a missed review. The token-waste guardrail (§16) and §15.6 rest entirely on hash determinism, and Windows-first vs Linux/tmux makes divergence concrete.

**Recommendation.** Pin the hashing invocation: run git with `-c core.autocrlf=false -c core.quotepath=false --no-renames --no-color --no-ext-diff` and fixed `--src-prefix`/`--dst-prefix`, plus a stable `LC_ALL`/`TZ` for the subprocess. Store the pinned flag-set/version with the hash under `schema_version`; on a version/flag change, re-baseline explicitly and log it rather than silently cycling. Add a cross-OS CI test asserting an identical hash for an identical logical diff.

**Source lens(es):** Diff watching, hashing & concurrency; MVP Scope, Build Sequencing & DX.

### I16 — No detection/recovery for agent process death, hung CLI, or PTY EOF
**§10, §16, §6, §7**

**Problem.** The only liveness mechanism is `review_timeout_seconds: 900`, and even its target phase is undefined (I6). If a reviewer/developer pane crashes, hangs, or its PTY closes, the broker sits for 15 minutes (or forever on the developer side) showing a plausible-but-false "Waiting on X".

**Why it matters.** A dead agent is indistinguishable from a slow one, and this is only detectable if Between owns the PTY (reinforcing I1).

**Recommendation.** With broker-owned PTYs, attach `onExit`/`onData` handlers per agent. On unexpected exit → `phase=error`, record an event, offer `between resume` to respawn. Define a liveness timeout (no `onData` and no expected file write for `review_timeout_seconds`) → `human_gate`. Define the `review_timeout` target explicitly as `human_gate` (no silent re-loop, avoiding §3.7 duplicate signals). Surface "last ack age" / "unacked signal" on the §11 dashboard.

**Source lens(es):** Terminal Orchestration Feasibility; Security, Data Integrity & Failure Modes; Coordination Protocol & Safety.

### I17 — Full diff (incl. optional untracked files) is captured verbatim — a secret-spreading surface with no scrubbing
**§5, §8, §9**

**Problem.** §5 includes untracked files "when configured" and §8 hashes full `--binary` diffs. A developer's `.env`, `*.pem`, or private key entering the diff is written verbatim into `.between/snapshots/` (persisted indefinitely) and pulled into the Obsidian review feed — and Obsidian vaults are frequently synced to third-party cloud. §16 addresses only merge/deploy, never secret exposure.

**Why it matters.** Secrets leak into durable local files and potentially into cloud-synced notes, with no detection or redaction anywhere in the design.

**Recommendation.** Default untracked inclusion OFF (make §5's "when configured" explicitly opt-in) and always honor `.gitignore`. Add a secret-scrub pass before any diff is persisted or surfaced: skip a denylist (`.env*`, `*.pem`, `*.key`, `id_rsa`, `*.p12`, `credentials*`, `.npmrc`, `.netrc`) and redact high-entropy/known-token patterns, recording that a file was redacted instead of embedding it. Document that `snapshots/` and the vault may contain source/secrets and must be access-controlled. **Sequencing fix (per adversarial pass):** land the scrub pass in the same milestone that first writes a snapshot — never write an unscrubbed snapshot in an earlier milestone "to be cleaned later".

**Source lens(es):** Security, Data Integrity & Failure Modes.

### I18 — No snapshot retention policy; `.between/snapshots/` grows unbounded
**§5, §8, §14**

**Problem.** A full `--binary` snapshot is written every debounce-stable cycle with no pruning, max count, max size, or compression defined.

**Why it matters.** On binary-heavy repos this fills the disk, accumulates plaintext diffs (compounding I17), and a full disk makes the atomic state.json write fail — cascading into corruption (I2).

**Recommendation.** Add `snapshot_retention_cycles` (e.g. 50) and `snapshot_max_total_mb` (e.g. 200) to config; gzip snapshots (`.diff.gz`); prune oldest on each new snapshot and on start; exclude binaries from the persisted snapshot per §5's own intent; pre-check free space before writes.

**Source lens(es):** Security, Data Integrity & Failure Modes.

### I19 — §18 has no `between init` milestone and no headless-test gate before terminal work
**§18, §14, §15.1, §10**

**Problem.** §14/§15.1 make `init` the first user-runnable artifact, but §18 only lists library steps. §18 also interleaves terminal launch (step 7) into the control loop even though §10 says "The MVP does not need deep terminal scraping... The durable state should come from files, not terminal output parsing." — i.e., terminals are an output sink, not part of the loop.

**Why it matters.** Following §18 literally means discovering hashing/debounce/FSM bugs only after terminal integration, where they are hardest to isolate, and hitting the wt.exe dead-end (I1) at step 8 after most of the system is built.

**Recommendation.** Insert an explicit idempotent `between init` milestone (creates missing files only, validates config). Define the walking skeleton as the headless loop `edit → poll → hash → debounce → snapshot → cycle++ → event → status` behind a `SignalTransport` interface whose first impl is `FileTransport` (writes to `.between/signals.log`) and which already carries the I7 ACK contract. Gate that headless milestone behind passing unit + integration tests on the CI matrix BEFORE any `send_keys`/PTY code. Make the Windows-Terminal/PTY transport a swappable adapter behind the tested interface.

**Source lens(es):** MVP Scope, Build Sequencing & DX; Terminal Orchestration Feasibility.

### I20 — No testing strategy, TS project structure, or CI defined for Between itself
**§18, §15.4–§15.8, §10**

**Problem.** The blueprint is stack-agnostic and specifies zero tests, module boundaries, or CI. The pure core (hasher, debounce/FSM, events appender, config, analytics reducers) is fully deterministic and headless-testable, but without explicit seams the build risks a monolith mixing git shell-out, hashing, FSM, IO, and terminal control.

**Why it matters.** Diff-hash determinism — the foundation of the same-hash guardrail — silently diverges per-OS without a cross-OS CI test.

**Recommendation.** Adopt a hexagonal layout: `src/core/` (pure: FSM, diff-hash, debounce, cycle math, zod config, analytics reducers) 100% unit-tested with an injected `Clock`; `src/adapters/` (git via execa, fs state/events repositories behind interfaces, Obsidian writer, `SignalTransport` impls, PTY/terminal launchers); `src/cli/` (commander verbs); `src/daemon/` (poll loop composing core + adapters). Test pyramid with vitest: unit (golden-diff hashing asserting `.between/` + timestamps excluded; FSM via fake clock; JSONL crash-safety), integration (real git in tmp dirs asserting §15.4/§15.5/§15.6), manual E2E smoke for real terminals. GitHub Actions matrix (`windows-latest` + `ubuntu-latest`): `tsc --noEmit`, lint, vitest; green required before merge. **Add an explicit coverage gate (≥80% on the headless core) to CI, and a node-pty native-build check in the matrix** so a Windows ConPTY build break fails CI rather than at runtime.

**Source lens(es):** MVP Scope, Build Sequencing & DX.

---

## Medium

### I21 — Undefined abnormal git states (mid-rebase/merge/conflict, detached HEAD, empty repo, git errors)
**§5, §8, §6**

**Problem.** §8 assumes a clean branch. Mid-rebase/merge reports conflicted (`UU`) entries and conflict markers that would be hashed and shipped to the reviewer as a real review object; an empty repo changes `git diff --cached` semantics; a single non-zero git exit in the poll has no error branch.

**Why it matters.** The watcher ships non-buildable diffs to the reviewer, or a stray git error crashes the poll loop. The §6 state machine is partial, not total.

**Recommendation.** Before each poll, detect special states (presence of `MERGE_HEAD`, `rebase-merge/`, `rebase-apply/`, `CHERRY_PICK_HEAD`; `rev-parse -q --verify HEAD` for empty repo; porcelain `UU`). In those states enter a `repo_busy` holding substate and do NOT request review until clean. Catch any git error per-tick (log, skip the interval, keep the loop alive) rather than propagating. Document the detached-HEAD policy.

**Source lens(es):** Diff watching, hashing & concurrency; Security, Data Integrity & Failure Modes.

### I22 — `.between/` (and an in-repo vault) not guaranteed gitignored at the git level
**§8, §5, §14**

**Problem.** Between writes state/events/snapshots every tick. §8 says the hash "should exclude timestamps and broker-generated files under `.between/`." but the exclusion is described as post-hoc; if `.between/` is not gitignored, those writes appear in `git status`/`diff` and, combined with untracked-file inclusion (§5), change the hash. §14 `init` never writes `.gitignore`, and the exclusion list never names the vault.

**Why it matters.** Between's own writes re-trigger `diff_detected` → an infinite self-loop burning reviewer tokens.

**Recommendation.** Have `between init` add `.between/` (and any in-repo coordination/vault path) to `.gitignore` (create if absent) and verify on start. Compute the hash from an explicit pathspec exclusion (`git diff -- . ':(exclude).between/**'`), applied to the untracked path too, not post-hoc text filtering. Add a §15 test: Between's own file writes never advance the cycle.

**Source lens(es):** State Model & Recoverability; Coordination Protocol & Safety; Security, Data Integrity & Failure Modes.

### I23 — `schema_version` shipped as `1` with no migration or mismatch policy across in-place npm upgrades
**§5, §3.9**

**Problem.** Since Between is npm-distributed and upgraded in place mid-project, a binary will eventually load a state.json with a different `schema_version`. With no migration, an upgraded broker crashes on an unexpected shape or silently misreads fields.

**Why it matters.** It corrupts the very run it was meant to recover (§3.9). The same risk applies to `events.jsonl` format evolution.

**Recommendation.** On load, read `schema_version` first: if older, run an ordered migration chain (v1→v2→…) writing a `.bak` first; if newer than the binary supports, refuse to start with a clear "upgrade Between" message rather than partial-parsing. Every schema change bumps the version and ships a migrator. **Version the `events.jsonl` format too** (a header line or per-line `v`) so the JSONL reader does not silently misparse old records. Cover with a test loading a v1 fixture into a vN binary.

**Source lens(es):** State Model & Recoverability; Security, Data Integrity & Failure Modes.

### I24 — Debounce on a 6s poll cannot truly guarantee 25s of stability; fs-watch vs poll tradeoff unexamined
**§8, §7, §15.4**

**Problem.** The only observation points are 6s polls, so §8's "if hash is stable for 25 seconds" really means "equal across ~4–5 samples"; the off-by-one (4 vs 5 polls) is unstated, and sub-poll change/revert can be missed. §8 mandates polling without comparing to a debounced fs-watcher, and re-shelling git every 6s on a monorepo is not free.

**Why it matters.** The stated stability guarantee is weaker than it reads, and §15.4 ("A changed git diff is detected within one polling interval.") has no quantified latency.

**Recommendation.** State the real guarantee: review only after N consecutive equal polls spanning ≥ `debounce_seconds` (N = `ceil(25/6) = 5`), and make the off-by-one explicit in the §7 defaults. Use a debounced chokidar watcher (excluding `.git/` and `.between/`) as a cheap trigger for WHEN to run the expensive git-diff hash, with a slow safety poll (~30s) backstop. **Fall back to polling where recursive `fs.watch` is unsupported**, so the watcher path degrades rather than missing changes. Quantify expected detection latency for §15.4.

**Source lens(es):** Diff watching, hashing & concurrency.

### I25 — `--vault` path unvalidated; `'Creates or links'` ambiguous on Windows-first; `<project>` unsanitized
**§14, §5, §10**

**Problem.** §14 never validates that `--vault` exists, is writable, or is an Obsidian vault; "Creates or links" (§14) is undefined and symlinks on Windows need elevation/developer mode (the first target). `<project>` is derived from the repo name with no sanitization, so a name with separators or `..` could escape the `Projects/` subtree. state.json stores an absolute `obsidian_project_path` that goes stale if the vault moves.

**Why it matters.** A bad vault path silently writes to the wrong location, and an unsanitized project name is a path-escape risk.

**Recommendation.** Validate `--vault` at init (existing writable dir; warn/flag if no `.obsidian/`). Default to creating real directories (portable); make symlinking explicit opt-in with a Windows caveat. Slug-sanitize `<project>`, reject/escape separators and `..`, and assert the resolved path is contained within the vault root before any write. Store the vault root separately and re-derive `obsidian_project_path` on start.

**Source lens(es):** Security, Data Integrity & Failure Modes.

---

## Low

### I26 — CLI ergonomics gaps: no headless/daemon distinction, no stop, no `--json`, no doctor preflight
**§14, §15.3**

**Problem.** §14 `start` "Starts the 3-pane terminal workspace and broker watcher." with no headless mode (needed for integration tests and CI), no foreground/daemon distinction, and no `stop` (only `pause`/`resume` — how does the daemon terminate?). `status` has no machine-readable output for scripting, and there is no preflight to verify git/vault/terminal before a confusing mid-run failure.

**Why it matters.** These gaps block automated testing of the loop and leave the daemon with no clean exit, but they do not break the core loop — hence low severity.

**Recommendation.** Add `between start --headless` (watcher only, drives FileTransport, reused by integration tests), `between stop` (clean daemon terminate, distinct from pause), `--json` on `status` (+ `--watch` tail), `between doctor` (preflight: git present, inside a repo, vault writable, PTY runtime available), and `between review-now --force` (overrides the same-hash skip, per I4). Keep verbs noun-first and consistent. **Note (per adversarial pass):** `doctor`'s PTY-runtime check must degrade gracefully when run before the PTY adapter exists (report "not yet available") rather than hard-failing in the headless milestone.

**Source lens(es):** MVP Scope, Build Sequencing & DX.

---

## Open Decisions

These are settled-by-recommendation but require an explicit human sign-off (most are ADRs that gate the build):

1. **One window or three?** — *Recommendation:* one Between-owned window (Ink) embedding two node-pty agent regions + the dashboard. It is the only model where Between can both display the agents AND write signals to them; wt.exe cannot inject keystrokes into a running pane, and the multi-window alternative forces fragile OS-level UI automation. Decides the entire transport architecture — settle in week 1 as an ADR before any state work (ties to I1).
2. **Do `claude`/`codex` support a non-interactive / file-fed / one-shot mode?** — *Recommendation:* verify empirically in the week-1 spike; if yes, prefer per-signal one-shot invocation over a persistent REPL + keystroke injection. A one-shot mode bypasses the entire keystroke-injection and pane-readiness problem (I7). **Treat this as a fork, not a footnote:** the M0 spike must branch the transport design — keep the `SignalTransport` interface dual-implementable (FileTransport + either PTY-write or one-shot-spawn) until the answer lands.
3. **Vault inside or outside the watched repo?** — *Recommendation:* default OUTSIDE (separate `--vault` root); if inside, force it into `.gitignore` at init. Inside-and-unexcluded means reviewer writes to `02-review-feed.md` self-trigger the loop (I22).
4. **Exit transition on `review_timeout_seconds`?** — *Recommendation:* `human_gate` (surface a blocking banner; do not silently re-loop). Silent re-signal risks duplicate review loops violating §3.7; a silent stall hides a dead agent. Must be chosen before the FSM is built (I6, I16).
5. **When is `workflow.cycle` incremented, and is it monotonic across pause/resume?** — *Recommendation:* increment as a single atomic transition at the moment a new stable, never-reviewed snapshot is committed, persisted BEFORE any signal is sent; monotonic across resume from state.json. Add `cycles_this_goal` separate from the monotonic id (I11).
6. **How is merge/deploy actually enforced?** — *Recommendation (MVP):* detective control (broker watches refs/remotes → `error`/`human_gate` on unapproved push/rewrite) + a repo-local pre-push hook checking the approval token; document prompt rules as defense-in-depth only. Between is an observer, not a sandbox; advertising a prompt-only gate as a guarantee is a trust hazard (I9). Determines whether §15.10 is genuinely testable.
7. **Snapshot retention: whole-project or active-cycle?** — *Recommendation:* retain a bounded window (`snapshot_retention_cycles`, default ~50, gzipped) and prune the rest. Unbounded retention fills disk and accumulates plaintext secrets (I17, I18); a full disk breaks the atomic state write (I2).
8. **Untracked-file inclusion ON or OFF by default; honor `.gitignore`?** — *Recommendation:* OFF by default, opt-in, always honor `.gitignore` plus a secret denylist when enabled. Default-on sweeps in `.env`/keys/build artifacts (I17) and inflates hash cost (I5).
9. **Minimum supported Windows build; is WSL/tmux an acceptable dependency?** — *Recommendation:* require Windows 10 1809+ for node-pty/ConPTY; do NOT depend on WSL/tmux for the primary path (PTY injection is cross-platform); keep "attach to existing tmux" as an optional mode. Broker-owned PTY works on Windows and *nix uniformly (I1).
10. **Where do §7 and §13 YAML keys live — all in config.yaml, or split with state.json?** — *Recommendation:* all tunables in config.yaml (one zod schema); state.json holds only runtime state. A single validated source prevents silent misconfiguration (I10) and keeps the durable runtime contract free of user-editable knobs.

---

## Open Questions

These are genuinely unresolved and need information before a confident answer (do not guess):

- **One-shot CLI mode (Decision 2) is unverified.** Whether `claude`/`codex` can read a prompt from a file or stdin is the single biggest lever on the whole transport design, and the blueprint never checks it. Resolve empirically in the M0 spike before committing to PTY keystroke injection.
- **Pane-readiness detection is undefined.** Even with PTY ownership, knowing the agent is at a ready input prompt before a write (I7) likely needs a prompt sentinel or output pattern that has not been specified — does each CLI emit a stable, detectable ready marker?
- **Reviewer/developer cooperation is assumed, not enforced.** I7/I8/I13 require the agents to write ack/review/verify records on a fixed schema. There is no guarantee a general-purpose `claude`/`codex` session will reliably do so without a wrapper or system-prompt contract — what is the enforcement mechanism, and what happens when an agent silently doesn't comply?
- **`max_cycles` is defeatable by continued edits (I13).** If the developer keeps editing, each change is a new stable hash and a new cycle id; how should `cycles_this_goal` be bounded against an agent that never converges, beyond routing to `human_gate`?
- **Cross-machine hash portability scope (I15).** Is identical-hash-across-machines actually a requirement (shared/handoff workflows), or is per-machine determinism across restarts sufficient? The answer changes how aggressively the git invocation and environment must be pinned.