# BETWEEN — Broker Dashboard Visual System Spec

A terminal UI (Ink/React-for-CLI) design language for the BETWEEN broker dashboard. Synthesizes cmux's *functional-color attention command-center* with Kiro's *violet-tinted three-tier elevation, glyph-driven semantics*, adapted to a 256-color / truecolor terminal. Layout follows blueprint §2/§11: broker-dominant top pane, bottom split into developer + reviewer regions.

---

## 1. Design Principles

1. **Color is status, not decoration** (cmux). Every hue in the UI carries functional meaning — a phase, an attention state, a semantic result. There is no purely-branding color on a working surface. One accent per element carries the signal; everything else is neutral. *(cmux: "color is functional status not branding"; the whole UI answers "which region needs me now".)*

2. **Hierarchy through opacity tiers and weight, never size** (cmux + Kiro). Monospace gives us a fixed cell, so depth comes from a 3-tier text ramp (primary / muted / faint) and a 3-step surface elevation ladder (bg < surface < elevated), mirrored from Kiro's `#19161D < #211D25 < #352F3D` and cmux's `.primary/.secondary/.tertiary` opacity tiers. Bold = active/header; dim = secondary/metadata.

3. **Calm, dense, violet-tinted near-black canvas** (Kiro). Backgrounds are not pure gray/black but a deep violet-charcoal, layered subtly so panels read as "lifted" without heavy chrome. High information density, low visual noise — the broker pane dominates, sub-regions stay quiet until they demand attention.

4. **Attention is routed by tint + edge bar + glyph, not boxes** (cmux). Selection and "needs-me" states use a colored left-edge bar (`▎`) plus a low-opacity tinted row, plus a status glyph — never a heavy border. The focused region gets a violet focus ring (Kiro `#9E61FF`); a region awaiting input gets a colored frame.

5. **Glyph-first semantics for agent state** (Kiro). Crisp Unicode glyphs (`✓ ✗ ⏸ ●`) plus phase glyphs encode state at a glance, reusable directly as Ink `<Text>` runs. Approval/alert states surface in a bottom-anchored bar, matching Kiro's terminal-UI approval pattern.

---

## 2. Color Token Table (truecolor)

Surface ladder and accent are Kiro-derived (cohesive single-brand violet); semantic + phase colors blend Kiro's bright TUI semantics with cmux's lane palette for maximum legibility on dark.

| Token | Hex | Terminal Role |
|---|---|---|
| `bg` | `#19161D` | App canvas / root background (darkest layer, violet-charcoal) — Kiro base |
| `bgChrome` | `#18161C` | Header bar + footer/status bar background (slightly darker chrome) — Kiro |
| `surface` | `#211D25` | Panel / pane / terminal content surface (broker, dev, reviewer panes) — Kiro |
| `surfaceAlt` | `#28242E` | Tab strip, active tab, sub-headers inside panes — Kiro |
| `elevated` | `#352F3D` | Hover / active-row / popover / selected-row fill — Kiro lifted tone |
| `border` | `#4A464F` | Default panel border / frame (focused or primary panes) — Kiro |
| `divider` | `#4A464F` @ ~0x33 | Low-emphasis hairline separators inside panes — Kiro subtle border |
| `textPrimary` | `#FFFFFF` | High-emphasis text: active region title, focused content — Kiro |
| `textMuted` | `#938F9B` | Secondary text: branch, dir, labels, placeholders — Kiro mauve-gray |
| `textFaint` | `#A6A5A7` @ dim | Timestamps, counts, inactive metadata (apply terminal `dim`) — cmux tertiary tier |
| `icon` | `#C1BEC6` | Default icon / glyph tint, mid-emphasis text — Kiro |
| `accent` | `#B080FF` | Primary accent: brand, region identity, active section header — Kiro signature violet |
| `accentFill` | `#8141E6` | Filled accent bg: active selection fill, primary button — Kiro deep |
| `focusRing` | `#9E61FF` | Focused/selected region frame + focused input border — Kiro |
| `accentAlt` | `#8DC8FB` | Secondary accent / info / review-region identity — Kiro info blue (~cmux `#7AA2F7`) |
| `success` | `#80FFB5` | Success / approved / created files / `✓` — Kiro green |
| `warning` | `#FFCF99` | Warning / running / modified files / needs-attention — Kiro amber (~cmux `#E0AF68`) |
| `error` | `#FF8080` | Error / conflict / rejected / `✗` — Kiro red (~cmux `#F7768E`) |
| `alertBadge` | `#FF8080` | Solid badge bg for unread/urgent counts (white number on top) |
| **Phase-status colors** | | |
| `phaseIntake` | `#8DC8FB` | INTAKE / receiving request (info blue) |
| `phaseRouting` | `#C3A0FD` | ROUTING / broker deciding (keyword violet, sibling of brand) |
| `phaseDeveloping` | `#FFCF99` | DEVELOPING / dev agent working (amber = in-progress) |
| `phaseReviewing` | `#80F4FF` | REVIEWING / reviewer agent inspecting (cyan = inspection) |
| `phaseApproval` | `#B080FF` | AWAITING APPROVAL / human gate (brand violet = "you") |
| `phaseDone` | `#80FFB5` | DONE / merged / shipped (success green) |
| `phaseBlocked` | `#FF8080` | BLOCKED / error / conflict (error red) |
| `phaseIdle` | `#565F89` | IDLE / completed-inactive (cmux muted indigo, terminal `dim`) |

> Truecolor (24-bit) assumed. For 256-color fallback, round each hex to the nearest xterm-256 index at render time (e.g. `#B080FF→141`, `#80FFB5→121`, `#FF8080→210`, `#FFCF99→222`, `#211D25→235`, `#19161D→233`). Honor `NO_COLOR` by dropping to weight/glyph-only hierarchy (Kiro supports this).

---

## 3. Typography & Affordances (terminal limits)

Monospace by nature; emulate hierarchy with weight, dim, and color (cmux + Kiro both drive hierarchy by weight/color, not size).

**Text weight & decoration map**
- **Bold** — region titles, active/selected rows, UPPERCASE section/lane headers, the focused region's content header. *(cmux semibold-uppercase headers.)*
- **Dim** (`Text dimColor`) — timestamps, counts, branch/dir metadata, idle/completed rows. *(cmux `.tertiary`; Kiro muted.)*
- **Normal** — body content (terminal stream, diff lines).
- **Underline** — sparingly: links/URIs (`accentAlt`/cyan), active keybinding hint in footer.
- **Inverse** — selected list item in a focused menu (color-bg + dark text), e.g. count badge: dark text on `warning`/`success` fill.
- **Italic** — avoid (inconsistent terminal support); Kiro uses it only for comments which we render `dim`.

**Box-drawing border styles** (Ink `borderStyle`)
- `round` (`╭─╮ ╰─╯`) — default pane frame, color `border`. Calm, soft — matches Kiro's rounded surfaces.
- `bold`/`double` reframe — the **focused** region only, color `focusRing` (`#9E61FF`). Conveys focus without a fill.
- `single` thin (`├─┤`) — internal dividers between dev/reviewer split, color `divider`.
- No border — dense list rows; selection shown by left-edge bar instead.

**Iconography (Unicode glyphs)** — reusable Ink `<Text>` runs:
| Glyph | Meaning | Token |
|---|---|---|
| `▎` | selection / attention left-edge bar | tinted per state |
| `●` | active region / live indicator | `success` (live) / `phaseIdle` (idle) |
| `◐` | streaming / working (spinner frames `◐◓◑◒`) | `warning` |
| `✓` | success / approved / passed | `success` |
| `✗` | error / rejected / failed | `error` |
| `⏸` | awaiting approval / paused gate | `phaseApproval` |
| `⊙` | broker / routing hub | `accent` |
| `⚒` | developer working (cmux hammer=wip) | `phaseDeveloping` |
| `◎` | reviewer inspecting (cmux eye=review) | `phaseReviewing` |
| `⚑` | blocked / urgent flag | `error` |
| `↻` | retry / in-progress loop | `warning` |
| `▸ ▾` | collapsed / expanded (collapsible output, Kiro Ctrl+O) | `icon` |
| `⟳` | unread/pending count carrier (badge) | `alertBadge` |

---

## 4. Layout Spec — §2/§11 Regions

Broker-dominant 3-region composition with cmux/Kiro framing: a chrome **header bar** (identity + global state chips), the large **broker pane** (top), a **bottom split** into **developer** (left) and **reviewer** (right) regions, and a bottom **command-hint / approval footer**.

**Region map & sizing**
- **Header bar** (`bgChrome`, height 1, full width): brand `⊙ BETWEEN`, session name, global phase chip, live counts, clock (mono, dim).
- **Broker pane** (`surface`, `round` border, ~55–60% height, full width): the dominant region. Frame is `focusRing` when focused, else `border`. Shows broker reasoning/routing stream + a top sub-header strip (`surfaceAlt`) with current phase glyph + routing target.
- **Bottom split** (~35–40% height): two side-by-side panes separated by a `divider`.
  - **Developer region** (left, `surface`): dev agent terminal/diff, git-status-decorated file list (created=`success`, modified=`warning`, deleted/conflict=`error`).
  - **Reviewer region** (right, `surface`): reviewer findings, `✓/✗` verdict list, approval queue.
- **Footer / command-hint bar** (`bgChrome`, height 1–3): keybinding hints (dim) normally; expands into a stacked **approval bar** (Yes / Trust / No) when a human gate is pending (Kiro pattern), framed in `phaseApproval`.

**ASCII wireframe**

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ⊙ BETWEEN  session:feat-auth   ◐ ROUTING   dev ⚒1  rev ◎0  ⏸1   14:08:22 │   ← header bar  bgChrome
├──────────────────────────────────────────────────────────────────────────┤
╭─ BROKER ───────────────────────────────────────────────────  ● live ─────╮   ← broker pane (focusRing frame)
│ ⊙ ROUTING → developer        task: implement token refresh                │     sub-header strip  surfaceAlt
│ ──────────────────────────────────────────────────────────────────────── │     divider (0x33)
│ ▎ I'll hand this to the developer agent. Acceptance: refresh rotates …   │   ← ▎ accent left-bar = active line
│   reviewer will gate on: no token in logs, 401→refresh→retry path.        │     body  textPrimary
│   waiting on developer ◐                                                   │     status  warning (dim)
│                                                                            │
│                                                                            │
╰────────────────────────────────────────────────────────────────────────╮ │
┌──────────────────────────────────┬───────────────────────────────────────┐   ← bottom split
│ DEVELOPER            ⚒ working    │ REVIEWER              ◎ idle           │     section headers BOLD/UPPER
│ ────────────────────────────────  │ ─────────────────────────────────────  │
│ ✓ M  src/auth/token.ts      +42   │ ⏸ awaiting dev handoff                 │     dev: git-status decorated
│ ✓ A  src/auth/refresh.ts    +18   │                                        │     reviewer verdict list:
│ ✗ M  src/auth/log.ts   token leak │ ✓ no-secrets-in-logs                   │       ✓ success / ✗ error
│ ◐ running tests… 12/40            │ ✗ 401-refresh-retry   unverified       │
└──────────────────────────────────┴───────────────────────────────────────┘
│ ⏸ Approval needed: merge feat-auth?   [Y]es  [T]rust  [N]o                 │   ← footer → approval bar
└──────────────────────────────────────────────────────────────────────────┘     phaseApproval frame
```

Default (no pending gate) footer collapses to a single dim hint line:
```
│ ↹ switch region   ⏎ focus   o toggle output   g crew   ? help              │   footer  bgChrome / textFaint
```

**Framing rules**
- Only **one** region carries the `focusRing` frame at a time; all others use `border`.
- **Status chips** in the header are `glyph + count`, tinted by phase (`⚒1` dev amber, `◎0` reviewer cyan, `⏸1` approval violet). Zero-counts render `dim`.
- Selection/attention inside any list = `▎` left bar + `elevated` row fill, tinted by phase — never a box (cmux selection-bar pattern).
- Collapsible tool/thinking output uses `▸/▾` head+tail summary (Kiro Ctrl+O).

---

## 5. BETWEEN Phase → Color + Glyph Mapping

| Phase | Token / Hex | Glyph | Notes |
|---|---|---|---|
| Intake | `phaseIntake` `#8DC8FB` | `▸` | broker receiving the request |
| Routing | `phaseRouting` `#C3A0FD` | `⊙` | broker deciding dev vs reviewer |
| Developing | `phaseDeveloping` `#FFCF99` | `⚒` / `◐` | dev agent working (spinner while live) |
| Reviewing | `phaseReviewing` `#80F4FF` | `◎` | reviewer inspecting |
| Awaiting Approval | `phaseApproval` `#B080FF` | `⏸` | human gate; surfaces in footer approval bar |
| Done | `phaseDone` `#80FFB5` | `✓` | merged / shipped |
| Blocked | `phaseBlocked` `#FF8080` | `✗` / `⚑` | error / conflict / rejected |
| Idle | `phaseIdle` `#565F89` | `●` (dim) | completed-inactive region |

---

## 6. Sourced vs Inferred

**Sourced (from research findings):**
- All surface/border/text/accent/semantic hex values are Kiro dark-theme token values (community port `takk8is/kiro-theme-for-zed`, a faithful reproduction — high-confidence but second-hand). `bg #19161D`, `surface #211D25`, `elevated #352F3D`, `border #4A464F`, `focusRing #9E61FF`, `accent #B080FF`, `accentFill #8141E6`, `success #80FFB5`, `warning #FFCF99`, `error #FF8080`, info `#8DC8FB`, type `#80F4FF`, keyword `#C3A0FD`, text `#FFFFFF`/`#938F9B`/`#C1BEC6`/`#A6A5A7` are all literal token values.
- Status glyphs `✓ ✗ ⏸` are sourced exact from Kiro terminal-UI docs, with their color mappings (green/red).
- Three-tier elevation ladder, bottom-anchored stacked approval bar, status-bar chips (branch + error/warning counts + agent status), collapsible head+tail output, crew/activity panels, `NO_COLOR` support — all from Kiro docs.
- cmux: functional-color principle, opacity-tier text hierarchy, colored left-edge selection bar (`▎`) + tinted row, lane/section UPPERCASE-bold headers, count/alert badges, status-icon→role mapping (triangle/eye/hammer/leaf/checkmark), monospace-for-metadata. `phaseIdle #565F89` and the warning/error cross-checks (`#E0AF68`, `#F7768E`, `#7AA2F7`) are cmux-sourced Tokyo Night values used as corroboration.

**Inferred / adapted (not in sources):**
- The specific Unicode glyph choices beyond `✓ ✗ ⏸` (`⊙ ⚒ ◎ ● ◐ ▎ ⚑ ↻ ▸ ▾`) — chosen to fit cmux's icon-role taxonomy in a font-agnostic terminal; cmux's SF Symbols are not directly available in a TUI.
- The 256-color xterm fallback indices — computed mappings, not in either source.
- The eight BETWEEN phase names and their color/glyph assignments — derived by mapping cmux's lane taxonomy and Kiro's syntax palette onto BETWEEN's broker→dev→reviewer→approval flow (per blueprint §2/§11). The blueprint itself was not provided to me; region structure (broker-dominant top, dev+reviewer bottom split) is taken from the task description, and exact §2/§11 wording could not be verified.
- Box-drawing `borderStyle` assignments (`round` default, `bold`/`focusRing` on focused, thin `single` dividers) — a TUI translation of Kiro's elevation/focus distinction; neither source specifies Ink border styles.
- Per the research caveat: cmux ships **no** locked global palette (it inherits the user's Ghostty colors); the cmux hex values are a *demonstrated* design language, not a brand. This spec therefore anchors the brand on Kiro's coherent single-violet system and uses cmux for *patterns* (attention routing, density, functional color) rather than as the primary palette source.
