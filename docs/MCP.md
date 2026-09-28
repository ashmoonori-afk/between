# Between MCP Server

Between ships a stdio [Model Context Protocol](https://modelcontextprotocol.io) server so MCP
clients (Claude Code, Claude Desktop, Codex CLI, Cursor, ...) can read broker state and, when a
human allows it, steer the broker. It is a thin front end over the same core API as the CLI
(`src/api`); both front ends return the same data and the same error wording.

## Run it

The package is `between-dev`. It has three bins:

| Bin | Runs |
| --- | --- |
| `between` | the CLI |
| `between-dev` | the CLI (alias; lets `npx between-dev <cmd>` work) |
| `between-mcp` | the MCP server |

```bash
# recommended for MCP clients: name the package and the MCP bin explicitly, pin the version
npx -y --package=between-dev@0.2.0 between-mcp

# equivalent convenience form (same server start function)
npx -y between-dev@0.2.0 mcp

# before the package is on the npm registry, run straight from GitHub (builds on install)
npx -y --package=github:ashmoonori-afk/between between-mcp
```

Do not use `npx between-mcp`. npx would look up a separate npm package called `between-mcp`.

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `--root <path>` | `$BETWEEN_ROOT`, then the working directory | Project the server is pinned to. Resolved to a real path at startup. |
| `--allow-control` | off | Register the broker control tools (pause, resume, interrupt, review now, stop, goal, steer). |
| `--allow-exec` | off | Register tools that run repo-configured commands (`between_verify`, `between_policy`). |
| `--allow-review` | off | Register `between_review`, which runs the claude/codex CLI and sends the subject to that provider. |

The project must already be initialized with `between init` (a human step; see below).

## Tools

Every tool takes a strict object. Unknown fields, including `root`, are rejected. Each server is
pinned to one project.

| Tool | Input | Access | What it returns |
| --- | --- | --- | --- |
| `between_status` | `{}` | read | Phase, cycle, waiting actor, diff, agent status, last event |
| `between_summarize` | `{}` | read | Event counts from the journal |
| `between_doctor` | `{ strict?: boolean = true }` | read | Environment and config checks |
| `between_journal` | `{ verify?: boolean = true }` | read | Entry count and hash-chain integrity |
| `between_replay` | `{ verify?: boolean = true }` | read | State reconstructed from the journal |
| `between_evidence` | `{}` | read | Evidence manifest for the current cycle |
| `between_review` | `{ kind, text? \| file? \| url?, base?, context?, focus?, criteria?, reviewer?, from? }` | review | One-shot review of a diff, answer, or plan by the paired agent (see below) |
| `between_policy` | `{}` | exec | Policy evaluation (may run a dependency audit) |
| `between_verify` | `{}` | exec | Runs the configured verification checks |
| `between_pause` / `between_resume` / `between_interrupt` / `between_review_now` / `between_stop` | `{}` | control | `{ command_id, status: "queued" }` |
| `between_goal` / `between_steer` | `{ goal: string }` | control | `{ command_id, status: "queued" }` |

Control tools **queue** a command on the broker's command bus; the running broker applies it on
its next tick. "Queued" is not "applied". Check `between_status` afterwards.

### Direct review (`between_review`)

> Available in the release after `between-dev@0.2.0` (0.2.0 and earlier do not have
> `--allow-review` or `between_review`). Until that release is on npm, start the server from the
> GitHub build: `npx -y --package=github:ashmoonori-afk/between between-mcp --allow-review`.

Asks the other agent of the pair for an independent review, from inside a running session and
outside the broker cycle. It is registered only with `--allow-review`. It does not touch the
repository or the broker, but it runs a model CLI, costs a model call, and sends the subject (and
a fetched URL body) to the reviewer agent's model provider, so it is not annotated read-only.

| Field | Meaning |
| --- | --- |
| `kind` | `diff` (code change), `answer` (an agent's reply), or `plan` (plan, spec, design) |
| `text` / `file` / `url` | The subject; at most one. `file` must resolve inside the project root and not under `.between/`, `.git/`, or `.env*`. `url` is http(s) only, fetched from public addresses only: loopback, private, link-local (cloud metadata), and reserved ranges are refused at DNS-lookup time on every redirect hop, and the body is aborted past 256 KiB. |
| `base` | `diff` with no subject: commit to diff the working tree against (default `HEAD`, tracked files) |
| `context` | For `answer`, the user's question verbatim; otherwise background |
| `focus`, `criteria` | What to look at hardest; up to 10 extra criteria |
| `reviewer` | Force `claude` or `codex`; refused when it equals the caller (no self-review) |
| `from` | The calling agent. The other one reviews. When the MCP client is recognized (Claude Code -> `codex` reviews; Codex -> `claude` reviews), the client identity is authoritative and a conflicting `from` is refused; `from` is only taken as given from unrecognized clients. |

Routing: `reviewer` > the other agent of `from` > the preset in `reviewer_command` of
`.between/config.yaml`. A fake reviewer is never picked implicitly and cannot be chosen over MCP.
The reviewer is the same CLI the broker wrappers use, with your existing sign-in (no new keys),
started in an empty temporary directory, never the project, with no way to read the disk:
`claude -p --safe-mode --tools "" --strict-mcp-config --disable-slash-commands` (no built-in
tools, and no user or project hooks, plugins, skills, MCP servers, or CLAUDE.md, while sign-in
still works; hooks from a managed policy still apply, so the reviewer also runs with
`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` to keep the credential out of hook subprocesses), or
`codex exec --sandbox read-only --ignore-user-config --ignore-rules -c mcp_servers={}` with every
model-visible capability feature disabled (shell, exec, code mode, image viewing and generation,
apps, plugins, skills, multi-agent, browser, computer use, hooks). The subject is entirely in the
prompt, so an injection inside it finds no tool to read or change anything with. The reviewer
binary is looked up on the filtered `PATH` by Between itself and refused if its canonical path is
inside the project, and the temporary directory must resolve outside the project (a `TMPDIR`
inside it fails closed). The
environment is an allowlist: runtime variables plus that reviewer's own provider credentials
(Claude gets only Anthropic credentials, Codex only OpenAI/Codex ones); every other credential
and anything pointing into the project (`BETWEEN_ROOT`, `INIT_CWD`, project entries on `PATH`,
...) is dropped.
Secret-like values in the subject are replaced with `[REDACTED]` before it is sent; the subject
is capped at 256 KiB.

Rubrics: `diff` correctness, regressions, security, tests, maintainability; `answer` correctness,
completeness, evidence, clarity; `plan` goals, scope, risks, sequencing, testability, open
decisions.

Result `data`:

```json
{
  "kind": "plan",
  "reviewer": "codex",
  "routed_by": "paired_with_caller",
  "verdict": "REQUEST_CHANGES",
  "verdict_adjusted": false,
  "summary": "...",
  "findings": [
    { "id": "F1", "severity": "major", "title": "...", "detail": "...", "location": "...", "criterion": "risks" }
  ],
  "questions": ["..."],
  "rubric": ["goals", "scope", "risks", "sequencing", "testability", "open decisions"],
  "subject": { "source": "file", "label": "docs/plan.md", "bytes": 1234, "sha256": "...", "redactions": 0 }
}
```

Severities are `critical`, `major`, `minor`, `nit`. Any `critical` or `major` finding forces
`REQUEST_CHANGES` (`verdict_adjusted: true` when the reviewer said APPROVE anyway). A reviewer
that is missing, times out (`review_timeout_seconds`, default 900 s), or returns no valid verdict
yields error code `reviewer_failed`.

### Result shape

Every tool returns the same envelope in `structuredContent` and as JSON text:

```json
{ "ok": true, "data": { "...": "..." } }
{ "ok": false, "error": { "code": "no_state", "message": "no state found - run `between init`" } }
```

Failures also set `isError: true`. Error codes: `no_state`, `invalid_argument`, `not_found`,
`invalid_config`, `integrity_error`, `reviewer_failed`, `internal`. `internal` carries a generic message; details are
written to the server's stderr only.

## What is deliberately not exposed

| Operation | Why |
| --- | --- |
| `approve` (merge, deploy, promote_rule) | Human-only. The main library entry does not export it (it lives in `between-dev/human`), and the server scrubs `BETWEEN_APPROVAL_SECRET` from its environment. |
| `ack` | Nothing authenticates the caller as the reviewer. |
| `init`, `policy --init` | Edit `.gitignore` and install a git pre-push hook. These are setup decisions for a human. |
| `verify-push` | Needs the approval signing secret. |
| `review-worktree` | Force-replaces the worktree the live reviewer uses. |
| `start`, `dash`, `cockpit`, `onboard`, `gateway`, `ide`, `forge` | Long-running, interactive, or credential-handling. |

## Security notes

- The server removes credential-looking environment variables from its own process at startup
  (approval secret, forge and gateway tokens, SSH agent, ...). Tools that spawn processes cannot
  hand them on.
- `--allow-exec` lets the client run whatever `.between/config.yaml` lists under
  `verification_checks`. Enable it only for repositories whose config you trust.
- `--allow-control` lets the client steer the broker. `between_steer` sends work back to the developer,
  resets the goal's cycle count, and clears a stale approval. As with the CLI, this does not grant approval.
- stdout carries only JSON-RPC; logs go to stderr.
- MCP annotations (`readOnlyHint`, `destructiveHint`, ...) are hints for clients, not
  authorization. The startup flags are the authorization.

## Client configuration

Replace `/abs/path/to/repo` with the repository Between manages. Add `--allow-control` and/or
`--allow-exec` to the args only if you want those tools.

### Claude Code

Run from the repository (Claude Code starts the server in the project directory):

```bash
claude mcp add between -- npx -y --package=between-dev@0.2.0 between-mcp
```

### Claude Desktop

`claude_desktop_config.json`. Claude Desktop does not start servers in your project, so pass
`--root`:

```json
{
  "mcpServers": {
    "between": {
      "command": "npx",
      "args": ["-y", "--package=between-dev@0.2.0", "between-mcp", "--root", "/abs/path/to/repo"]
    }
  }
}
```

On Windows, launch through `cmd`:
`"command": "cmd", "args": ["/c", "npx", "-y", "--package=between-dev@0.2.0", "between-mcp", "--root", "C:\\path\\to\\repo"]`.

### Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.between]
command = "npx"
args = ["-y", "--package=between-dev@0.2.0", "between-mcp", "--root", "/abs/path/to/repo"]
```

### Cursor

`.cursor/mcp.json` in the repository:

```json
{
  "mcpServers": {
    "between": {
      "command": "npx",
      "args": ["-y", "--package=between-dev@0.2.0", "between-mcp"],
      "env": { "BETWEEN_ROOT": "/abs/path/to/repo" }
    }
  }
}
```

## Library use

The same core API is importable:

```ts
import { getStatus, submitBrokerCommand } from 'between-dev'
import { approve } from 'between-dev/human' // human-only; never wire this into agent tooling

const status = await getStatus('/abs/path/to/repo')
```
