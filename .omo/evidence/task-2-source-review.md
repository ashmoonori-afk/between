# Source review notes

PASS: `src/cli.ts` routes `dash` through a dynamic import to `src/ui/dash.tsx`, keeping the Ink/React dependency off non-dashboard command startup.
WARN: `src/cli.ts:235` parses `--interval` with `Number(v)` and passes it to `src/ui/dash.tsx:36` without finite/positive validation.
PASS: `src/ui/Dashboard.tsx` implements the broker-dominant top pane plus developer/reviewer bottom split described in `docs/ui-design-spec.md`.
WARN: `src/ui/theme.ts:99-102` exports `noColor()`, but the dashboard code does not call it; rely on Ink behavior or wire it explicitly.
WARN: `test/unit/dashboard.test.tsx` asserts key labels only; real TUI width and CLI error-path behavior require smoke evidence.
