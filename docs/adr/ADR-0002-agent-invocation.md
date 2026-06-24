# ADR-0002: Agent invocation & terminal embedding

- **Status:** Accepted
- **Date:** 2026-06-19
- **Refs:** ADR-0001, blueprint §2/§9/§10/§11, IMPROVEMENTS.md I1/I7, docs/EMBED-PLAN.md

## Context

ADR-0001 made `SignalTransport` the seam and shipped a headless `FileTransport`. To actually
host live developer/reviewer agents in one Between-owned window we need (a) a way to invoke
the agent CLIs and (b) a way to render their output, without breaking the tested headless path
or requiring a native compiler on every host.

## Decisions

1. **Three agent modes, one stable port (`config.agent_mode`).**
   - `file` (DEFAULT): unchanged headless path — `FileTransport`, no hosts. Keeps every existing
     test and `config.yaml` valid (all new keys are `.default(...)`).
   - `oneshot` (recommended for `between start --embed`): per-signal `execa` spawn with the body
     on stdin (fire-and-forget, so a slow agent never blocks a tick). Zero native deps.
   - `pty`: a live ConPTY/forkpty terminal per agent via the OPTIONAL `@lydell/node-pty`
     (prebuilt binaries; verified loading on this Node 24 / win32-x64 host with no compiler).
     `PtyTransport` delivers the body as keystrokes.

2. **Ack provenance is unchanged.** Both new transports delegate `pollAck` to a composed
   `FileTransport`, so `reviewing` stays gated on a real `.between/acks/<id>.json` receipt (I7).
   The agent (real `claude`/`codex`, or the bundled `fake-agent.mjs`) writes the ack/review/verify
   files exactly as in the headless path. No new ack channel is invented.

3. **Graceful degrade.** `pty` → on `PtyUnavailableError` (no prebuilt binary) fall back to
   `oneshot` + pipe hosts. PTY loading is always lazy behind an indirect specifier so a missing or
   broken binary degrades, never crashes the daemon.

4. **Bundled demo agent.** `between init` writes `.between/agents/fake-agent.mjs` (stdlib-only). It
   mirrors `buildSignal`'s id format and the Ack/ReviewRecord/VerifyRecord shapes, so the whole
   embed is demoable on any host with zero native deps and no external CLIs.

5. **IDE topology and local profile are project-owned.** The IDE surface names existing roles as
   stable targets: `builder:n` maps to `developer_command`, and `reviewer:n` maps to
   `reviewer_command`. The counts are stored in project config as `builder_agent_count` and
   `reviewer_agent_count`. `ide_cli_rules_mode: project_only` isolates the IDE-launched local CLI
   profile from global agent rules, while `ide_cli_profile_dir: .between/ide-profile` keeps
   Codex-specific `CODEX_HOME` under the target repository. This is not a policy bypass:
   broker commands, approval signatures, sandbox/worktree boundaries, and `verify-push` still
   apply.

6. **Aside-inspired IDE control hints stay local.** The IDE profile also records
   `ide_permission_mode`, `ide_working_folder`, and `ide_followup_mode`. They are passed to
   IDE-launched agents as `BETWEEN_IDE_PERMISSION_MODE`, `BETWEEN_IDE_WORKING_FOLDER`, and
   `BETWEEN_IDE_FOLLOWUP_MODE`, but they do not grant access, self-approve work, or change the
   broker's policy/push/sandbox enforcement path.

## Real CLI invocation (recorded for when the real agents are wired)

The bundled fake-agent decouples the demo from the exact real-CLI flags. When wiring real agents,
set `developer_command` / `reviewer_command`, e.g. a non-interactive Claude Code invocation
(`claude -p` print mode reading the prompt from stdin) for `oneshot`, or a persistent session for
`pty`. The transport contract (deliver a short pointer; the agent reads git diff + `.between`
context itself and writes the ack/review files) is identical regardless of which CLI is used.

For IDE launches, `between ide --print-cli builder:n|reviewer:n` prints the exact target, command,
working directory, control-plane hints, and environment. Direct Codex commands and the generated
`.between/agents/codex-agent.mjs` wrapper receive `CODEX_HOME=<repo>/.between/ide-profile/codex`
so global Codex config is neither read nor mutated by the IDE profile.

## Consequences

- The headless product is untouched and fully tested; the embed is purely additive.
- `oneshot` is runnable on any host (CI included); `pty` is the optional, prebuilt-binary upgrade.
- 20 new tests cover the host ring/ANSI, transports' pollAck delegation, the agent pane, the new
  config keys, and a real one-shot invocation driving a cycle to `human_gate`.
