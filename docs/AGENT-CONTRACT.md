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

## Real CLI Invocation

Only the bundled `fake-agent` is verified end-to-end here. The real wrappers are templates; set the API key and smoke-test the flags for your CLI version before relying on them.

- Claude developer: Claude Code headless print mode, `claude -p --output-format text`, with `ANTHROPIC_API_KEY` set.
- Codex reviewer: non-interactive exec mode, `codex exec --ask-for-approval never "<contract prompt>"`, with `OPENAI_API_KEY` set.

`between init --agent claude|codex` writes `.between/agents/<cli>-agent.mjs`, feeds the contract prompt plus signal to the CLI, and lets the CLI's own file tools do the writing. Edit `developer_command` and `reviewer_command` in `config.yaml` to point at any compatible command.

## Trust Boundary

`.between/` is a cooperative local protocol, not a full security boundary. Any local process that can write `.between/` can write ack/review/verify files and enqueue an `approve` command. The broker therefore treats fake-agent projects as simulation evidence and refuses merge approval for them.

Human merge approval is signed with the env-only `BETWEEN_APPROVAL_SECRET`, which broker-spawned agents do not inherit. The installed pre-push hook re-verifies the signed claim against the current diff, cycle, bundle, expiry, and real-agent config.

Without the env secret, local unsigned approvals can move the demo workflow, but push verification remains blocked.
