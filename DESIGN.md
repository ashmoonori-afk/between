# Between IDE Design System

Between is a local IDE broker for AI change control. The primary surface is the VS Code IDE cockpit; terminal dashboards are compatibility and diagnostic surfaces. The UI must feel like a compact operations console, not a landing page.

## Layout

- Use a 2/1 visual hierarchy: the Between broker panel is the dominant surface, and the developer/reviewer/status rail supports it.
- Keep repeated role surfaces framed, but do not nest cards inside other cards.
- Preserve stable lane heights and bounded output tails so new agent output never resizes the IDE cockpit.
- Prefer dense, scannable rows over explanatory prose.
- Builder and Reviewer targets should be stable and tmux-like: `builder:1`, `builder:2`, `reviewer:1`.

## Status Language

- Broker state is the source of truth for phase, cycle, waiting actor, and recoverable errors.
- Agent panes show process health from the host buffer: `live`, `standby`, `idle`, `dead`, or `not hosted`.
- `standby` means a broker-owned PTY slot is present but waiting for broker-supplied work, such as the reviewer waiting for a sealed review bundle.
- A non-zero or unknown hosted process exit is shown as `dead`; include the exit code when available.
- Recoverable daemon errors must be visible in the broker panel and must not be hidden inside the agent pane.
- `project_only` means the IDE-launched local CLI uses project-local rule context. It does not bypass broker policy, approval, or evidence gates.
- `read_only`, `guard`, `full_access`, `steer`, and `queue` are IDE control-plane intent labels. They must not imply that the VS Code UI can override broker policy, sandboxing, approvals, push gates, or command-bus validation.

## Tokens

- Use `src/ui/theme.ts` for all colors.
- Broker, builder/developer, reviewer, and broker-input accents must be distinct role tokens so the IDE surface does not collapse into a gray or purple-only theme.
- The broker command input is the only human typing surface in `start --embed`; agent panes are broker-controlled output/status surfaces.
- Broker input bars should be high-contrast and visible in both active and disabled states.
- Success means a live or passing state.
- Warning means waiting, pending, or attention needed.
- Error means a broker failure or dead hosted agent.
- Muted text is for terminal output, placeholders, and secondary metadata.

## Text And Glyphs

- Keep labels short: phase, cycle, role, status, error.
- Avoid visible how-to copy inside the running dashboard.
- Prefer ASCII-safe fallback text for status labels and tests.
- Glyphs are decorative only; status must still be readable without them.
