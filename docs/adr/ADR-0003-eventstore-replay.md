# ADR-0003: EventStore Replay For Phase B

Status: Accepted

## Context

Phase B needs exact local replay for cockpit history and IDE state. The existing `events.jsonl`
journal is hash-chained and state pins the latest journal head, so it can detect entry edits,
middle deletion, and tail truncation when replay verifies against the pinned head.

## Decision

Defer SQLite for the MVP. Use the hash-chained append-only journal plus `replayStateFromEvents`
as the storage and replay path for B6 and B7.

The `between replay --verify` command reconstructs `BetweenState` from the journal and verifies
the chain against `state.json`'s pinned journal head before writing output.

## Consequences

- No new database dependency is introduced in Phase B.
- Replay remains portable and inspectable as JSONL.
- If later B6/B7 requirements need indexed queries, add a storage interface then; do not add
  SQLite before evidence proves the journal is insufficient.
