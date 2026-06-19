# Between TUI Design System

Between is a local broker cockpit for three terminal surfaces: the broker timeline plus developer and reviewer panes. The UI must feel like a compact operations console, not a landing page.

## Layout

- Use a 2/1 visual hierarchy: the Between broker panel is the dominant surface, and the developer/reviewer panes support it.
- Keep repeated terminal panes framed, but do not nest cards inside other cards.
- Preserve stable pane heights and bounded output tails so new agent output never resizes the dashboard.
- Prefer dense, scannable rows over explanatory prose.

## Status Language

- Broker state is the source of truth for phase, cycle, waiting actor, and recoverable errors.
- Agent panes show process health from the host buffer: `live`, `idle`, `dead`, or `not hosted`.
- A non-zero or unknown hosted process exit is shown as `dead`; include the exit code when available.
- Recoverable daemon errors must be visible in the broker panel and must not be hidden inside the agent pane.

## Tokens

- Use `src/ui/theme.ts` for all colors.
- Success means a live or passing state.
- Warning means waiting, pending, or attention needed.
- Error means a broker failure or dead hosted agent.
- Muted text is for terminal output, placeholders, and secondary metadata.

## Text And Glyphs

- Keep labels short: phase, cycle, role, status, error.
- Avoid visible how-to copy inside the running dashboard.
- Prefer ASCII-safe fallback text for status labels and tests.
- Glyphs are decorative only; status must still be readable without them.
