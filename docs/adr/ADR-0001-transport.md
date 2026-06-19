# ADR-0001: Signal transport — broker-owned PTY, abstracted behind `SignalTransport`

- **Status:** Accepted (provisional pending the M0 empirical spike)
- **Date:** 2026-06-19
- **Refs:** blueprint §9/§10, IMPROVEMENTS.md `I1`/`I7`, DEVELOPMENT-PLAN.md M0/M3/M5

## Context

Every signal in Between depends on a transport that can *deliver* a short message to the
developer/reviewer agent (§9). The blueprint recommended driving Windows Terminal panes
(§10), but `wt.exe` cannot inject keystrokes into a running pane from the CLI (`I1`) — so
WT can display agents but cannot signal them. The two viable mechanisms are:

1. **Broker-owned PTY** — Between spawns each agent CLI as a `node-pty` child and writes
   signals via `ptyProcess.write()`. The only mechanism that both shows and signals an agent.
2. **One-shot / file-fed invocation** — if `claude`/`codex` support a non-interactive mode
   (read a prompt from a file/stdin), Between invokes them per-signal, side-stepping
   keystroke injection and pane-readiness entirely (the cleaner option if available).

## Decision

- Define a **`SignalTransport` port** (`src/core/types.ts`) so the loop is transport-agnostic.
- Ship **`FileTransport`** (`src/adapters/signal-transport.ts`) as the default, fully-headless
  transport: it writes a signal pointer to `.between/signals/<target>.json` and reads acks
  from `.between/acks/<id>.json`. The whole review loop is built and tested on this (`I7`,
  reviewing is gated on a real ack).
- `node-pty` is an **optional dependency**, lazy-loaded. When absent (e.g. no native
  toolchain), Between runs headless with `FileTransport` and `doctor` reports the degrade.
- A future `PtyTransport` implements the same port. The **one-shot-vs-injection** choice
  (Decision D2) is settled by the M0 spike; either branch satisfies `SignalTransport`, so the
  daemon is unaffected.

## Consequences

- The headless product is correct and runnable with **zero native dependencies** — the
  highest-risk part of the blueprint (`I1`) cannot block the core.
- Real terminal embedding (one Between-owned Ink window hosting two PTY regions) is additive,
  not load-bearing, and lands in M5 on a host with a build toolchain.
- This ADR is provisional: the empirical one-shot-mode probe (D2) may change `PtyTransport`'s
  internals, but not the port or the loop.
