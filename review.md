# Between Deep Review - Wiring/UI Pass

Date: 2026-06-19
Scope: `main` worktree at `between/` after the broker wiring and TUI pass.

Verdict: **Approved locally with tracked alpha caveats.** The previous wiring blockers are closed:
missing or stale reviewer signals are repaired after restart, hosted PTY agent death is promoted to
daemon state, and the dashboard surfaces the resulting broker error plus dead agent status.

## Resolved In This Pass

| Prior | Finding | Resolution |
|---|---|---|
| P1 | `review_requested` could lose its reviewer signal after a crash window | `ensureReviewerSignal()` now runs inside `awaitAck()`, validates `.between/signals/reviewer.json` against the current cycle/hash id, and idempotently re-sends/stamps `review_requested` when the signal is missing or stale. |
| P2 | Hosted agent death stayed trapped inside the pane | `AgentHost.subscribeExit()` exposes process exits, `runStartEmbedded()` wires PTY exits to `Daemon.reportAgentDied()`, and the daemon persists recoverable `agent_died` errors with role/exit code while marking the role `dead`. |
| UI | Dead agent state was not visually distinct | `AgentPane` now renders failing hosted exits as `dead (exit N)` with the error token; `Dashboard` already renders `workflow.error`, so the broker panel and agent pane agree. |
| Design | No root TUI design contract | `DESIGN.md` now defines the compact 2/1 broker/agent terminal hierarchy, status language, token usage, and glyph fallback rules. |
| Slop | Edited daemon phase module exceeded the 250 pure LOC ceiling | Reviewer signal recovery and review/verify record IO were extracted into `src/daemon/reviewer-signal.ts` and `src/daemon/records.ts`; `src/daemon/phases.ts` now measures 224 pure LOC. |
| Race | Fast PTY exit could occur before start wiring subscribed | `BaseAgentHost.subscribeExit()` now replays an already-exited host to late subscribers, closing the start-time fast-exit race. |

## Still Tracked

- `.between/` is a cooperative local protocol, not a security boundary. Any local process with write access can forge ack/review/verify files or enqueue approval commands. Keep real merge/deploy authority outside `.between/`.
- Full `npm audit` reports one low dev-only `esbuild` advisory. `npm audit --omit=dev` is clean.
- Real Claude/Codex wrapper commands still need machine-specific smoke tests before relying on them for unattended work.
- This pass captured `dash --once` terminal output. A longer live PTY visual QA session with real agent CLIs is still future hardening.

## Evidence

Red-first evidence:

- `.omo/evidence/wiring-ui-ultrawork-2026-06-19/red-reviewer-signal-recovery.txt`
- `.omo/evidence/wiring-ui-ultrawork-2026-06-19/red-agent-death.txt`
- `.omo/evidence/wiring-ui-ultrawork-2026-06-19/red-host-exit-listener.txt`
- `.omo/evidence/wiring-ui-ultrawork-2026-06-19/red-agentpane-dead.txt`

Green and surface evidence:

- `.omo/evidence/wiring-ui-ultrawork-2026-06-19/green-reviewer-signal-recovery.txt`
- `.omo/evidence/wiring-ui-ultrawork-2026-06-19/green-agent-death.txt`
- `.omo/evidence/wiring-ui-ultrawork-2026-06-19/green-host-exit-listener.txt`
- `.omo/evidence/wiring-ui-ultrawork-2026-06-19/green-agentpane-dead.txt`
- `.omo/evidence/wiring-ui-ultrawork-2026-06-19/cli-resend-recovery.txt`
- `.omo/evidence/wiring-ui-ultrawork-2026-06-19/tui-agent-death.txt`
- `.omo/evidence/wiring-ui-ultrawork-2026-06-19/final-code-review.md`
- `.omo/evidence/wiring-ui-ultrawork-2026-06-19/green-late-exit-subscriber.txt`
- `.omo/evidence/wiring-ui-ultrawork-2026-06-19/green-stale-reviewer-signal.txt`

Verification snapshot:

- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `git diff --check`: PASS.
- `npm test`: PASS, 92 tests / 20 files.
- `npm run test:cov`: PASS, 94.53% line coverage across covered core files.
- `npm run build`: PASS, Node 22 target.
- `npm audit --omit=dev`: PASS.
- `npm audit`: FAIL by one low dev-only `esbuild` advisory.
