# Forge Phase 0 — Intake

Driven by the bundled **PWSForge** methodology (now installed at `.claude/skills/PWSForge/`),
which the broker treats as a builtin skill. Per the playbook: turn a vague build request into a
bounded setup, identify blockers, then run a one-question-at-a-time interview (Phase 1).

## The request (verbatim intent)

1. **Gateway.** Bring in Birkin's `gateway` (warm, persistent `claude`/agent process the user
   talks to). Add Hermes-agent's **Discord** connection so the user can choose **Telegram OR
   Discord**. On running Between and opening the first project, immediately run **initial
   workspace + gateway setup**; then continue real testing.
2. **Forge skill builtin + CLI-forced execution.** Install the uploaded **Forge** skill into the
   broker as a builtin (done in this phase). Force all execution/coding to go **through the CLI**.
3. **Process.** Split into phases + tasks, **git commit at every phase**, run **all real
   dogfooding tests**, then a final push.

## Known inputs

- **Product under build:** Between itself (this repo) — a Node 22+/TS broker, alpha, 99 tests green.
- **Platform:** local CLI + Ink TUI; cross-platform (win/mac/linux); CI on GH Actions.
- **Existing assets:** the Between repo + `.between/` runtime, the PWSForge skill (MIT), and two
  reference repos: `ashmoonori-afk/birkin` (Python gateway) and `NousResearch/hermes-agent` (Discord).
- **Approval boundary:** signed-approval trust boundary already in place (P1-5); merges stay human-gated.

## Blockers & decisions (severity per the playbook)

- **P0 — Chat credentials.** Real Telegram/Discord dogfounding needs a bot token (+ chat/guild id).
  Without one, only local/mock transport is verifiable. *Need: do you have token(s), or build the
  structure with a local "echo" transport + tests now and wire live creds later?*
- **P0 — Gateway shape.** Birkin's gateway is **Python**; Between is **Node/TS**. *Need: port the
  gateway into Between as a native Node module (in-repo, testable here), or shell out to Birkin's
  Python gateway as a sidecar?* (Recommendation: native Node port — keeps one toolchain + CI.)
- **P0 — "Forge builtin" scope.** *Done:* skill files shipped under `.claude/skills/PWSForge/` so any
  Claude/Codex agent in this repo has it. *Need to confirm:* is that the intended meaning, or should
  Between's daemon also *invoke* the forge phases programmatically?
- **P1 — CLI-forced execution.** Interpreted as: the gateway/agents perform work by **spawning the
  `between` CLI and the agent CLIs** (no hidden in-process side effects); the broker stays the single
  state writer. Confirm.
- **P1 — First-project onboarding.** A `between init`/first-run wizard that scaffolds the workspace
  **and** runs gateway setup (pick Telegram/Discord, enter token, smoke-test). Confirm UX.

## Phase plan (commit at every phase)

- **P0 Intake** *(this commit)* — install forge builtin, capture intent + blockers.
- **P1 Interview** — resolve the P0s above (one question at a time / batched).
- **P2 Gateway core** — a `Gateway` port: `ChatTransport` interface + `EchoTransport` (local, tested)
  + warm broker session bridge; zero external creds to test.
- **P3 Telegram + Discord transports** — implement both behind `ChatTransport`; live smoke when creds
  exist, mock/contract tests otherwise.
- **P4 Onboarding wizard** — `between init`/first-run: workspace scaffold + gateway setup + smoke.
- **P5 Forge phase wiring** — drive a real dogfood project through forge phases via the CLI.
- **P6 Dogfooding + final push** — end-to-end run, all tests green, README/docs, push.

## Exit gate (Phase 0)

- [x] App/problem area known (extend Between with a chat gateway + forge methodology).
- [x] Platform priority known (Node CLI/TUI, cross-platform).
- [x] Build depth known (working feature + dogfood, not just a doc).
- [x] Existing assets/repo status known.
- [x] Approval boundaries identified (signed approval already enforced).
- [ ] **Open P0s resolved in Phase 1** (credentials, gateway shape, forge scope).
