# Between Broker Agent Blueprint

## 1. Product Definition

Between is a local terminal broker for AI pair development. It launches and observes three terminals:

1. A developer terminal, usually Claude.
2. A reviewer terminal, usually Codex.
3. A larger Between broker terminal that shows system state, cycles, phases, diff status, and coordination logs.

The agents do not directly talk to each other. Between keeps the shared context in three durable surfaces:

1. `git diff` as the source of code truth.
2. `.between/*.json` as the source of machine-readable workflow truth.
3. An Obsidian vault as the source of human-readable project memory.

The broker sends only short signals into the developer and reviewer terminals. Long context is never pushed through terminal chat. Each agent reads the diff, JSON state, and Obsidian notes directly when it wakes up.

## 2. Core Experience

The user presses one button or runs one command:

```bash
between start
```

Between opens a 3-pane terminal workspace with a 2/1 visual hierarchy:

```text
+---------------------------------------------------------------+
|                                                               |
|                     BETWEEN BROKER                            |
|                                                               |
|  Project: repo-name                                           |
|  Phase: reviewing                                             |
|  Cycle: 7                                                     |
|  Diff: 14 files, +320 -91                                     |
|  Waiting on: Codex                                            |
|                                                               |
|  Timeline                                                     |
|  12:00:01 diff_detected                                       |
|  12:00:26 review_requested                                    |
|  12:01:14 review_written                                      |
|                                                               |
+-------------------------------+-------------------------------+
|                               |                               |
|       CLAUDE DEVELOPER        |        CODEX REVIEWER         |
|                               |                               |
|  Implements, tests, and       |  Reviews git diff against     |
|  applies review feedback.     |  goals, rules, and tests.     |
|                               |                               |
+-------------------------------+-------------------------------+
```

The broker pane is larger because it is the user's observability surface. The developer and reviewer panes are operational surfaces.

Recommended ratio:

```text
Top broker pane: 2/3 height
Bottom agent panes: 1/3 height, split 1/2 + 1/2 width
```

Alternative compact layout for narrow screens:

```text
Left broker pane: 1/2 width
Right side: Claude and Codex stacked vertically
```

The default should stay broker-dominant. The product is not just "two AI terminals"; it is an observable coordination runtime.

## 3. Design Principles

1. The agents never directly converse.
2. Between watches the repository, not the agents' private reasoning.
3. `git diff` is the review object.
4. JSON state is the broker's durable machine contract.
5. Obsidian is the user-facing memory and decision layer.
6. Signals are short and idempotent.
7. The same diff hash must not trigger duplicate review loops.
8. Merge, deploy, and permanent rule promotion require human approval by default.
9. The system should survive restart by loading `.between/state.json`.
10. Cycle and phase analysis are first-class product features, not logs as an afterthought.

## 4. Actors

### Human

- Gives the initial goal to the developer.
- Watches the broker terminal.
- Approves merge, deployment, and permanent rule promotion.
- Can pause, resume, or force a review cycle.

### Claude Developer

- Receives user goals.
- Implements changes.
- Runs tests.
- Reads reviewer feedback from the Obsidian review feed.
- Applies accepted fixes.

### Codex Reviewer

- Wakes only when Between requests review.
- Reads `git diff`, `.between/state.json`, project notes, and rules.
- Reviews the current diff against the goal and constraints.
- Writes findings to the Obsidian review feed.
- Does not edit product code by default.

### Between Broker

- Opens and manages the 3-pane workspace.
- Watches `git diff`.
- Debounces noisy in-progress edits.
- Computes diff hashes.
- Advances cycle and phase state.
- Sends short terminal signals.
- Updates JSON and Obsidian logs.
- Presents cycle/phase analytics.

## 5. Central Data Surfaces

### Git Diff

The current repository diff is the canonical code review input.

Between should inspect:

```bash
git status --porcelain
git diff --stat
git diff
git diff --cached
```

Default review scope:

1. Unstaged diff.
2. Staged diff.
3. New untracked text/code files when configured.

Large binary files should be recorded in the state but excluded from direct review prompts.

### JSON State

`.between/state.json` is the broker's durable state file. It must be valid JSON and recoverable after process restart.

Example:

```json
{
  "schema_version": 1,
  "project": {
    "name": "repo-name",
    "root": "C:/path/to/repo",
    "obsidian_project_path": "C:/path/to/vault/Between/Projects/repo-name"
  },
  "workflow": {
    "phase": "reviewing",
    "cycle": 7,
    "waiting_on": "reviewer",
    "started_at": "2026-06-19T12:00:00+09:00",
    "updated_at": "2026-06-19T12:01:14+09:00"
  },
  "diff": {
    "hash": "abc123",
    "previous_hash": "def456",
    "changed_files": 14,
    "insertions": 320,
    "deletions": 91,
    "snapshot_path": ".between/snapshots/cycle-0007.diff"
  },
  "developer": {
    "name": "claude",
    "terminal_id": "developer",
    "status": "waiting_for_review"
  },
  "reviewer": {
    "name": "codex",
    "terminal_id": "reviewer",
    "status": "reviewing_diff"
  },
  "broker": {
    "status": "stable",
    "last_signal": "review_requested",
    "last_signal_at": "2026-06-19T12:00:26+09:00"
  }
}
```

### Events Log

`.between/events.jsonl` is append-only.

Example event:

```json
{"ts":"2026-06-19T12:00:26+09:00","cycle":7,"phase":"review_requested","event":"signal_sent","target":"reviewer","diff_hash":"abc123"}
```

This file powers analytics and post-run summaries.

### Obsidian Vault

Recommended vault layout:

```text
ObsidianVault/
  Between/
    Global/
      coding-rules.md
      review-principles.md
      agent-protocol.md
      recurring-patterns.md
    Projects/
      repo-name/
        00-current.md
        01-goals.md
        02-review-feed.md
        03-decision-log.md
        04-design-rules.md
        05-cycle-analysis.md
        06-retrospectives.md
```

Project notes override global notes. The lookup order is:

1. `Between/Projects/<project>/04-design-rules.md`
2. `Between/Projects/<project>/01-goals.md`
3. `Between/Projects/<project>/02-review-feed.md`
4. `Between/Global/review-principles.md`
5. `Between/Global/coding-rules.md`

Obsidian is not the broker's only state store. Human-editable notes are allowed to be messy. Machine-critical state belongs in JSON.

## 6. Phase Model

Between should use a small explicit phase model.

```text
idle
goal_locked
developing
diff_detected
debouncing
review_requested
reviewing
review_written
applying_review
verifying
human_gate
done
paused
error
```

### Phase Meanings

`idle`
: No active task.

`goal_locked`
: The user goal has been captured in Obsidian and state JSON.

`developing`
: The developer is expected to work.

`diff_detected`
: Git diff changed since the last stable hash.

`debouncing`
: Between is waiting for the diff to stop changing.

`review_requested`
: Between has sent a review signal to Codex.

`reviewing`
: Codex is expected to review the current diff.

`review_written`
: The review feed changed for the current cycle.

`applying_review`
: Claude is expected to apply or respond to review feedback.

`verifying`
: Tests or checks are expected to run.

`human_gate`
: The machine loop is complete and the user must approve the next action.

`done`
: The task is complete.

`paused`
: Human or broker paused the loop.

`error`
: The broker cannot safely continue.

## 7. Cycle Model

A cycle is one developer-review-feedback loop around one stable diff snapshot.

Cycle starts when:

1. The diff hash changes.
2. The new diff remains stable through the debounce window.
3. The hash differs from the last reviewed hash.

Cycle ends when one of these happens:

1. Claude applies review feedback and creates a new stable diff.
2. Codex writes "no blocking findings" and verification passes.
3. The broker enters `human_gate`.
4. The user pauses or cancels.
5. The max cycle limit is reached.

Recommended defaults:

```yaml
watch_interval_seconds: 6
diff_debounce_seconds: 25
max_cycles_per_goal: 8
review_timeout_seconds: 900
same_hash_review_policy: skip
human_gate_required_for_merge: true
human_gate_required_for_deploy: true
```

## 8. Diff Watcher

The broker should poll `git diff` instead of asking Codex to watch git continuously.

Pseudo-flow:

```text
every 6 seconds:
  read git status and diff summary
  compute diff hash
  if hash changed:
    phase = diff_detected
    start debounce timer

during debounce:
  if hash changes again:
    restart timer
  if hash is stable for 25 seconds:
    create snapshot
    start or update cycle
    signal reviewer
```

Diff hash input should include:

```text
git diff --binary
git diff --cached --binary
normalized untracked file metadata when enabled
```

The hash should exclude timestamps and broker-generated files under `.between/`.

## 9. Signal Protocol

Signals should be short. The receiving agent is responsible for reading the actual context.

### To Reviewer

```text
Between signal: review requested.

Read:
- git diff
- .between/state.json
- Obsidian Between project notes

Write findings to:
- Obsidian Between/Projects/<project>/02-review-feed.md

Do not edit code unless explicitly instructed.
```

### To Developer

```text
Between signal: review updated.

Read:
- Obsidian Between/Projects/<project>/02-review-feed.md
- .between/state.json
- git diff

Apply accepted feedback, run verification, and leave merge/deploy to the human.
```

### To Human

```text
Between status: human gate reached.

Review:
- current diff
- latest review feed
- cycle analysis

Approve merge, request another cycle, or pause.
```

## 10. Terminal Orchestration

The first implementation can target one terminal runtime, then generalize.

Recommended order:

1. Windows Terminal panes.
2. tmux for cross-platform sessions.
3. Fast terminal native integration, if available.

The broker should abstract panes behind a small interface:

```text
create_session(layout)
send_keys(pane_id, text)
focus_pane(pane_id)
read_recent_output(pane_id)
close_session()
```

The MVP does not need deep terminal scraping. It only needs to send signals and show broker state. The durable state should come from files, not terminal output parsing.

## 11. Broker Dashboard

The broker pane should show:

```text
BETWEEN

Project: repo-name
Phase: reviewing
Cycle: 7 / 8
Waiting on: Codex

Diff
Hash: abc123
Files: 14
Insertions: 320
Deletions: 91
Snapshot: .between/snapshots/cycle-0007.diff

Agents
Claude: waiting_for_review
Codex: reviewing_diff

Current Timers
Phase age: 00:01:12
Cycle age: 00:04:38
Last diff change: 00:00:31 ago

Recent Events
12:00:01 diff_detected
12:00:26 review_requested
12:01:14 review_written
```

The dashboard should prioritize:

1. What phase are we in?
2. Which actor is expected to act?
3. How long has it been stuck?
4. What diff is being reviewed?
5. What happened in this cycle?

## 12. Analytics

Between should analyze phase and cycle history from `events.jsonl`.

Useful metrics:

```text
cycle_count
average_cycle_duration
phase_duration_by_cycle
time_waiting_on_developer
time_waiting_on_reviewer
time_waiting_on_human
review_findings_per_cycle
blocking_findings_per_cycle
repeated_findings
verification_failures
same_hash_skips
max_cycle_hits
```

Obsidian summary target:

```text
Between/Projects/<project>/05-cycle-analysis.md
```

Example summary:

```markdown
# Cycle Analysis

## Current Goal

Ship broker MVP with 3-pane terminal layout and diff-driven review loop.

## Cycle 7

- Phase path: developing -> diff_detected -> debouncing -> review_requested -> reviewing
- Duration: 4m 38s
- Diff: 14 files, +320 -91
- Waiting on: Codex
- Risk: review timeout in 10m

## Repeated Patterns

- Tests are often added after implementation instead of before review.
- Review feedback repeats around unclear phase transitions.
```

## 13. Self-Improvement Loop

Between should support periodic rule promotion, but it should be conservative.

Flow:

```text
review feed history
  -> repeated finding detection
  -> proposed rule in 06-retrospectives.md
  -> human approval
  -> project design rule update
```

Default policy:

```yaml
auto_propose_rules: true
auto_promote_rules: false
promotion_requires_human: true
```

This prevents accidental hardening of one-off reviewer preferences into permanent project rules.

## 14. MVP Commands

```bash
between init --vault "C:/Users/lg/ObsidianVault"
between start
between status
between pause
between resume
between review-now
between summarize
```

### `between init`

Creates:

```text
.between/
  config.yaml
  state.json
  events.jsonl
  cycles/
  snapshots/
```

Creates or links:

```text
ObsidianVault/Between/Projects/<project>/
```

### `between start`

Starts the 3-pane terminal workspace and broker watcher.

### `between status`

Prints the current phase, cycle, waiting actor, diff hash, and latest event.

### `between review-now`

Forces a review request for the current diff hash, unless already reviewed.

### `between summarize`

Generates or updates `05-cycle-analysis.md`.

## 15. MVP Acceptance Criteria

The first version is good enough when:

1. `between init` creates all state and Obsidian files.
2. `between start` opens three panes in the 2/1 broker-dominant layout.
3. The broker pane visibly tracks phase, cycle, diff hash, and waiting actor.
4. A changed git diff is detected within one polling interval.
5. The diff is reviewed only after the debounce window.
6. The same diff hash does not trigger repeated reviews.
7. Reviewer feedback written to Obsidian triggers a developer signal.
8. `events.jsonl` records every phase transition.
9. `between summarize` produces readable cycle analysis.
10. Merge and deploy actions remain human-gated.

## 16. Risks And Guardrails

### Infinite Review Loop

Risk:
: Claude and Codex keep cycling on preference-level feedback.

Guardrail:
: Set `max_cycles_per_goal`, require human gate after repeated cycles, and classify findings as blocking or non-blocking.

### State Drift

Risk:
: Obsidian notes, JSON state, and git diff disagree.

Guardrail:
: Treat git diff and JSON as authoritative for machine state. Treat Obsidian as human-readable memory.

### Terminal Fragility

Risk:
: Sending text to CLI panes is less reliable than API calls.

Guardrail:
: Keep signals short, idempotent, and recoverable from files.

### Token Waste

Risk:
: Reviewer repeatedly reads the same diff.

Guardrail:
: Hash every review object and skip already reviewed hashes by default.

### Hidden Agent Action

Risk:
: Agents merge, deploy, or rewrite history without human approval.

Guardrail:
: Encode hard rules in project Obsidian notes and broker prompts. The broker should never signal merge or deploy without explicit human action.

## 17. Why This Is Better Than A Simple Broker

A simple broker only passes messages between developer and reviewer. Between adds observability and recoverability.

The key improvements are:

1. The broker has a larger visible control surface.
2. JSON makes the workflow restartable and machine-readable.
3. Obsidian makes project memory inspectable by humans.
4. Cycle and phase analytics show where collaboration is slow or stuck.
5. Diff hashing prevents duplicate review work.
6. Human gates keep ownership clear.

Between should not try to become a smarter AI than Claude or Codex. Its value is making their collaboration visible, stable, and auditable.

## 18. Recommended Build Order

1. Create the `.between` state model and config.
2. Implement diff hashing and debounce.
3. Write append-only `events.jsonl`.
4. Generate Obsidian project files.
5. Build `between status`.
6. Build the broker dashboard loop.
7. Add 3-pane terminal launch.
8. Add reviewer signal.
9. Add review-feed watcher and developer signal.
10. Add cycle analytics and summaries.
11. Add human gate commands.
12. Add rule proposal from repeated findings.

