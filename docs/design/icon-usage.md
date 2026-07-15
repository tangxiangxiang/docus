# Docus Icon Usage

> **Where every icon lives, where it's used, and where it must not be used.**

This is the second half of the icon-system contract. The first half —
[icon-system.md](./icon-system.md) — describes the visual rules every
icon must follow. This document describes the **usage** rules: which
icon goes in which surface, which icon is reserved for which concept,
and which combinations are wrong.

## 1. By vocabulary

The icons fall into eight vocabularies. Each vocabulary has a
distinct geometric language so a row of indicators stays scannable
without reading the labels.

### 1.1 Functional (24 icons)

The original library. Used in the file tree, file-tree context
menu, navbar, and view-mode menu.

| Icon | Where it lives | Notes |
| --- | --- | --- |
| `ICON_FOLDER` | [TreeRow.vue](../../src/components/vault/TreeRow.vue), [ActivityBar.vue](../../src/components/vault/ActivityBar.vue) | Closed folder. ActivityBar reuses this for the Files panel — there is no separate "files button" icon. |
| `ICON_FOLDER_OPEN` | [TreeRow.vue](../../src/components/vault/TreeRow.vue) | Open folder, paired with ICON_FOLDER via `isExpanded`. |
| `ICON_FOLDER_PLUS` | [TreeRow.vue](../../src/components/vault/TreeRow.vue) | New folder action in the file-tree context menu. |
| `ICON_FILE_MD` | [TreeRow.vue](../../src/components/vault/TreeRow.vue), [AiComposer.vue](../../src/components/vault/AiComposer.vue), [LinksPanel.vue](../../src/components/vault/LinksPanel.vue) | The "markdown document" icon. Used for any markdown note — both in the file tree and as a generic file symbol in AI context / link references. |
| `ICON_FILE_PLUS` | [TreeRow.vue](../../src/components/vault/TreeRow.vue) | New file action in the file-tree context menu. |
| `ICON_FILE_IMAGE`, `ICON_FILE_PDF`, `ICON_FILE_VIDEO`, `ICON_FILE_AUDIO`, `ICON_FILE_CODE`, `ICON_FILE_ATTACHMENT`, `ICON_FILE_DRAFT` | (not yet wired) | Reserved for the file tree once it shows non-markdown attachments. See [§ 3 Reserved vocabularies](#3-reserved-vocabularies). |
| `ICON_RENAME` | [TreeRow.vue](../../src/components/vault/TreeRow.vue), [ViewModeMenu.vue](../../src/components/ViewModeMenu.vue) | Pencil silhouette. Used for the rename action AND as the trigger icon for "edit" mode in the view-mode menu. |
| `ICON_DELETE` | [TreeRow.vue](../../src/components/vault/TreeRow.vue) | Trash silhouette with lid + interior verticals (5 paths). Distinct from ICON_DELETE_FILE — see below. |
| `ICON_ARCHIVE` | [TreeRow.vue](../../src/components/vault/TreeRow.vue) | Archive box. Used for the archive-note action in the file-tree context menu. |
| `ICON_PROPERTIES` | [TreeRow.vue](../../src/components/vault/TreeRow.vue) | Document with three content lines inside. The "document properties" action. |
| `ICON_SEARCH` | [NavBar.vue](../../src/components/NavBar.vue), [FileTree.vue](../../src/components/vault/FileTree.vue), [TagPanel.vue](../../src/components/vault/TagPanel.vue) | Magnifier. Used at all three search entry points: navbar command-palette trigger, file-tree filter, tag-panel filter. |
| `ICON_CHEVRON` | [TreeRow.vue](../../src/components/vault/TreeRow.vue) | Generic chevron, rotated 90° for the expand/collapse state in the file tree. |
| `ICON_TAG` | [ActivityBar.vue](../../src/components/vault/ActivityBar.vue), [TreeRow.vue](../../src/components/vault/TreeRow.vue) | Tag silhouette with hole. ActivityBar reuses this for the Tags panel button. |
| `ICON_HISTORY` | [AiPanel.vue](../../src/components/vault/AiPanel.vue) | Lucide-style history glyph (counter-clockwise circle + clock hands). The AI panel's history-list trigger. Distinct from ICON_AB_GIT_HISTORY (commit graph). |
| `ICON_NEW_CHAT` | [AiPanel.vue](../../src/components/vault/AiPanel.vue) | Speech bubble with a plus inside. The "start a new chat" action. Distinct from ICON_AI_CONVERSATION (two overlapping bubbles). |
| `ICON_EYE` | [NavBar.vue](../../src/components/NavBar.vue) | Open eye. The NavBar view-toggle icon for "switch to read mode" — universally read as "observe / view". |
| `ICON_READ` | (no current consumer) | Open book with curved page edges. Retained in `icons.ts` for documentation and possible future AI-panel reuse; not currently rendered anywhere. |
| `ICON_PANEL_RIGHT_OPEN`, `ICON_PANEL_RIGHT_CLOSE` | [NavBar.vue](../../src/components/NavBar.vue) | Right-panel toggle, two states. The "show/hide AI panel" button. |
| `ICON_SCOPE_INBOX`, `ICON_SCOPE_LITERATURE`, `ICON_SCOPE_ARCHIVE` | [NavBar.vue](../../src/components/NavBar.vue) | Vault-root chips. NavBar renders one per scope via the SCOPE_ICONS map. |

### 1.2 AI tool icons (7 icons)

Used by [AiToolCallCard.vue](../../src/components/vault/AiToolCallCard.vue)
for each tool name returned by the AI executor. Each maps 1:1 to a
tool name — adding a new tool requires adding a new icon and
extending the `TOOL_ICONS` map.

| Icon | Tool name |
| --- | --- |
| `ICON_READ_FILE` | `read_file` |
| `ICON_LIST_FILES` | `list_files` |
| `ICON_CREATE_FILE` | `create_file` |
| `ICON_WRITE_FILE` | `write_file` |
| `ICON_PATCH_FILE` | `patch_file` |
| `ICON_DELETE_FILE` | `delete_file` (simpler than ICON_DELETE) |
| `ICON_RENAME_FILE` | `rename_file` (different metaphor than ICON_RENAME) |

These are tuned for the small 14px display inside the AI panel
header, so they are intentionally less detailed than the general
`ICON_DELETE` / `ICON_RENAME` they sit alongside. See the comment
in [icons.ts](../../src/components/vault/icons.ts) for each icon.

### 1.3 AI vocabulary (5 icons)

Defined but not yet wired into the AI panel. Reserved for the
next round of AI-panel redesign, where they will replace the
current sparkle + text-label combinations.

| Icon | Concept |
| --- | --- |
| `ICON_AI_CONTEXT` | "the data/context the AI sees" |
| `ICON_AI_MEMORY` | "solid-state storage" (FILLED_ICONS) |
| `ICON_AI_REASONING` | "A → B reasoning step" |
| `ICON_AI_PROMPT` | "user input / terminal cursor" |
| `ICON_AI_CONVERSATION` | "ongoing dialogue" |

Existing `ICON_AI` (sparkle) stays as the brand mark for
AI-scoped surfaces. The five vocabulary icons replace sparkle
*inside* tool-call headers and conversation turns.

### 1.4 Knowledge vocabulary (7 icons)

Defined but not yet wired. Reserved for the backlinks panel,
citation list, and graph surface.

| Icon | Concept | Pairs with |
| --- | --- | --- |
| `ICON_KNOWLEDGE_BACKLINK` | "another note links to this one" | ICON_KNOWLEDGE_OUTGOING |
| `ICON_KNOWLEDGE_OUTGOING` | "this note links to another" | ICON_KNOWLEDGE_BACKLINK |
| `ICON_KNOWLEDGE_REFERENCE` | "[n] inline reference marker" | ICON_KNOWLEDGE_CITATION |
| `ICON_KNOWLEDGE_CITATION` | "block quotation / cited passage" | ICON_KNOWLEDGE_REFERENCE |
| `ICON_KNOWLEDGE_GRAPH` | "non-directional cluster of nodes" | ICON_AI_REASONING (directional) |
| `ICON_KNOWLEDGE_COLLECTION` | "items side by side" | ICON_FOLDER (the container) |
| `ICON_KNOWLEDGE_MAP` | "waypoints / single path" | ICON_KNOWLEDGE_GRAPH (cluster) |

The pairs (Backlink ↔ Outgoing, Reference ↔ Citation) are
deliberate compositional opposites. The singleton Graph +
Collection + Map trio forms a vocabulary for "nodes in
relation" — non-directional cluster, itemized set, single
path.

### 1.5 Status vocabulary (6 icons)

Wired into [StatusBar.vue](../../src/components/vault/StatusBar.vue)
and [AiToolCallCard.vue](../../src/components/vault/AiToolCallCard.vue).

| Icon | Used in | Pairs with color token |
| --- | --- | --- |
| `ICON_STATUS_SUCCESS` (FILLED) | StatusBar.saved, AiToolCallCard.ok | `--status-success` |
| `ICON_STATUS_MODIFIED` (FILLED) | StatusBar.dirty, StatusBar.external | `--status-modified` |
| `ICON_STATUS_WARNING` | (reserved) | `--status-warning` |
| `ICON_STATUS_ERROR` | StatusBar.error, AiToolCallCard.error | `--status-error` |
| `ICON_STATUS_LOADING` | StatusBar.saving, AiToolCallCard.pending | `--status-neutral` |
| `ICON_STATUS_OFFLINE` | StatusBar.offline | `--status-neutral` |

SUCCESS and MODIFIED are both filled circles but at different
radii (r=3.25 vs r=1.5) so the two remain distinguishable by
shape even when currentColor collapses in a monochrome printout.

WARNING has no consumer yet — it's reserved for future use cases
(a validation error, a destructive confirmation, an alert
banner). When a consumer needs it, the consumer pairs the icon
with `--status-warning`.

### 1.6 Editor state vocabulary (7 icons)

Defined but not yet wired. Reserved for the next round of editor
chrome redesign.

| Icon | Concept |
| --- | --- |
| `ICON_EDITOR_SPLIT` | split-pane edit + preview layout |
| `ICON_EDITOR_ZEN` | distraction-free / expand to corners |
| `ICON_EDITOR_WRAP` | soft-wrap: line returns to margin |
| `ICON_EDITOR_LINE_NUMBER` | gutter + content lines |
| `ICON_EDITOR_MINIMAP` | window + filled interior + scroll line |
| `ICON_EDITOR_PIN` | sticky / pinned |
| `ICON_EDITOR_FLOATING` | popped-out / detached panel |

These are vocabulary ahead of feature. The first time a
corresponding surface control ships, the icon is already in the
module — no detour through icon-system design.

### 1.7 Context menu vocabulary (3 icons)

Defined and partially wired. ICON_RENAME / ICON_DELETE /
ICON_ARCHIVE / ICON_PROPERTIES already cover most of the
file-tree context menu. The three remaining cover actions not
yet implemented (or implemented without a custom icon):

| Icon | Concept | Used in |
| --- | --- | --- |
| `ICON_MOVE` | "this item moves somewhere else" | (reserved) |
| `ICON_COPY` | "two of these things" | (reserved) |
| `ICON_DUPLICATE` | "this document plus a sibling" | (reserved) |

ICON_COPY and ICON_KNOWLEDGE_COLLECTION share the "two stacked
rectangles" metaphor; the difference is **number** (two vs three)
and **position** (stacked vs row). When the context-menu move /
copy / duplicate actions land, these are the icons to wire in.

### 1.8 Utility vocabulary (6 icons)

Defined but not yet wired. Toolbar and clipboard operations.

| Icon | Concept |
| --- | --- |
| `ICON_UNDO` | step backward in time (circular arrow) |
| `ICON_REDO` | step forward in time (mirror of undo) |
| `ICON_CUT` | scissors (two circles + crossing strokes) |
| `ICON_PASTE` | clipboard (body + clip) |
| `ICON_BOOKMARK` | flag / saved for later |
| `ICON_FILTER` | funnel / refine |

### 1.9 Action buttons (2 icons)

Wired into [AiComposer.vue](../../src/components/vault/AiComposer.vue).

| Icon | Used in |
| --- | --- |
| `ICON_SEND` (paper plane) | AiComposer submit button (idle state) |
| `ICON_STOP` (filled square, FILLED_ICONS) | AiComposer submit button (busy state) |

These are the only "button glyph" icons — every other action in
the codebase is a text button or uses a context-menu icon.

### 1.10 Surface-display icons (4 icons)

Toolbar slots that genuinely need the 24×24 canvas. Listed in
[SURFACE_DISPLAY_ICONS](../../src/components/vault/__tests__/icons.test.ts).

| Icon | Used in | Why surface-display |
| --- | --- | --- |
| `ICON_NAV_THEME_LIGHT` | NavBar theme toggle (sun) | Sun has 8 short rays + central circle; at 16×16 the rays clip and the circle loses its center |
| `ICON_NAV_THEME_DARK` | NavBar theme toggle (moon) | Crescent shadow needs the larger canvas to read as "moon" and not "weirdly-shaped circle" |
| `ICON_AB_GIT_HISTORY` | ActivityBar history button | Three commit dots + connecting curve needs the larger canvas to stay scannable at a glance |
| `ICON_AB_SETTINGS` | ActivityBar settings button | Gear has 12 teeth; at 16×16 they merge into noise |

The other three surface-display candidates (SEARCH, FILES, TAGS)
were deduped against ICON_SEARCH / ICON_FOLDER / ICON_TAG in
commit `115cfb7`.

## 2. The "do not confuse" map

Several icons share a metaphor or geometry and would be
interchangeable in the wrong place. This map names the
near-twins and the rule that separates them.

| Pair | Rule |
| --- | --- |
| ICON_DELETE vs ICON_DELETE_FILE | ICON_DELETE is the toolbar/menu trash (5 paths, detailed); ICON_DELETE_FILE is the AI tool-card trash (3 paths, simplified for 14px). |
| ICON_RENAME vs ICON_RENAME_FILE | ICON_RENAME is the toolbar pencil (rename by edit); ICON_RENAME_FILE is the AI tool-card rotated card (rename by relabel). Different metaphors. |
| ICON_NEW_CHAT vs ICON_AI_CONVERSATION | ICON_NEW_CHAT is a single bubble with a plus (start); ICON_AI_CONVERSATION is two overlapping bubbles (ongoing dialogue). |
| ICON_HISTORY vs ICON_AB_GIT_HISTORY | ICON_HISTORY is the Lucide-style clock (single time event); ICON_AB_GIT_HISTORY is a commit graph (multiple events connected). |
| ICON_KNOWLEDGE_GRAPH vs ICON_KNOWLEDGE_MAP | ICON_KNOWLEDGE_GRAPH is 3 nodes + 2 edges (cluster); ICON_KNOWLEDGE_MAP is 3 nodes + 1 edge (path). |
| ICON_KNOWLEDGE_COLLECTION vs ICON_KNOWLEDGE_BACKLINK | ICON_KNOWLEDGE_COLLECTION is 3 rectangles in a row; ICON_KNOWLEDGE_BACKLINK is 1 node + incoming arrow. |
| ICON_AI_REASONING vs ICON_KNOWLEDGE_GRAPH | ICON_AI_REASONING is 2 nodes + arrow (directional); ICON_KNOWLEDGE_GRAPH is 3 nodes + edges (non-directional cluster). |
| ICON_FILE_PDF vs ICON_FILE_DUPLICATE | ICON_FILE_PDF has content lines + small tag dot; ICON_FILE_DUPLICATE has no content lines + larger filled dot. |
| ICON_SEND vs ICON_NAV_THEME_LIGHT | ICON_SEND is a paper plane (action); ICON_NAV_THEME_LIGHT is a sun with rays (state). Don't reuse one for the other even at small display sizes. |

## 3. Reserved vocabularies

Some icons are defined but have no consumer. They are vocabulary
**ahead of feature** — kept in icons.ts so the first time a
corresponding UI surface ships, the icon is already in the
module.

| Vocabulary | Status | Future wiring |
| --- | --- | --- |
| Knowledge (7) | defined | backlinks panel, citation list, graph surface |
| Editor state (7) | defined | view-mode menu, editor chrome (future features) |
| Status WARNING | defined | validation errors, alert banners |
| File type (7) | defined | file tree when it shows non-md attachments |
| Context menu MOVE/COPY/DUPLICATE | defined | move/copy/duplicate actions in the file-tree menu |
| Utility UNDO/REDO/CUT/PASTE | defined | edit-history toolbar, clipboard ops |
| Bookmark / Filter | defined | future list filtering |

The risk of unused vocabulary is real — these icons could rot if
the corresponding features never ship. The exit criterion is
simple: an icon that has no consumer after one year from
introduction is a candidate for deletion (with a heads-up in
the commit message).

## 4. Filename conventions (for future surface icons)

The naming convention for icons added to icons.ts is:

```
ICON_<NOUN>            — concept name, not surface name
ICON_<ADJ>_<NOUN>      — when multiple variants exist (FILE_MD vs FILE_PDF)
ICON_<PREFIX>_<NOUN>   — for surface-specific sets (NAV_*, AB_*, AI_*)
```

When introducing a new variant of an existing concept, prefer a
qualifier (`ICON_FILE_PDF`, `ICON_AI_REASONING`) over a synonym
(`ICON_PDF_FILE`, `ICON_AI_STEP`). The icon system prefers
generality over brevity.

## 5. Wire-in checklist

When adding an icon to a consumer:

1. Import the icon from `./icons` (or `./vault/icons` from outside the vault subtree).
2. Use `v-html` to inline the SVG string. Never re-declare the `<svg>` element by hand.
3. Set `aria-hidden="true"` on the wrapping element (the icon is decorative; the surrounding text or aria-label carries meaning).
4. Set the accessible name on the surrounding button or via `aria-label` if the button has no text.
5. If the icon is in FILLED_ICONS, the test will already cover it. If you add a new filled icon, add it to the FILLED_ICONS set in [icons.test.ts](../../src/components/vault/__tests__/icons.test.ts) and add a comment in icons.ts explaining why the fill is the right metaphor.
6. If the icon uses the 24×24 surface canvas, add it to SURFACE_DISPLAY_ICONS in the test and document the rationale in icons.ts.
7. Run `npm run lint:icons` — the lint catches drift in any consumer that re-declares SVGs.

## 6. Future work

- Wire the 5 AI vocabulary icons into the AI panel (replace sparkle in tool-call headers and conversation turns).
- Wire the 7 knowledge vocabulary icons into the backlinks panel and citation list.
- Wire the 7 file-type icons into the file tree (replace the all-`ICON_FILE_MD` row when attachments appear).
- Audit FILLED_ICONS — ICON_AI_MEMORY, ICON_STATUS_SUCCESS, ICON_STATUS_MODIFIED, ICON_STOP — for cases where an outline version reads as well.
- Audit the 4 remaining SURFACE_DISPLAY_ICONS — sun, moon, git history, settings — and redraw any that survive at 16×16.

---

## Cross-references

- Spec: [docs/design/icon-system.md](./icon-system.md)
- Lint: [scripts/icon-lint.ts](../../scripts/icon-lint.ts)
- Test: [src/components/vault/__tests__/icons.test.ts](../../src/components/vault/__tests__/icons.test.ts)
- Source: [src/components/vault/icons.ts](../../src/components/vault/icons.ts)
- Preview: [src/views/IconPreviewView.vue](../../src/views/IconPreviewView.vue)
