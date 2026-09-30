# Between - Agent Contract

How a real or fake agent participates in the Between loop. `between init --agent <fake|claude|codex>` wires the developer/reviewer commands and writes the matching wrapper into `.between/agents/`.

## What The Broker Gives An Agent

On each signal the broker invokes `developer_command` or `reviewer_command` with the role as the last arg and the signal body on stdin. The agent reads:

- `BETWEEN_ROOT/.between/signals/<role>.json`: the signal pointer `{id, target, cycle, diff_hash, body, created_at}`.
- `BETWEEN_ROOT/.between/state.json`: `workflow.cycle`, `diff.hash`, phase, bundle path, and current state.
- Reviewer only: the immutable review bundle at `state.diff.bundle_path`. Do not review live `git diff HEAD`; the working tree may have moved after the broker sealed the bundle.
- Developer only: live `git diff HEAD` plus the current reviewer feedback, then edit the working tree. Never merge or deploy.
- Project notes from the optional Obsidian vault.

`BETWEEN_ROOT` points at the target repo root. Reviewer processes may also receive `BETWEEN_REVIEW_WORKTREE`, a sealed materialization of the bundle, and should prefer it for read-only inspection while writing acks, reviews, and verify records back under `BETWEEN_ROOT/.between/`.

## What The Agent Must Write

Compute `id = role + "-" + String(cycle).padStart(4, "0") + "-" + diff_hash.slice(0, 12)`, matching `buildSignal`.

- Ack: `BETWEEN_ROOT/.between/acks/<id>.json`
  `{ "signal_id": id, "target": role, "cycle": <n>, "diff_hash": <hash>, "acked_at": <ISO> }`
- Reviewer review: `BETWEEN_ROOT/.between/reviews/cycle-<cycle4>.json`
  `{ "cycle": <n>, "diff_hash": <hash>, "findings": [{ "id", "severity": "blocking"|"non-blocking", "summary", "target_hash": <hash> }], "complete": true }`
- Reviewer verification: `BETWEEN_ROOT/.between/verify/cycle-<cycle4>.json`
  `{ "diff_hash": <hash>, "passed": <bool>, "summary": <string> }`
- Developer: apply accepted feedback to the working tree. Never merge or deploy; that stays behind `between approve`.

The broker validates these files and ignores records whose `diff_hash` is not the current cycle hash.

## Review Record Immutability

Write each review and verify record once. Until the broker accepts a record, the reviewer may still
rewrite it. When the broker accepts it, the record is sealed:

1. The file is made read-only (`chmod 0444`; on Windows this sets the read-only attribute).
2. Its sha256 is appended to the hash-chained journal as a `record_sealed` event
   `{ record: "review" | "verify", sha256, path, mac? }`, and the journal head is pinned in
   `state.json`. When `BETWEEN_APPROVAL_SECRET` is set, `mac` is an HMAC over the seal with that
   secret, which is env-only and stripped from agent environments.
3. Every later read (the daemon loop, the evidence manifest, approvals of every scope, the
   merge policy gate, `verify-push`, dashboards) re-hashes the file and refuses it when the bytes
   changed, the file was deleted, or it was replaced by a symlink, FIFO, or other non-regular file.
   The seal is only trusted from one journal snapshot whose chain and pinned head verify, and only
   entries inside the pinned range count: dropping the `record_sealed` entry does not unseal a
   record, and a well-chained forged seal appended after the pin is ignored.

A refused record is never consumed. What happens depends on the surface:

- Daemon phase loop: the cycle fails closed into `error` with code `record_tampered` (not
  recoverable).
- `between approve` (any scope): the daemon refuses the approval and journals `approval_rejected`.
- Finding actions: refused and journaled as `finding_action_rejected` with reason `record_tampered`.
- Evidence, `verify-push`, dashboards, MCP/API: the read throws; API callers get `integrity_error`.

### Threat model: what is and is not covered

The authority is the **running daemon**. It keeps the journal pin in memory, so while it runs, any
change to a sealed record, and any rewrite, truncation, or rollback of the on-disk journal, is caught
on the next read. That is the process that moves the cycle forward and grants approvals.

**Rolling back the on-disk journal and `state.json` together.** Both live in the same
developer-writable workspace as the records. A process with write access there can restore older
copies of `events.jsonl` and `state.json`, delete them, or rebuild the journal without its
`record_sealed` entries and re-pin `state.json` to match - and do it while the daemon is stopped, so
the files agree with each other.

**Journal anchor (first slice of an OS trust boundary).** Every journal append also records the new
head (`{hash, count}`) in a store outside the workspace:

| Platform | Store |
| --- | --- |
| macOS | login keychain, generic password, service `between-dev.journal-anchor`, account = hash of the project root |
| Linux | `$XDG_STATE_HOME/between/anchors/<id>.json` (default `~/.local/state/...`), mode 0600 |
| Windows | `%LOCALAPPDATA%\between\anchors\<id>.json` |

`BETWEEN_JOURNAL_ANCHOR=auto|keychain|file|off` picks the store (`auto`: keychain on macOS, file
elsewhere); `BETWEEN_ANCHOR_DIR` moves the file store. On broker start (`between start`), `between
journal --verify`, and `between replay --verify`, a journal that no longer contains the anchored
entry at its recorded position - rolled back, rebuilt, or deleted - fails closed with
`integrity_error` instead of being recovered from. A journal that grew past the anchor (a crash
between the append and the anchor write) is fine. After restoring `.between/` on purpose, a human
runs `between journal --reset-anchor` (CLI only, not exposed over MCP).

What this does and does not stop:

- It stops a writer that is confined to the workspace from rolling back or rewriting the journal
  up to the anchored entry: a sandboxed agent (for example Codex `workspace-write`), or a
  restore/copy of the repository directory. They cannot move the anchor. The chain hash is not
  keyed, so such a writer can still append well-formed entries *after* the anchored head while the
  broker is stopped; the anchor protects the recorded prefix, not future entries.
- It does **not** stop a process running unsandboxed as the same OS user: it can run
  `/usr/bin/security` or write the anchor file, and it can run `between journal --reset-anchor`.
  The anchor turns a silent file rollback into a deliberate out-of-workspace act, not an
  impossible one.
- If the store cannot be read (locked keychain, unreadable or corrupt anchor), Between warns once
  on stderr, runs without rollback detection rather than refusing to start, and does not write the
  anchor from that process, so the stored head is never replaced by an unchecked one.
  `between journal --verify` still prints VERIFIED for the chain but warns that the rollback check
  did not run (the API reports `anchor: "unavailable"`).

Follow-ups for a full OS boundary: run agents as a separate OS user that cannot write `.between/`
or the anchor store; restrict the keychain item's access list to a signed Between helper; sign
anchors with a key only the broker's OS user holds.

### What stops the developer agent from writing review records

| Layer | Enforced | Scope |
| --- | --- | --- |
| Journal seal + hash check on every read | Yes, all platforms | Detects any change to an accepted record and fails closed. It cannot stop a developer who rewrites a record *before* the broker accepts it, or one who rewrites/rolls back the on-disk journal and `state.json` together (see the threat model above). |
| Read-only file mode | Best effort | macOS/Linux: blocks a plain write by a non-root process, but the owner can `chmod` it back or rename over it. Windows: read-only attribute; same caveat. |
| Claude Code developer (generated wrapper, or `developer_command` that runs the `claude` CLI directly) | Yes, for Claude's tools | The wrapper passes `--disallowedTools "Edit(/.between/reviews/**)" "Edit(/.between/verify/**)"` (it always runs the developer from the repository root). A direct `claude` command gets absolute `Edit(//<root>/.between/...)` rules, merged into an existing `--disallowedTools` list if the command has one. This covers Claude's file tools and the Bash file commands/redirections Claude recognizes; it does not cover a script that opens the file itself. |
| Codex developer (`codex-agent.mjs developer`) | No | `codex exec` has no per-path write deny inside its workspace sandbox, so `.between/` stays writable. The journal seal is the only guard. |
| Any other developer command | No | Between cannot know the host's permission model. The journal seal is the only guard. |

Generated wrappers from earlier releases are replaced automatically (on `between init` and before
each agent launch) when their bytes still match a known generated version; customized wrappers are
left untouched and keep whatever flags they pass.

The contract prompt also tells developers never to touch `.between/reviews` or `.between/verify`, but
treat prompt text as a request rather than a control.

## Real CLI Invocation

Only the bundled `fake-agent` is verified end-to-end here. The real wrappers are templates; set the API key and smoke-test the flags for your CLI version before relying on them.

- Claude developer: Claude Code headless print mode, `claude -p --output-format text`, with `ANTHROPIC_API_KEY` set.
- Codex reviewer: non-interactive exec mode, `codex exec --ask-for-approval never "<contract prompt>"`, with `OPENAI_API_KEY` set.

`between init --agent claude|codex` writes `.between/agents/<cli>-agent.mjs`, feeds the contract prompt plus signal to the CLI, and lets the CLI's own file tools do the writing. Edit `developer_command` and `reviewer_command` in `config.yaml` to point at any compatible command.

## IDE-Local Invocation Profile

`between ide --print-cli <target>` prints the project-local invocation profile for `builder`,
`reviewer`, or a concrete target such as `builder:2` / `reviewer:1`.

The IDE profile sets:

- `BETWEEN_IDE=1`
- `BETWEEN_IDE_TARGET=<builder:n|reviewer:n>`
- `BETWEEN_IDE_RULES=<project_only|inherit_global>`
- `BETWEEN_IDE_PERMISSION_MODE=<read_only|guard|full_access>`
- `BETWEEN_IDE_WORKING_FOLDER=<project-local-relative-path>`
- `BETWEEN_IDE_FOLLOWUP_MODE=<steer|queue>`
- `BETWEEN_ROOT=<repo>`

For direct Codex commands and the generated `.between/agents/codex-agent.mjs` wrapper, the IDE
profile also sets `CODEX_HOME=<repo>/.between/ide-profile/codex`. This isolates IDE-launched
Codex processes from the user's global Codex home. The profile is local process environment only:
it must not write `~/.codex`, parent-workspace rules, global git config, or global npm config.

`ide_cli_rules_mode: project_only` means global agent-rule injection is bypassed for the
IDE-launched CLI profile. It does not bypass the Between broker, `.between/commands`, policy
evaluation, sandbox/worktree boundaries, signed approvals, `verify-push`, or evidence gates.

The Aside-inspired IDE controls are profile hints only:

- `ide_permission_mode` describes the intended local IDE task posture.
- `ide_working_folder` stays project-local and is passed to the agent as context.
- `ide_followup_mode` names whether the operator is steering the current run or queuing intent for
  a later run; it does not create a durable queue by itself.

These values must not grant filesystem, network, approval, push, or sandbox access beyond the
broker's existing policy and verification path.

## Trust Boundary

`.between/` is a cooperative local protocol, not a full security boundary. Any local process that can write `.between/` can write ack/review/verify files and enqueue an `approve` command. The broker therefore treats fake-agent projects as simulation evidence and refuses merge approval for them.

Human merge approval is signed with the env-only `BETWEEN_APPROVAL_SECRET`, which broker-spawned agents do not inherit. The installed pre-push hook re-verifies the signed claim against the current diff, cycle, bundle, expiry, and real-agent config.

Without the env secret, local unsigned approvals can move the demo workflow, but push verification remains blocked.
