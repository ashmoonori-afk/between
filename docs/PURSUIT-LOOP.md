# Pursuit-Goal Loop (locked workflow)

An autonomous, self-continuing loop that drives `docs/IDE-PLAN.md` to completion without manual
"계속진행". General autonomous-agent loop shape (perceive → act → verify → commit → reschedule),
in the spirit of an oh-my-openagent-style pursuit loop. The loop is **fixed**: every iteration runs
exactly these steps, in order.

## Goal

Implement `docs/IDE-PLAN.md` (Phase B → Phase C → Platform/Release) end to end, TDD-first, one
task per iteration, with the gateway kept **frozen** (P0-1 is an accepted residual).

## One iteration (fixed steps)

1. **Perceive.** Read `docs/IDE-PLAN.md` §11 progress and pick the next unfinished task in order:
   Phase B (B1→B7) → Phase C (C1→C5) → Platform/Release (§9). If all are done, **stop** (omit the
   reschedule) and report completion.
2. **Plan.** State the task, the files it touches, and its acceptance criterion (from the plan).
3. **Act (TDD).** Write the test first, then the minimal implementation.
4. **Verify (hard gate).** `npm run format` → `lint` → `typecheck` → `test` must ALL pass. Fix
   until green; never weaken assertions to pass.
5. **Dogfood.** Exercise the new behavior live (CLI / real repo) where possible; capture evidence.
6. **Commit + push.** One commit per task (plain `-m`, no backticks, never `--no-verify`), push to
   `origin main`, and confirm **CI is green** before moving on.
7. **Record.** Update `docs/IDE-PLAN.md` §11 progress (mark the task ✅, note what's next).
8. **Reschedule.** `ScheduleWakeup` with the SAME pursuit prompt to run the next iteration.

## Invariants

- Gateway code is frozen (no changes to `src/gateway/**`).
- Secrets stay in env, never in commits (see memory: secrets-never-inline-in-commands).
- Hexagonal layering: pure `core/` (+ injected clock), IO in `adapters/`, thin `daemon/`/`ui/`.
- Every iteration leaves `main` green (lint/types/test + CI).
- If a task is too large for one iteration, split it and do the first safe slice; record the rest.

## Stop conditions

- All Phase B + C + Platform/Release tasks are complete → report and stop.
- A hard blocker that needs a human decision → stop, surface the decision, and wait.
