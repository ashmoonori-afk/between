# Between — "IDE-grade" Evolution Plan

> Source of record for evolving Between from a well-architected alpha broker into a
> **Verifiable AI Change Control Plane** with IDE-grade UX. Derived from the 2026-06-19
> critical review (`.omo/evidence/critical-review-2026-06-19/final-review.md`) and the
> follow-up deep review. Each task is mapped to a review finding (P0-x / Hx), the files it
> touches, and an acceptance criterion.

## 0. Objective & Scope

**Objective.** Make every AI-produced change independently reviewed against an **immutable
review object**, gated by **policy + verification evidence**, and approved by a human **bound to
that exact evidence** — surfaced through an IDE-grade cockpit (TUI + VS Code).

**In scope.** Trust core (review immutability, approval freshness/scope, fail-closed IO,
fake-mode safety, real dev/reviewer agents, token policy), product core (worktree isolation,
policy engine, verification runner, evidence exporters, event store, cockpit, VS Code), and
differentiation (defect benchmark, reviewer routing, metrics, plugin SDK).

**Explicitly OUT of scope (per owner instruction): the chat gateway stays as-is.**
- No gateway code changes; `between gateway`, transports, and `GatewaySession` are frozen.
- Review finding **P0-1 (gateway has no sender allowlist; any DM-capable user can request
  `approve`, signed by the local secret) is therefore left OPEN.** See §7 Risks — this is a
  knowingly-accepted residual. The approval-core work in §3 (A2/A3) does **not** touch gateway
  code but does bind every approval (including gateway-issued ones) to the exact current bundle
  and cycle, which *reduces but does not remove* the P0-1 blast radius.

**Positioning shift.** From "AI pair-development terminal broker" → **"Verifiable AI Change
Control Plane"**: a local runtime that sits between the developer, the reviewer, and
VS Code/JetBrains/GitHub, and lets humans approve only exact, evidence-passing change bundles.

## 1. Target Architecture

### Ports (hexagonal; most exist informally today — formalize them)

```
WorktreeProvider     isolate developer / reviewer-readonly / verifier worktrees
ReviewObjectStore    create + read immutable, content-addressed review bundles
AgentRunner          run a role (developer|reviewer) with explicit capabilities
VerificationRunner   tests / lint / security / dependency audit -> structured results
PolicyEngine         evaluate policy-as-code -> gate decisions
ApprovalAuthority    issue/verify scope-specific, bundle-bound, expiring approvals
EventStore           tamper-evident, replayable cycle/event journal
EvidenceExporter     Markdown / Obsidian / GitHub Checks / SARIF / JSON / OpenTelemetry
```

### Target flow

```
Goal
  -> Isolated developer worktree
  -> Immutable evidence bundle  (tracked patch + raw mode/OID + untracked manifest + env)
  -> Independent reviewer worktree (read-only, built FROM the bundle)
  -> Verification + policy gates  (tests / lint / security / policy)
  -> Exact bundle-scoped human approval
  -> Export  (PR / merge / deploy / Checks / SARIF)
```

### Current → target mapping

| Today | Becomes |
|---|---|
| `adapters/git.ts` | `WorktreeProvider` + fail-closed diff/raw/untracked capture |
| `adapters/snapshot-store.ts` | `ReviewObjectStore` (immutable bundle, content-addressed) |
| `agents/real-agents.ts`, `adapters/*agent-host*` | `AgentRunner` with per-role capabilities |
| (none) | `VerificationRunner`, `PolicyEngine` |
| `core/approval.ts`, `adapters/approval-secret.ts` | `ApprovalAuthority` (scope+bundle+expiry) |
| `adapters/events-log.ts` | `EventStore` (checksummed journal / SQLite) |
| Obsidian writer (core path) | one `EvidenceExporter` among several |
| `ui/` (TUI) | code-centric cockpit + VS Code extension |
| `forge/*` (in core) | extracted to a plugin (§6) |
| `gateway/*` | **frozen, unchanged** |

## 2. Workstreams ↔ review findings

| WS | Review finding | Summary |
|---|---|---|
| Immutable Review Object | P0-4 | bundle = hashed object = what reviewer reads |
| Approval freshness/scope | P0-2, P0-3 | bind approval to bundle+cycle; separate scopes/gates |
| Fail-closed IO | H ("Git error → empty diff") | git/record errors become `review_object_invalid`, never "no change" |
| Fake-mode safety | P0-5 | simulation can never produce a signed approval |
| Real agents | H ("Claude+Codex not the default path") | distinct `--developer` / `--reviewer` presets, reviewer read-only |
| Token & config hygiene | H (env-vs-config, dead `binary_hash_max_bytes`) | secrets env/keychain only; remove/implement dead config |
| Worktree isolation | review §6.4 | reviewer read-only, no push creds to agents, network deny |
| Policy-as-code | review §6.3 | risk-routed gates as explicit decisions |
| Verification runner | review 15–45d | standard test/lint/security outputs into the bundle |
| Evidence + exporters | review §3 (Obsidian), §6.6 | Obsidian demoted to a port; add Checks/SARIF/JSON/OTel |
| Event store | review 15–45d | checksummed/replayable journal |
| Cockpit TUI | review §6.1 | inline diff↔finding, accept/dispute/waive, replay |
| VS Code extension | review §6.2 | findings in Problems API, approve-exact-bundle |
| Differentiation | review 46–90d | defect benchmark, reviewer routing, metrics, plugin SDK |
| Platform/release | H ("not publishable", "docs drift") | publishable package; CI-generated badges/metrics |

## 3. Phase A — Trust Core  (target ≈0–3 weeks)

> The review's "0–14 day" block, minus the gateway items. This is the foundation; nothing in
> Phase B/C is trustworthy until A is done.

- **A1 — Immutable Review Bundle (P0-4).**
  Build a content-addressed bundle per cycle: `{ schema_version, bundle_id: sha256, repository:
  {head_sha, branch, index_tree}, changes: {tracked.patch, tracked.raw (mode/OID), untracked
  manifest, submodules, lfs}, environment: {between_version, git_version, attributes_hash} }`.
  The reviewer reads a **read-only worktree built from the bundle**, not live `git diff HEAD`.
  Files: new `src/review/bundle.ts`, `adapters/git.ts` (raw+untracked capture), replace
  `snapshot-store` usage, update `docs/AGENT-CONTRACT.md`.
  **Acceptance:** the hash that is approved == the stored bundle == what the reviewer read
  (assert byte-for-byte in an integration test); reviewer never touches the live worktree.

- **A2 — Approval freshness + invalidation (P0-2).**
  Extend the approval claim to `{scope, diff_hash, cycle, bundle_hash, expires_at}`. `verify-push`
  must check `approval.scope==='merge' && approval.diff_hash===state.diff.hash &&
  approval.cycle===state.workflow.cycle && approval.bundle_hash===state.bundle.hash &&
  approval.expires_at>now`. The daemon **clears `state.approval`** on: new goal, diff-hash change,
  new cycle, verification change, reviewer-verdict change, branch/HEAD change.
  Files: `core/approval.ts`, `core/types.ts`, `cli/broker-commands.ts` (verify-push),
  `daemon/commands.ts`, `daemon/phases.ts`.
  **Acceptance:** an integration test where a valid cycle-N/hash-A approval is replayed after the
  diff becomes B fails the push gate; 0 stale-approval-valid cases.

- **A3 — Scope-separated approvals & gates (P0-3).**
  Split events into `merge_approved | deploy_approved | rule_promotion_approved |
  continue_requested | cancel_requested`, and gates into `review_gate | merge_gate | deploy_gate |
  rule_promotion_gate`. A `promote_rule` approval must not end a dev cycle as `done`.
  Files: `core/types.ts`, `core/fsm.ts`, `daemon/commands.ts`.
  **Acceptance:** FSM test proving each approval event only satisfies its own gate.

- **A4 — Fail-closed git & records.**
  `GitAdapter` checks exit codes on diff/raw/untracked; any git failure (or malformed
  review/verify record) → `review_object_invalid` → `error`/`human_gate`, **never** an empty diff
  treated as "no change". Files: `adapters/git.ts`, `daemon/records.ts`.
  **Acceptance:** fault-injection test (simulated non-zero git exit) lands in `error`, not a clean
  review; 0 git-fail-as-clean.

- **A5 — Fake-mode safety (P0-5).**
  In fake/simulation mode: render a persistent `SIMULATION` banner; forbid signed approvals;
  forbid pre-push approval creation; terminal state is `demo_complete` (not `done`); state JSON
  carries `evidence_trust: "simulated"`.
  Files: `agents/fake-agent.ts`, `daemon/*`, `ui/*`.
  **Acceptance:** fake run can never reach a signed approval or a real `done`.

- **A6 — Token & config hygiene.**
  Secrets: env var or OS keychain only; config may hold `${ENV_VAR}` references, never literal
  tokens — remove the literal-token fields from the schema/factory. Implement
  `binary_hash_max_bytes` in the diff path **or** delete it; add `between doctor --strict` to flag
  dead config and secrets-in-config.
  Files: `core/config-schema.ts`, `gateway/factory.ts` (read path only; no gateway behavior
  change), `adapters/git.ts`, `cli` doctor.
  **Acceptance:** `doctor --strict` fails on a literal token in config and on any unused key.

- **A7 — Distinct developer/reviewer agents.**
  `between init --developer claude --reviewer codex` (and a config block per role with
  `provider/model/capabilities`, reviewer `filesystem: read_only`). Add a conformance smoke that
  exercises the real wrapper contract.
  Files: `cli/setup-commands.ts`, `adapters/init-project.ts`, `agents/real-agents.ts`,
  `core/config-schema.ts`.
  **Acceptance:** developer and reviewer can be different providers; reviewer wrapper is launched
  read-only; conformance smoke passes for at least one real pair.

## 4. Phase B — Product Core  (target ≈3–7 weeks)

- **B1 — Worktree/sandbox isolation.** `.between/worktrees/{developer, reviewer-readonly,
  verifier}`; reviewer read-only; **no push credentials in agent env**; network default-deny;
  record an environment manifest per subprocess; changes move only as bundle/commit/tree objects.
  (`WorktreeProvider`.)
- **B2 — PolicyEngine (policy-as-code).** `version`, `risk.{level}.paths`, `gates` (tests /
  no_blocking_findings / secret_scan / dependency_audit), `approvals.{level}` (reviewer count,
  local-human-required), `agents.reviewer.{filesystem, network}`. Violations are explicit gate
  results, not warnings.
- **B3 — VerificationRunner.** Standard runners for tests/lint/security/dep-audit producing
  structured results that are folded into the bundle.
- **B4 — Evidence manifest + signing + EvidenceExporter.** Each cycle emits a signed manifest
  (agents/providers/models/versions, prompt/contract-version hash, findings, test/lint/security
  outputs, policy decisions, approval signature, elapsed time + cost, final commit/tree SHA).
  Exporters: GitHub Checks, PR review comments, SARIF, Markdown, **Obsidian (now one port)**,
  JSON, OpenTelemetry.
- **B5 — EventStore.** Replace/augment `events.jsonl` with a checksummed journal or SQLite for
  tamper-evidence and exact replay.
- **B6 — Code-centric cockpit TUI.** Inline diff ↔ finding linkage; filter by file/severity/agent;
  finding accept/dispute/waive; command palette; exact evidence-bundle display; test output +
  re-run; cycle replay; cost/token/time. (Keep current TUI's broker-dominant layout.)
- **B7 — VS Code extension (MVP).** Between panel next to Source Control; findings via Problems
  API; line annotations; actions: ask-developer-to-fix, request-second-review, open-evidence,
  **approve-exact-bundle**; reuse the existing local daemon. (JetBrains deferred.)

## 5. Phase C — Differentiation  (target ≈7–13 weeks)

- **C1** Seeded-defect benchmark; measure reviewer false-positive / false-negative rates.
- **C2** Risk-based multi-reviewer routing (correctness / security / test / API-compat / perf):
  low → 1 correctness; medium → correctness + tests; high → correctness + security + tests.
- **C3** Metrics dashboard: cycle cost / time / defect-detection rate.
- **C4** Plugin SDK; **re-launch Forge as the first official plugin** (extracted in §6).
- **C5** Team beta + RBAC.

## 6. Scope reductions (do early, in parallel with Phase A)

| Feature | Action | Why |
|---|---|---|
| **Gateway** | **Keep as-is, frozen (owner instruction)** | out of scope this plan; P0-1 residual noted in §7 |
| Forge (PWSForge in core) | Extract to a plugin/recipe behind the Plugin SDK (C4) | it's a PM methodology, not core differentiation; current gate only checks a status string + P0 flag |
| Obsidian | Demote to one `EvidenceExporter` port | must not narrow the user base or be a core dependency |
| PTY embedding | Keep as auxiliary observability only | nice-to-have; must never pollute the core state machine |
| Fake agent | Demo-only; cannot sign/approve (A5) | prevents mistaking a simulation for a real review |
| Auto rule promotion | Hold until labeled data exists | not enough signal to auto-harden rules |
| Deploy orchestration | Defer until merge/change-control is proven | sequence value correctly |

## 7. Success metrics (track these, not feature count)

- 100% of approved changes are bound to an exact evidence bundle.
- 0 cases where an approval stays valid after the diff/bundle changed.
- 0 cases where the reviewer read a live worktree instead of the bundle.
- 0 cases where a git failure or malformed record was treated as a clean review.
- 100% conformance pass for each supported real agent pair.
- 100% crash → same-cycle replay success.
- Seeded blocking-defect detection rate and false-positive rate published.
- < 5 minutes from install to first real review completed.

## 8. Decisions / risks  (locked 2026-06-20)

- **DECIDED — single local developer is the near-term target; team features later.** → VS Code
  MVP (B7) is prioritized; RBAC (C5) and any multi-user concerns are **future** work.
- **DECIDED — `claude` (developer) + `codex` (reviewer) is the default pair, but providers must be
  swappable/extensible.** A7 ships a **pluggable agent registry**: each role names a `provider`
  (claude | codex | … | custom command) so adding/changing a provider needs no core change.
- **DECIDED — npm publish IS a goal, and a future direction is packaging Between as a local
  desktop app.** → the **Platform/Release workstream runs alongside Phase A** (it no longer
  waits): `private:false`, provenance, SBOM, changelog, release CI, signed artifacts, platform
  smoke, real-agent compat matrix, and **CI-generated README badges/test counts** (kills doc
  drift). A future **Local-App workstream (D)** wraps the daemon + cockpit as a desktop app
  (e.g. Tauri/Electron) reusing the same ports — see §10.
- **RISK (accepted): gateway frozen ⇒ P0-1 remains open.** Anyone who can message the bot can
  request `approve`, signed by the local secret. A2 binds that approval to the exact bundle/cycle
  (smaller blast radius) but does not authenticate the sender. Because the confirmed target is
  **single-local** for now, this is acceptable near-term; revisit before any multi-user or exposed
  deployment (a local second-factor flag is the intended later mitigation, without changing
  gateway behavior for local use).
- **Open (deferred to B5):** SQLite vs append-only checksummed journal for the EventStore — pick
  based on the query/replay needs surfaced by the cockpit (B6).

## 9. Platform / Release workstream  (now parallel to Phase A)

- `package.json`: `private:false`, `bin`, `files`, `engines`, `exports`; publishable build.
- Release CI: tag → build → SBOM (CycloneDX) → npm provenance → signed artifact → GitHub Release.
- Platform smoke: install-from-pack on ubuntu/windows/macos; real-agent compat matrix.
- **Docs as CI output:** badges + test counts generated from the test run, not hand-edited.

## 10. Future — Local-App workstream (D)  (post-90-day; design now so ports fit)

- Wrap the daemon + cockpit as a desktop app (Tauri preferred for size; Electron fallback) that
  **reuses the exact ports in §1** — the app is just another front-end over `EventStore` /
  `ReviewObjectStore` / `ApprovalAuthority`, alongside the TUI and the VS Code extension.
- Constraint that shapes Phase A/B now: keep all core logic UI-agnostic and IPC-friendly (no
  console/TUI assumptions in `core`/`daemon`) so the desktop shell needs zero core changes.

## 11. Progress

**Phase A — Trust Core: COMPLETE ✅** (all committed, dogfooded, CI green)

- ✅ **A1** immutable, content-addressed review bundle; daemon seals one per cycle; reviewer reads
  the bundle, not the live worktree (`src/review/`, `.between/bundles/`).
- ✅ **A2** approval freshness + invalidation; the pre-push gate (.mjs + CLI) rejects a stale/expired
  approval; daemon clears approval on new goal/cycle/supersede. Dogfooded against the installed hook.
- ✅ **A3** scope-separated gate — only a `merge` approval completes the dev cycle.
- ✅ **A4** fail-closed git — a git failure becomes `error`, never an empty "no change" diff.
- ✅ **A5** fake-mode is a SIMULATION (`evidence_trust`), refused at the push gate; `status` marks it.
- ✅ **A6** `doctor --strict` flags bot tokens left in config.yaml (env-only policy).
- ✅ **A7** distinct `--developer` / `--reviewer` presets (claude dev + codex reviewer), swappable.

**Review findings (2026-06-20) — addressed ✅:** F1 approval HMAC now signs bundle_id + expires_at
(consistent across CLI/gateway/daemon/hook) · F2 push gate refuses non-merge approvals · F3
summary()/untracked() fail closed · F4 evidence command extracted · F5 evidence output ASCII-only.
Regression tests added (push-gate, fail-closed). Commits `2b77e02`, `ad1e429`.

**Phase B — in progress:**

- 🔶 **B1** worktree isolation — slices done: `WorktreeProvider` (isolated git worktrees) +
  `materializeBundle` (reviewer-readonly worktree reproducing the sealed bundle, `between
  review-worktree`). Remaining: stripped agent env (no secret/push creds) + network-deny +
  binary/untracked materialization + OS-level read-only.
- ✅ **B2** PolicyEngine — policy-as-code (`between policy`): risk-by-path, per-risk gates +
  approvals, gate violations as explicit results. Hardened per adversarial review (15 confirmed):
  fixed a `**​/` glob bug that let root-level secret files dodge high-risk, backslash/`./` bypass,
  ReDoS guard, gate-name enum (typo fails fast), git trackedRaw `--no-renames`.
- ⬜ **B3** VerificationRunner (also wires the secret_scan / dependency_audit gates) · **B5**
  EventStore · **B6** cockpit TUI · **B7** VS Code MVP. ✅ **B4** evidence manifest/exporters.
  (Deferred refinement: CLI command-handler integration tests — a systematic gap across commands.)

Plus the Platform/Release workstream (§9: publishable package, CI-generated badges/test counts).
