# Between — Agent Contract

How a real (or fake) agent participates in the Between loop. `between init --agent <fake|claude|codex>`
wires the developer/reviewer commands and writes the matching wrapper into `.between/agents/`.

## What the broker gives an agent

On each signal the broker (oneshot/pty transports) invokes `developer_command` / `reviewer_command`
with the role as the last arg and the signal body on stdin. The agent reads, itself:

- `.between/signals/<role>.json` — the signal pointer (`{id, target, cycle, diff_hash, body, created_at}`).
- `.between/state.json` — `workflow.cycle`, `diff.hash`, phase, etc.
- `git diff HEAD` — the actual code under review (the broker also keeps a gzipped snapshot under `.between/snapshots/`).
- Project notes (optional Obsidian vault).

`BETWEEN_ROOT` env points at the target repo root.

## What the agent must write (exact shapes)

Compute `id = role + "-" + String(cycle).padStart(4,"0") + "-" + diff_hash.slice(0,12)` (same as `buildSignal`).

- **Ack** → `.between/acks/<id>.json`
  `{ "signal_id": id, "target": role, "cycle": <n>, "diff_hash": <hash>, "acked_at": <ISO> }`
- **Reviewer** also writes:
  - `.between/reviews/cycle-<cycle4>.json`
    `{ "cycle": <n>, "diff_hash": <hash>, "findings": [{ "id", "severity": "blocking"|"non-blocking", "summary", "target_hash": <hash> }], "complete": true }`
  - `.between/verify/cycle-<cycle4>.json`
    `{ "diff_hash": <hash>, "passed": <bool>, "summary": <string> }`
- **Developer** (on a blocking review): apply the accepted feedback to the working tree. **Never** merge or deploy —
  that stays behind `between approve`.

The broker validates every file with zod and ignores records whose `diff_hash` ≠ the current cycle's hash (TOCTOU guard).

## Real CLI invocation (confidence noted)

> Only the bundled `fake-agent` is verified end-to-end here. The wrappers below are templates; set the API key
> and smoke-test the flags for your CLI version before relying on them.

- **Claude (developer, per blueprint §1)** — Claude Code headless print mode (confidence: **HIGH**, code.claude.com/docs/headless):
  `echo "<contract prompt>" | claude -p --output-format text` with `ANTHROPIC_API_KEY` set. The agent needs file-write
  permission to write the ack/review files.
- **Codex (reviewer, per blueprint §1)** — non-interactive exec (confidence: **MEDIUM**; verify the JSON/output-schema
  flag for your version): `codex exec --ask-for-approval never "<contract prompt>"` with `OPENAI_API_KEY` set.

`between init --agent claude|codex` writes `.between/agents/<cli>-agent.mjs` which feeds the contract prompt + signal to
the CLI and lets the CLI's own file tools do the writing. Edit `developer_command` / `reviewer_command` in `config.yaml`
to point at any command you like (the blueprint pairing is developer = Claude, reviewer = Codex).

## Trust boundary (important — P1-5)

`.between/` is a **cooperative local protocol, not a security boundary.** Any local process that can write `.between/`
can write ack/review/verify files and enqueue an `approve` command. The "human gate" is a workflow convention, not an
enforcement mechanism. Do not run Between with untrusted agents on a repo where unapproved merge/deploy would be harmful.
A real boundary (withheld push credentials, a signed approval token outside `.between/`, or a pre-push hook) is future work.
