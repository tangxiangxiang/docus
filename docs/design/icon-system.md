# Docus Icon System

> **Quiet tools for deep thinking.**

This document is the contract for every icon in Docus. It is the
source of truth for the design rules that `scripts/icon-lint.ts`
and `src/components/vault/__tests__/icons.test.ts` enforce.

## 1. Brand

Docus is an AI-native knowledge OS, not a generic markdown editor.
The icons should feel:

| Keyword | What it means in practice |
| --- | --- |
| **Calm** | No decorative dots, sparkles, or rainbow gradients. One accent color per state. |
| **Focused** | Single concept per icon. Composite icons only when they have one reading. |
| **Editorial** | Document-first. Pages, lines, fold marks — not abstract symbols. |
| **Knowledge-first** | "Backlink", "reference", "citation" are first-class concepts with their own glyphs, not afterthoughts. |
| **Minimal** | As few strokes as possible. If a stroke does not carry meaning, remove it. |
| **Precise** | Pixels snap to the grid. Optical centering beats mathematical centering. |

## 2. Geometry

Every functional icon lives on the same grid. These are the rules
the lint enforces on functional icons in `src/components/vault/icons.ts`
and on inline SVG in `src/components/**/*.vue`.

| Property | Value | Why |
| --- | --- | --- |
| `viewBox` | `0 0 16 16` | One canvas, optical center at (8, 8). |
| `width` × `height` | `14` × `14` (1px optical padding on all sides) | Leaves 1px breathing room at 14px display; scales cleanly to 16/18/20/22. |
| `stroke` | `currentColor` | Theme follows the parent text color; no hardcoded ink. |
| `stroke-width` | `1.5` | Reads cleanly at 14px; pairs with 1px detail strokes when needed. |
| `stroke-linecap` | `round` | Soft endings, no harsh pixel corners. |
| `stroke-linejoin` | `round` | Same — corners stay soft. |
| `fill` | `none` | Outline by default. A tiny `fill="currentColor"` is allowed only for "hole" features (e.g. tag punch, status dot). |
| `aria-hidden` | `true` | Icons are decorative; the surrounding text carries meaning. |
| `focusable` | `false` | Prevent IE/Edge tab-stop on `<svg>`. |

### Filled-glyph exception

A small set of icons deliberately opts out of the outline default:
status dots, AI memory/data-point glyphs, and other solid-state
marks where the concept is "presence" rather than "outline".

For these icons only, the root attributes flip:

| Property | Value |
| --- | --- |
| `fill` | `currentColor` |
| `stroke` | `none` |

All other shared attributes (size, viewBox, aria) still apply. The
fill is `currentColor` so the icon follows the consuming
component's text color, same as outline icons.

Each filled exception must be:

1. Listed in `FILLED_ICONS` in
   [`src/components/vault/__tests__/icons.test.ts`](../../src/components/vault/__tests__/icons.test.ts)
   so the test stays honest about which icons are filled.
2. Justified in a comment in `icons.ts` — the comment must explain
   *why* a filled glyph is the right metaphor (status dot, data
   point, presence marker), not a workaround for an unrendered
   outline version.

### Surface-display exception

A small set of icons lives in toolbar slots (NavBar buttons,
ActivityBar rail buttons) that need a larger visual weight than
the 14px inline default. The button chrome is 28-48px, and a 14px
icon inside that chrome looks anemic.

For these icons, four attributes change together:

| Property | Functional default | Surface display |
| --- | --- | --- |
| `viewBox` | `0 0 16 16` | `0 0 24 24` |
| `width` / `height` | `14` | `16` / `18` / `22` (per slot) |
| `stroke-width` | `1.5` | `1.8` / `2.0` (per slot) |
| stroke caps / joins / aria | unchanged | unchanged |

The HARD rules still apply: no `<text>`, no color literals, no root
`class`/`style`, no `1024`-style viewBox. Only the four attributes
above diverge from the shared grid.

Each surface-display icon must be:

1. Listed in `SURFACE_DISPLAY_ICONS` in
   [`src/components/vault/__tests__/icons.test.ts`](../../src/components/vault/__tests__/icons.test.ts)
   so the test stays honest about which icons use the larger canvas.
2. Justified in a comment in `icons.ts` — the comment must explain
   *why* this slot needs the surface canvas, and link to a future
   redraw at the shared grid if one is planned.

Future work: redraw each surface-display icon at the 16×16 grid +
1.5 stroke so the toolbar slot can render at the 14px default. The
viewBox flip and stroke adjustment are then unnecessary; the icon
moves out of `SURFACE_DISPLAY_ICONS` and back into the shared grid.

### Allowed exceptions

- **Brand logos** (e.g. Docus wordmark) may use a different viewBox.
- **Status dots** (a single 4px circle indicator) may have `fill="currentColor"` only.
- **Third-party component SVG** inside `MarkMap.vue` and `Mermaid.vue` (their toolbar buttons are part of the upstream library) — exempt. If we ever swap those libs, re-evaluate.

### Forbidden

- `<text>` elements (font-dependent, breaks the visual language).
- `viewBox="0 0 1024 1024"` or any large-grid viewBox — these come from Lucide's bundled icons and never look right at 14px.
- Color literals (`#fff`, `rgb(...)`, `hsl(...)`, named colors). All ink must flow through `currentColor` or a CSS variable.
- `class="..."` or `style="..."` on the root `<svg>`. Styling lives in the consuming component.
- Mixing fill and stroke on the same path unless the design calls for it (e.g. a "filled" status dot is fine; a "filled then stroked" glyph is not).

## 3. Base shapes (the families)

A small number of base shapes define most icons. All icons in a
family share the same outer geometry; only the inner mark changes.

### Document Base

```
┌─────────────┐
│┌──┐         │
│  │          │
│  └─────     │  ← folded corner
│             │
└─────────────┘
```

- 4 paths max: outline + fold corner + at most 2 content marks.
- Used by: Markdown file, Properties, Reference, Draft, Literature, New Chat (variant).

### Folder Base

```
   ╭─────╮
  ╭┴──╮  │
  │   │  │
  ╰─────╯
```

- 2 paths max: lid silhouette + content mark.
- Used by: Folder, Folder Open, Folder Plus, Archive (variant).

### Sparkle Base (AI)

The current Sparkle is acceptable for the brand mark but is **overused**
across the product. Two rules:

1. Sparkle is reserved for **AI-scoped** UI (AI panel, AI toggle, AI tool card header).
2. Inside the AI panel, do not use Sparkle for individual concepts
   (Context, Memory, Reasoning, Prompt, Conversation). Each gets its
   own glyph so the panel reads as a vocabulary, not a sparkle storm.

### Status Base

State glyphs are **shape-coded first, color-coded second**. The shape
distinguishes the concept; color reinforces it.

| Concept | Shape | Color token |
| --- | --- | --- |
| Success | filled circle `●` | `--status-success` |
| Warning | triangle `△` | `--status-warning` |
| Error | hollow diamond `◇` | `--status-error` |
| Loading | partial arc `◜◝` | `--status-neutral` |
| Offline | cross `╳` | `--status-neutral` |
| Modified | filled dot `●` | `--status-modified` |

Color tokens are CSS custom properties; the icon SVG stays
`currentColor` and the consuming component sets the variable.

## 4. Naming

Icons live in `src/components/vault/icons.ts` (functional icons) and
future `src/components/icons/<surface>/*.svg` (surface-specific, e.g.
`activity-bar/explorer.svg`).

### Functional icons (in `icons.ts`)

`ICON_<NAME>` where `<NAME>` is SCREAMING_SNAKE describing the
concept, not the surface. Examples:

- `ICON_FOLDER` (not `ICON_FILE_TREE`)
- `ICON_AI` (not `ICON_SPARKLE`)
- `ICON_READ` (not `ICON_BOOK`)
- `ICON_HISTORY` (not `ICON_CLOCK`)

### Surface icons (future)

`<surface>/<concept>.svg`, lowercase dotted path. Examples:

- `activity-bar/explorer.svg`
- `activity-bar/search.svg`
- `navbar/undo.svg`
- `navbar/theme.svg`
- `editor/split.svg`
- `editor/zen.svg`
- `knowledge/backlink.svg`
- `knowledge/citation.svg`
- `ai/context.svg`
- `ai/memory.svg`
- `ai/reasoning.svg`
- `ai/prompt.svg`
- `ai/conversation.svg`

Surface icons get a wrapper `<Icon name="activity-bar/explorer" />`
component that resolves the path at build time.

## 5. Adding a new icon

1. Sketch it on the 16×16 grid. Check that no stroke crosses the
   1px outer padding (bounds inside (2, 14)).
2. If it belongs to a Base family, copy the base paths and only
   change the inner mark.
3. Add the SVG string to `src/components/vault/icons.ts` (or create
   a surface file under `src/components/icons/<surface>/`).
4. Export with the right name (`ICON_FOO` or `<surface>/<concept>`).
5. Run `npm run lint:icons` — must pass.
6. If the icon introduces a new visual pattern (e.g. a new base shape
   or a new color usage), update this document in the same commit.

## 6. Path budget

| Icon type | Max paths | Notes |
| --- | --- | --- |
| Single-stroke glyph (chevron, X, dot) | 1 | Self-explanatory. |
| Document Base (file outline + content) | 4 | Outline + fold + 2 content marks. |
| Folder Base (lid + content) | 2 | Lid silhouette + 1 content mark. |
| AI concept glyph | 4 | At 14px, more than 4 strokes muddies. |
| Composite (e.g. search = circle + handle) | 3 | Outline + 1 inner detail + 1 extension. |

If a design needs more paths, the icon is either too detailed for
14px (simplify) or belongs to a different surface (e.g. marketing,
which can use a larger canvas).

## 7. Future work (post Phase 0)

- Migrate the 7 inline tool-call SVGs in `AiToolCallCard.vue` into
  `icons.ts` so the lint covers them.
- Decide per-icon whether the NavBar / ActivityBar 24×24 strokes are
  "replace with 16×14/1.5" or "exempt as brand". No bulk migration
  without a per-icon decision.
- Add the AI concept glyphs (Context, Memory, Reasoning, Prompt,
  Conversation) so the AI panel has a vocabulary.
- Add the relationship-language glyphs (Backlink, Outgoing, Reference,
  Citation, Graph, Collection, Map) for the citation/graph surfaces.
- Snapshot tests for the icon grid once the set stabilizes.

---

## Cross-references

- Icon source: [`src/components/vault/icons.ts`](../../src/components/vault/icons.ts)
- Icon lint test: [`src/components/vault/__tests__/icons.test.ts`](../../src/components/vault/__tests__/icons.test.ts)
- Repo-wide icon lint: [`scripts/icon-lint.ts`](../../scripts/icon-lint.ts)
