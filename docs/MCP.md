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
npx -y --package=between-dev@0.1.0 between-mcp

# equivalent convenience form (same server start function)
npx -y between-dev@0.1.0 mcp

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
| `between_policy` | `{}` | exec | Policy evaluation (may run a dependency audit) |
| `between_verify` | `{}` | exec | Runs the configured verification checks |
| `between_pause` / `between_resume` / `between_interrupt` / `between_review_now` / `between_stop` | `{}` | control | `{ command_id, status: "queued" }` |
| `between_goal` / `between_steer` | `{ goal: string }` | control | `{ command_id, status: "queued" }` |

Control tools **queue** a command on the broker's command bus; the running broker applies it on
its next tick. "Queued" is not "applied". Check `between_status` afterwards.

### Result shape

Every tool returns the same envelope in `structuredContent` and as JSON text:

```json
{ "ok": true, "data": { "...": "..." } }
{ "ok": false, "error": { "code": "no_state", "message": "no state found - run `between init`" } }
```

Failures also set `isError: true`. Error codes: `no_state`, `invalid_argument`, `not_found`,
`invalid_config`, `integrity_error`, `internal`. `internal` carries a generic message; details are
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
claude mcp add between -- npx -y --package=between-dev@0.1.0 between-mcp
```

### Claude Desktop

`claude_desktop_config.json`. Claude Desktop does not start servers in your project, so pass
`--root`:

```json
{
  "mcpServers": {
    "between": {
      "command": "npx",
      "args": ["-y", "--package=between-dev@0.1.0", "between-mcp", "--root", "/abs/path/to/repo"]
    }
  }
}
```

On Windows, launch through `cmd`:
`"command": "cmd", "args": ["/c", "npx", "-y", "--package=between-dev@0.1.0", "between-mcp", "--root", "C:\\path\\to\\repo"]`.

### Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.between]
command = "npx"
args = ["-y", "--package=between-dev@0.1.0", "between-mcp", "--root", "/abs/path/to/repo"]
```

### Cursor

`.cursor/mcp.json` in the repository:

```json
{
  "mcpServers": {
    "between": {
      "command": "npx",
      "args": ["-y", "--package=between-dev@0.1.0", "between-mcp"],
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
