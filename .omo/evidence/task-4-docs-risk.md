# Documentation and bounded daemon risk

PASS: `README.md` and `DEVELOPMENT-PLAN.md` align on the durable broker surfaces: git diff, `.between/*.json`, and Obsidian memory.
WARN: `README.md` / `DEVELOPMENT-PLAN.md` still state Node.js 20 LTS while the current locked CLI/TUI dependencies require Node 22+.
PASS: `docs/adr/ADR-0001-transport.md` keeps `node-pty` optional and makes file transport load-bearing before PTY embedding.
BOUNDED RISK: `src/daemon/loop.ts` measures 443 pure LOC. Keep this as a maintainability watch item; do not refactor it as part of this review.
