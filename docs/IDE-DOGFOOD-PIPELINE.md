# Between IDE Dogfood Pipeline

This pipeline verifies the IDE-first surface through the same paths a user drives:
project config, `between ide`, the VS Code webview renderer, extension actions, tests, and build.

## Scope

The pipeline covers:

- Project-local topology config: `builder_agent_count`, `reviewer_agent_count`,
  `ide_cli_rules_mode`, and `ide_cli_profile_dir`.
- Aside-inspired IDE control config: `ide_permission_mode`, `ide_working_folder`, and
  `ide_followup_mode`.
- IDE target names: `builder:n` and `reviewer:n`.
- IDE-local CLI profile output, including `CODEX_HOME=<repo>/.between/ide-profile/codex` for
  Codex commands plus `BETWEEN_IDE_PERMISSION_MODE`, `BETWEEN_IDE_WORKING_FOLDER`, and
  `BETWEEN_IDE_FOLLOWUP_MODE`.
- VS Code webview topology/control display and edit message flow.
- Safety boundary: global agent rules can be bypassed for the IDE-local CLI profile only; broker
  policy, `.between/commands`, approvals, sandbox/worktree boundaries, evidence gates, and
  `verify-push` remain enforced.

## Gate

Run from the repository root:

```bash
npm run typecheck
npx vitest run test/unit/config-agent.test.ts test/unit/ide-config.test.ts test/unit/ide-profile.test.ts test/unit/ide-command.test.ts test/unit/ide-bridge.test.ts --no-file-parallelism --reporter=verbose
npm --prefix extensions/vscode-between test
npm test
npm run build
npm run test:vscode
```

## Manual CLI Dogfood

Run against a temporary target repository, not the Between source tree's own `.between/` state:

```bash
tmp="$(mktemp -d)"
mkdir -p "$tmp/.between"
cat > "$tmp/.between/config.yaml" <<'YAML'
schema_version: 1
developer_command: claude
reviewer_command: 'node .between/agents/codex-agent.mjs reviewer'
builder_agent_count: 1
reviewer_agent_count: 1
ide_cli_rules_mode: project_only
ide_cli_profile_dir: .between/ide-profile
ide_permission_mode: guard
ide_working_folder: .
ide_followup_mode: steer
YAML

(cd "$tmp" && node --import tsx /absolute/path/to/between/src/cli.ts ide --json)
(cd "$tmp" && node --import tsx /absolute/path/to/between/src/cli.ts ide --builder-agents 3 --reviewer-agents 2 --permission-mode full_access --working-folder packages/app --followup-mode queue --print-cli reviewer:2)
```

On Windows, pass the `tsx` loader as a `file://` URL:

```bash
repo="/absolute/path/to/between"
loader="$(node -e "const {pathToFileURL}=require('node:url'); console.log(pathToFileURL(process.argv[1]).href)" "$repo/node_modules/tsx/dist/loader.mjs")"
(cd "$tmp" && node --import "$loader" "$repo/src/cli.ts" ide --json)
```

Expected:

- JSON includes `profile.builderAgentCount` and `profile.panes`.
- Text output includes `reviewer:2`, `BETWEEN_IDE_TARGET="reviewer:2"`,
  `BETWEEN_IDE_PERMISSION_MODE="full_access"`, `BETWEEN_IDE_WORKING_FOLDER="packages/app"`,
  `BETWEEN_IDE_FOLLOWUP_MODE="queue"`, `CODEX_HOME=.../.between/ide-profile/codex`, and
  `bypasses_broker_policy: false`.
- Only the temporary target's `.between/config.yaml` changes.

## Manual Webview Dogfood

Render the VS Code webview HTML with a stubbed `acquireVsCodeApi()` and drive it with a real
browser. At minimum verify:

- `Builder agents`, `Reviewer agents`, `Permission mode`, `Follow-up mode`, `Working folder`, and
  target chips render.
- `Global rules bypassed` appears only for `project_only`.
- `Broker policy enforced` remains visible in the topology card.
- Submitting the topology form posts `configureTopology` with numeric counts and the control-plane
  fields.
- No user-controlled project, finding, or target text is injected as raw HTML.

## Failure Policy

Do not mark the IDE slice done while any gate fails. Fix the first failing behavior, add or keep
the test that caught it, then rerun the full gate and manual CLI/webview dogfood.
