# Between Terminal Embedding — Implementation Plan

## Goal
One Between-owned Ink window that hosts the broker dashboard AND two live agent regions (developer=Claude, reviewer=Codex), per blueprint §2/§10/§11 and ADR-0001. Must degrade gracefully on a compiler-less host and offer a zero-native path. Must NOT break the 61 tests or the tested FileTransport/headless path, must reuse the ack/review file mechanism, and must keep the `SignalTransport` port stable.

## Key facts established from the codebase (not assumed)
- `@lydell/node-pty@^1.2.0-beta.12` is ALREADY in `optionalDependencies` and installed; its `@lydell/node-pty-win32-x64` prebuilt `conpty.node` was **smoke-tested and works on this exact host** (Node 24.13.0, win32-x64): it spawned `cmd.exe`, streamed ANSI, exited 0, no compiler. So PTY mode is demoable here, but is still treated as the OPTIONAL upgrade.
- `SignalTransport` (src/core/types.ts:252) = `{ kind; send(signal); pollAck(signalId) }`. `Daemon` consumes it abstractly via `DaemonDeps.transport` (loop.ts:41). `buildDaemon` hardcodes `new FileTransport(absRoot)` (runtime.ts:63).
- Acks are read only from `.between/acks/<signal_id>.json` via `parseAck` (validated). The daemon computes the expected reviewer signal id with `buildSignal('reviewer', cycle, hash, '', '').id` (loop.ts:326-330). `between ack` (cli.ts:172-192) already writes that exact id.
- `cli.ts` doctor already uses the indirect-specifier lazy-import probe (cli.ts:219-227) — but currently probes `'node-pty'`; switch to `'@lydell/node-pty'`.
- ConfigSchema is `.strict()` (config-schema.ts:44) so every new key MUST be `.default(...)`.
- Ink 7.1.0 + React 19 installed. Ink reconciles full frames; it is NOT a raw-ANSI passthrough surface, so panes must render a maintained, ANSI-stripped, bounded line tail.
- init copies config + state idempotently and maintains `.gitignore` `.between/` (init-project.ts).

## Design decisions
1. **Default `agent_mode='file'`** (today's headless path, zero risk, keeps tests green). `between start --embed` selects the recommended **`oneshot`** default; `pty` is the optional native upgrade.
2. **Three transports, one stable port.** Keep `FileTransport`. Add `OneShotTransport` (per-signal `execa` spawn, body on stdin) and `PtyTransport` (writes body to a live `AgentHost`). **Both delegate `pollAck` to a composed `FileTransport`** — no new ack channel; `reviewing` stays gated on a real receipt (I7).
3. **`AgentHost` port** hosts ONE agent process and streams output to a pane. Two impls: `PipeAgentHost` (zero native deps, execa) and `PtyAgentHost` (lazy `@lydell/node-pty`, typed `PtyUnavailableError` on absence). Output goes through a bounded ring with ANSI cursor/erase stripped (SGR color kept).
4. **Graceful degrade chain:** `pty` requested → try `PtyAgentHost.start()`; on `PtyUnavailableError` fall back to `PipeAgentHost` + `OneShotTransport`. `oneshot` → pipe hosts + one-shot transport. `file` → no hosts, FileTransport (unchanged).
5. **Ack provenance:** the agent (real, or the bundled `fake-agent.mjs`) writes the ack/review files, identical to headless today. Documented in ADR-0002.

## Phased implementation (TDD where the common rules apply)

### Phase 0 — ADR + config (no behavior change)
- Write `docs/adr/ADR-0002-agent-invocation.md` (default oneshot, lydell verified, pollAck delegation, ack provenance).
- Add the 6 defaulted keys to `ConfigSchema` and mirror them in `defaultConfigYaml()`.
- Tests: extend `config-schema.test.ts` to assert `parse({})` yields the new defaults and that an existing config.yaml (no new keys) still validates. Run full suite — 61 + new must pass.

### Phase 1 — AgentHost port + helpers (pure, unit-tested first)
- `src/adapters/agent-host.ts`: interface + `stripAnsi` + `makeRing`. RED: write `agent-host.test.ts` asserting (a) `stripAnsi` removes cursor/erase/OSC but KEEPS `ESC[..m`; (b) `makeRing` splits on `\r?\n`, collapses `\r` (progress-bar lines), bounds to capacity. GREEN: implement.

### Phase 2 — PipeAgentHost (zero native deps)
- `src/adapters/pipe-agent-host.ts` using `execa` (existing dep), `reject:false`, `stdin:'pipe'`, merge stdout+stderr into the ring; `snapshot/subscribe/stop`. `resize` is a no-op.
- Test with `fake-agent.mjs` under real spawn (small, fast): assert lines accumulate and `exitCode` is captured.

### Phase 3 — OneShotTransport + PtyTransport + pollAck delegation
- `src/adapters/pty-transport.ts`. `OneShotTransport.send` = `execa(file,args,{cwd,input:signal.body,reject:false})`. `PtyTransport.send` routes to the role's `AgentHost.deliver`. Both construct a private `FileTransport(root)` and `pollAck` delegates to it.
- Tests: a unit test asserting `OneShotTransport.pollAck(id)` returns exactly what `FileTransport.pollAck(id)` returns for the same ack file (delegation equality), and that `send` runs the command with the body on stdin (fake-agent writes the ack; assert the ack file appears with the daemon-expected id).

### Phase 4 — PtyAgentHost (optional native, lazy + graceful)
- `src/adapters/pty-agent-host.ts`: `loadPty()` tries `'@lydell/node-pty'` then `'node-pty'` via indirect specifier in try/catch; throw `PtyUnavailableError` if none load. Map `onData/onExit/write/resize/kill`.
- Test GATED on module availability (skip when `loadPty` rejects) so CI on a bare host doesn't fail. On THIS host it can run for real.

### Phase 5 — runtime override (surgical)
- `runtime.ts`: `buildDaemon(root, clock?, transport?)`; default `transport ?? new FileTransport(absRoot)`. No caller changes; existing tests untouched. Add a test that omitting `transport` still yields a FileTransport-backed daemon (snapshot of existing behavior).

### Phase 6 — UI: AgentPane + EmbeddedDashboard + start
- Extract the polling logic in `dash.tsx`'s `DashApp` into `useBrokerState(root, intervalMs)` in `EmbeddedDashboard.tsx` (reuse, don't duplicate the existing `<Dashboard>`).
- `src/ui/AgentPane.tsx`: subscribe to host, render last N (`agent_pane_visible_rows`) ring lines each as `<Text wrap="truncate-end">`; focus ring via `useFocus({id})` + `COLORS.focusRing`; live/exited status line. Placeholder when `host===null`.
- `src/ui/EmbeddedDashboard.tsx`: broker pane (reuse `<Dashboard>`) on top, two `<AgentPane>` below in a row; `useFocusManager` Tab cycling; `q` to quit.
- `src/ui/start.tsx`: `runStartEmbedded` — acquire `BrokerLock`; build transport+hosts from `agent_mode` with the pty→pipe degrade try/catch; `buildDaemon(root, clock, transport)`; `daemon.load()`; start `daemon.run()` concurrently with `render(<EmbeddedDashboard/>)`; on exit `daemon.requestStop()`, await the loop, stop hosts, release lock.
- Tests: `ink-testing-library` render of `AgentPane` with a fake AgentHost (snapshot of lines + focus border); render of `EmbeddedDashboard` with null hosts (placeholder) and with fake hosts (tails visible).

### Phase 7 — init + cli wiring
- `src/agents/fake-agent.mjs`: stdlib-only. Reads role from argv and `BETWEEN_ROOT` (default cwd). Oneshot mode: read stdin body, read `.between/state.json`, recompute `target-cycleNNNN-hash12` id, write `.between/acks/<id>.json`; for reviewer also write a clean `.between/reviews/cycle-NNNN.json`; print heartbeat lines to stdout. (Mirror `buildSignal` id format and `ReviewRecord`/`Ack` shapes EXACTLY — keep a comment pointing at the source-of-truth.)
- `init-project.ts`: add `agents` to `betweenSubdirs`, copy `fake-agent.mjs` into `.between/agents/` idempotently (resolve from the installed package dir; fall back to `src/agents` in dev).
- `cli.ts`: add `--embed` to `start`; when `--embed` OR `config.agent_mode!=='file'`, call `runStartEmbedded`, else `runStart`. Switch the doctor probe specifier to `'@lydell/node-pty'`.
- Tests: `init` test asserts `.between/agents/fake-agent.mjs` is created and re-init is idempotent.

### Phase 8 — review & verification (mandatory per CLAUDE.md §7)
- Full `npm test` (61 + new) green; `npm run typecheck`; `npm run lint`.
- Code review checklist: spaghetti (each new file <400 lines, single responsibility), consistency (transports honor the port; pollAck delegation proven), security (no secrets; agent-written ack/review still validated by zod; no `--omit=optional` in any script), plan progress.
- Manual demo per `demo_plan` STEP 0–5.

## Guardrails / non-negotiables
- Never add `@lydell/node-pty` to `dependencies`; never run install with `--omit=optional`/`--no-optional`.
- `core/` and the FSM are NOT touched. The `agent_died` FSM event stays unwired (out of scope; note as a future additive hook).
- `FileTransport`, the `SignalTransport` port shape, and the ack-file format are unchanged.
- Every new config key is `.default(...)` so `.strict()` parsing of existing config.yaml keeps working.
- PTY loading is always lazy + try/catch behind an indirect specifier so a missing/bad binary degrades, never crashes the daemon.

## Open questions to resolve during build (low risk)
- Real `claude`/`codex` exact one-shot invocation (stdin vs `-p`/`exec`) — `fake-agent.mjs` decouples the demo from this; ADR-0002 records the templates from the lens research for when the real CLIs are wired.
- Whether `between init` should copy fake-agent (chosen: yes, keeps config.yaml self-contained and the host demoable) vs reference an absolute package path.
- Pipe-backend color fidelity: set `FORCE_COLOR=1` in PipeAgentHost env so agents that detect a non-TTY still emit SGR the pane renders.