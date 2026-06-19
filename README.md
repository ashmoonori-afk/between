# Between — Docs Index

**Between** is a local terminal broker for AI pair development: it launches and observes a developer terminal (Claude), a reviewer terminal (Codex), and a broker dashboard, coordinating a `git diff`-driven review loop **without the agents ever talking directly**. Coordination flows through three durable surfaces — `git diff` (code truth), `.between/*.json` (machine state), and an Obsidian vault (human memory).

## Document hierarchy

Use `BETWEEN-BROKER-BLUEPRINT.md` as the original product concept and baseline. Use `DEVELOPMENT-PLAN.md` as the implementation source of truth for the Node.js + TypeScript build derived from that blueprint. Use `IMPROVEMENTS.md` as the critique backlog and rationale for the plan changes.

## Documents

| File | What it is |
|---|---|
| [`BETWEEN-BROKER-BLUEPRINT.md`](./BETWEEN-BROKER-BLUEPRINT.md) | The original product blueprint and concept baseline, referenced as §N. |
| [`IMPROVEMENTS.md`](./IMPROVEMENTS.md) | Prioritized critique: 26 findings (`I1`–`I26`) with problem, impact, and a concrete fix each. |
| [`DEVELOPMENT-PLAN.md`](./DEVELOPMENT-PLAN.md) | Implementation source of truth for the Node.js + TypeScript build plan (M0–M7), with architecture, schemas, testing/CI, and a §15 acceptance map. |

## Chosen stack

Node.js **>= 22.12 LTS** + TypeScript (strict). Key libs: `commander`, `zod`, `execa`, `node-pty` (optional), `Ink`, `chokidar`, `write-file-atomic`, `proper-lockfile`, `vitest`. Windows 10 1809+ floor (ConPTY); cross-platform PTY path, no WSL/tmux dependency.

> The plan originally targeted Node 20 LTS, but `ink@7` and `commander@15` require Node ≥ 22, and Node 20 reached end-of-life; the floor is therefore Node 22.12 LTS (the strictest locked dependency).

## The one finding that reshapes everything

**`I1` (critical):** `wt.exe` cannot inject keystrokes into a running pane from the CLI, yet `send_keys` (§10) is the transport every signal depends on. Between must therefore **own** the agent processes via a PTY (`node-pty`) and render them inside one Ink-hosted window — not drive Windows Terminal. This is de-risked in a throwaway **M0** spike before any feature work.

## Severity rollup (see IMPROVEMENTS.md)

- **Critical (7):** `I1` PTY transport · `I2` atomic/fsync writes · `I3` single-writer lock · `I4` persist `last_reviewed_hash` · `I5` deterministic diff-hash · `I6` real FSM (transitions/guards) · `I7` ack/delivery protocol.
- **High (13):** `I8`–`I20` (review-feed detection, honest merge/deploy gate, config schema, debounce persistence, state-fact deduplication, finding classification, TOCTOU, cross-machine hash stability, agent-death recovery, secret scrubbing, snapshot retention, missing `init`/headless-gate, no tests/CI).
- **Medium/Low (6):** `I21`–`I26`.

## Milestone roadmap (DAG)

```text
M0 spike+skeleton+CI → M1 durable state core → M2 deterministic hash+watcher
   → M3 FSM+debounce+cycle+ack (headless walking skeleton)
      → M4 Obsidian+snapshots ─┐
      → M5 PTY+dashboard ──────┴→ M6 close review loop → M7 analytics+human-gate+rules
```

## Open decisions to settle first (full list in IMPROVEMENTS.md → Open Decisions)

1. **One Between-owned window** embedding two PTY regions (recommended) vs three OS windows. *(Settle in M0 as ADR-0001 — decides the whole transport architecture.)*
2. **Do `claude`/`codex` support a one-shot / file-fed / stdin mode?** If yes, invoke per-signal and skip keystroke injection entirely. *(Verify empirically in the M0 spike.)*
3. **Obsidian vault outside the watched repo** (recommended) — else reviewer writes self-trigger the diff loop.
4. **Merge/deploy enforcement:** detective control (watch refs) + pre-push hook + withheld credentials — prompt rules are defense-in-depth only, not a guarantee.

## Immediate next action

Run the **M0 transport spike** (`node-pty` + one-shot-mode probe) and commit **ADR-0001**. Everything downstream depends on that answer.
