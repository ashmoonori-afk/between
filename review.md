# Between Deep Review — Reconciled

Date: 2026-06-19
Scope: `main` worktree at `between/` after the embed + broker-hardening pass. This supersedes the
prior REQUEST-CHANGES review; each prior finding below is marked RESOLVED (with the change) or
TRACKED (intentionally deferred, with rationale).

Verdict: **Most blocking findings are resolved.** The broker now signals the developer, refuses
stale-diff approvals, can't stall on a missing verify, writes coordination files atomically, and the
oversized daemon is split. A few items remain TRACKED (crash-window resend, the cooperative trust
boundary, and an agent-death feedback channel) and are documented, not hidden. Still alpha — do not
run with untrusted agents on a repo where unapproved merge/deploy would be harmful.

## Resolved in this pass

| Prior | Finding | Resolution |
|---|---|---|
| P1 | Blocking review didn't signal the developer | `sendDeveloperSignal()` now fires on blocking findings before `applying_review`; `.between/signals/developer.json` is written and logged (`signal_sent` target=developer). Covered by `test/integration/developer-signal.test.ts` (incl. no-deadlock: the developer's next diff opens cycle 2 without an ack). |
| P1 | A changed live diff could be approved by an old review | `superseded()` recomputes the live diff hash at the top of `awaitAck`/`awaitReview`/`handleReviewWritten`; a changed worktree dispatches `diff_superseded → developing` (new FSM edges) so a stale review/verify can't advance (I14). |
| P1 | Clean review without passing verify could stall forever | `handleReviewWritten` now: clean+verify-failed/hash-mismatch → `verify_failed → developing`; clean+verify-missing → `review_timeout → human_gate` after the configured wait. No silent stall. |
| P2 | Command/signal files not atomic | `CommandBus.submit` and `FileTransport.send` use `write-file-atomic` (temp + rename); a reader can never observe a half-written command/signal. |
| P2 | Newer state schema refusal swallowed | `StateRepository.read` runs `migrate()` OUTSIDE the corrupt-file try/catch, so a newer-than-supported `state.json` propagates "upgrade Between" instead of silently downgrading. |
| P2 | Tracked `.between/` files could enter review hashes | `git` tracked diff / `--raw` / `--numstat` now apply `:(exclude).between/**` (P2-8 / I22). |
| P2 | `review-now` bypassed the cycle cap | `forceReview` now applies the same `isCycleCapReached` guard as the debounce path → `max_cycles_reached → human_gate`. |
| P3 | Oversized `src/daemon/loop.ts` (~561 LOC) | Split (behavior-preserving) into `loop.ts` (149, the `Daemon` class + single-writer persist/emit/dispatch + tick), `context.ts` (38, the `DaemonContext` seam), `phases.ts` (292, phase handlers), `commands.ts` (99, command handlers). All 85 tests stay green. |
| P3 | `developer_timeout_seconds` not enforced | Wired: `applying_review` with no new developer diff times out via `developer_timeout → human_gate`. Other unenforced knobs (merge/deploy booleans, rule promotion) are now labeled `reserved` in `config.yaml`. |
| P3 | Windows mojibake glyphs | `between doctor` falls back to ASCII markers (`[ok]/[!]/[x]`) on a non-TTY / `NO_COLOR` / `BETWEEN_ASCII` (P3-14). |
| P3 | Test gates green only on rerun | `vitest.config.ts` raises `hookTimeout`/`testTimeout` to 30s (cold-Windows git setup) and integration cleanup is best-effort to avoid transient EBUSY. |

New since the prior review: real-agent wiring — `between init --agent <fake|claude|codex>` writes the
matching wrapper + sets `agent_mode`/commands; `docs/AGENT-CONTRACT.md` documents the read/write
contract and the (confidence-noted) claude/codex commands.

## Tracked (intentionally deferred, documented)

- **P1 — `review_requested` resend after a crash between persist and send.** The cycle is persisted
  before the reviewer signal; a crash in that window leaves `review_requested` with no signal and a
  null `last_signal_at`. Not yet auto-resent on reload. Lower risk in practice (the next stable diff
  re-opens a cycle), but a crash-window resend + test is the right fix. **Tracked.**
- **P1 — `.between/` is a cooperative protocol, not a security boundary.** Any local process that can
  write `.between/` can forge ack/review/verify files or enqueue `approve`. This is now stated plainly
  in `docs/AGENT-CONTRACT.md`; a real boundary (withheld push creds, signed token outside `.between/`,
  pre-push hook) is future work. **Tracked / documented.**
- **P2 — hosted agent death is not a daemon event.** A persistent (pty) agent that dies is shown in the
  pane but does not dispatch `agent_died`. A host→daemon lifecycle channel is needed (and must not fire
  on normal per-invocation oneshot exits). **Tracked.**
- **P3 — `npm audit`** reports one low dev-only advisory (esbuild); `npm audit --omit=dev` is clean.

## Verification snapshot

- `npm run typecheck`: PASS · `npm run lint` (prettier): PASS · `npm run build`: PASS (target node22).
- `npm test`: PASS — **85 tests / 19 files** (added: developer-signal, agent-host, transport, agent
  pane, init-agent, config-agent, oneshot embed).
- Coverage on `src/core`: ~95% lines.
- Real CLI smoke: `between init --agent claude|codex` writes the wrapper + config; oneshot embed drives
  a real `fake-agent` to `human_gate`; blocking review writes `.between/signals/developer.json`.
- CI: GitHub Actions matrix (ubuntu/windows × node 22/24) green.
