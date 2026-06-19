# Forge Phase 1 — Interview decisions

Resolved the Phase 0 P0 blockers (one-question-at-a-time interview, batched).

## Decisions

1. **Chat credentials: none yet → local `EchoTransport` first.** Build the gateway structure +
   contract/mock tests now with a creds-free in-memory transport; wire real Telegram/Discord
   tokens later via `.between/config.yaml` / env. Full dogfooding is possible without live creds.
2. **Gateway shape: native Node port.** Re-implement Birkin's warm-session + chat-gateway concept in
   TypeScript inside Between — one toolchain, CI-testable, simple distribution. (Birkin's
   prompt/session strategy is borrowed conceptually, not its Python code.)
3. **Forge scope: skill files + programmatic phases.** Keep the installed `.claude/skills/PWSForge`
   (agents use it) AND let Between's daemon/CLI drive the forge phase machine (intake → interview →
   … → release) programmatically, with new `between forge` commands and forge state.
4. **CLI-forced execution (P1, confirmed posture):** the gateway and forge phases perform work by
   spawning the `between` CLI and the agent CLIs; the broker daemon stays the single state writer.
5. **Onboarding (P1, confirmed posture):** `between init` / first run scaffolds the workspace and
   runs a gateway-setup step (pick channel, enter token, smoke-test).

## Locked phase order

| Phase | Deliverable | Creds needed | Testable here |
|---|---|:---:|:---:|
| 2 — Gateway core | `ChatTransport` port + `EchoTransport` + `GatewaySession` (chat ↔ broker) | no | ✅ |
| 3 — Telegram + Discord | both transports behind the port; live smoke deferred | optional | contract/mocked |
| 4 — Onboarding | `between init` workspace + gateway setup wizard | no | ✅ |
| 5 — Forge wiring | `between forge` phase machine, CLI-driven | no | ✅ |
| 6 — Dogfood + push | end-to-end run, all tests green, docs, push | no | ✅ |

## Exit gate (Phase 1)

- [x] All Phase-0 P0s resolved.
- [x] Gateway shape decided (native Node).
- [x] Transport-first plan that needs no credentials to verify.
