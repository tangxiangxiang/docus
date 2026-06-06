# AI Panel — Design

**Date:** 2026-06-06
**Status:** Approved
**Scope:** Add a right-side AI chat panel to the vault, toggled by a new button in the NavBar. UI only — no LLM, no persistence of messages, no new dependencies.

## 1. Problem & Goal

The vault currently has a single focus surface (editor + preview) with a left rail (Files / Tags). Users have no in-vault place to interact with an AI assistant while reading or writing — a workflow gap that grows more obvious as LLM-driven editing becomes routine.

**Goal:** Reserve a right-side slot for an AI panel that:
- Mirrors the symmetry of the existing left rail (Files / Tags panel).
- Is toggled from a NavBar button, like search and view-mode are today.
- Renders a believable chat surface (header, message stream, composer) so the layout feels finished even before any LLM is wired in.
- Is wired **only as far as UI**: no network calls, no message persistence, no LLM client.

The work ships as a static skeleton. Real AI integration is a separate, future project.

## 2. Behavior (UX contract)

| # | Action | Result |
|---|---|---|
| 1 | First visit to `/vault` | AI panel is **closed** (default `aiOpen: false`). |
| 2 | Click the AI button in NavBar (currently closed) | Panel slides into the right edge; `aria-pressed="true"`; vault grid expands to include the AI column. |
| 3 | Click the AI button (currently open) | Panel closes; vault grid shrinks back. |
| 4 | Click the `×` in the AI panel header | Same as #3 (closes the panel). |
| 5 | Drag the AI splitter | AI column width changes (clamped 220–600px); persisted to `localStorage`. |
| 6 | Reload the page | `aiOpen` and `aiPanelWidth` restore from `localStorage`. |
| 7 | Switch edit ↔ read mode | Panel stays put — visible in both modes, on the right side. |
| 8 | Open/close left side panel (Files/Tags) | AI panel is independent; both can be open simultaneously, neither can be. |
| 9 | Submit a message (Enter in textarea) | No-op UI-wise; `console.debug('[ai] would send', text)` only. Shift+Enter inserts a newline. |
| 10 | Empty state (panel just opened) | One welcome bubble on the left ("Hi, I'm your AI assistant. Ask me anything about this vault."). |

## 3. Architecture

The vault's outer grid is the single source of layout truth. The AI column slots in **after** the editor column, exactly the way the left side panel slots in **before** the editor column. This is symmetric to the existing pattern, so the existing splitter + `useVaultLayout` infrastructure absorbs the new column with two additions: a new `aiOpen` boolean and a new `aiPanelWidth` number.

### 3.1 `useVaultLayout.ts` changes

Add to `DEFAULTS`:

```ts
aiOpen: false,
aiPanelWidth: 320,
```

Add to the live refs returned from `useVaultLayout()`:

```ts
const aiOpen = ref(layout.value.aiOpen)
const aiPanelWidth = ref(layout.value.aiPanelWidth)
```

Extend the existing bidirectional watchers to include `aiOpen` and `aiPanelWidth`. The `serializer.read` function must tolerate older `localStorage` payloads (missing `aiOpen` / `aiPanelWidth`) by falling back to the defaults.

Extend `vaultStyle` to pick the right column track list:

```ts
const cols = (() => {
  const left = activePanel.value ? `${sidePanelWidth.value}px 1px ` : ''
  const right = aiOpen.value ? ` 1px ${aiPanelWidth.value}px` : ''
  return `48px ${left}1fr${right}`
})()
```

Extend `startDrag`'s `which` parameter to also accept `'ai'`. In that branch, `dx = startX - ev.clientX` (right-rail drag inverts direction), and `aiPanelWidth.value = clamp(startAi - dx, 220, max)`. The `max` formula stays the same as the tree case: `min(600, rect.width - 480)`.

Add `toggleAi()` (same shape as `selectPanel`: `aiOpen.value = !aiOpen.value`).

### 3.2 New file `src/components/vault/AiPanel.vue`

Static presentational component, no props, no emits. Three vertical regions:

- **Header** (36px, matches FileTree/TagPanel headers): `[ICON_AI] AI` on the left, `[×]` close button on the right. `border-bottom: 1px solid var(--vs-border)`.
- **Message stream** (flex: 1, scrollable): a single welcome bubble on first render. Static — no message list state, no auto-scroll behavior. The welcome bubble is rendered unconditionally; we don't track "has user sent anything" because nothing is being sent.
- **Composer** (bottom, ~60px): a `<textarea>` (rows=2) + a circular `↑` send button. Enter triggers submit; Shift+Enter inserts a newline. The submit handler is local to the component and only does `console.debug`.

Empty initial messages array; one welcome entry is computed from that array (or rendered directly as a static child). Choosing to render directly keeps the file small and matches the "UI-only" intent.

### 3.3 `NavBar.vue` changes

Add a third toggle button to `nav-actions`, placed **between** `nav-search` and `mode-toggle`. The button reuses the existing `.mode-toggle` styles (same look as the read-mode toggle: 4px padding, hover background, `[aria-pressed='true']` soft-filled accent).

State: `aiOpen` is read from `useVaultLayout()` directly inside `NavBar.vue` (NavBar already calls `useScopeFilter()` the same way for chips). `toggleAi` is called from the button's `@click`.

Accessibility: `aria-pressed`, `title` ("AI panel (click to close)" / "AI panel").

### 3.4 `icons.ts` change

Add `ICON_AI` — a 14×14 sparkle (4-point star) line icon, matching the existing icon set's style (stroke 1.5, `currentColor`, `stroke-linecap: round`). Used inside the AI panel header and the NavBar button.

### 3.5 `VaultView.vue` changes

Mount the panel and a new splitter to the right of `<section class="editor-area">`:

```vue
<AiPanel v-if="aiOpen" class="ai-panel-slot" aria-label="AI assistant" />
<div
  v-if="aiOpen"
  class="splitter splitter-ai"
  role="separator"
  aria-orientation="vertical"
  title="拖动调整 AI 面板宽度"
  @pointerdown="startDrag(vaultRef!, 'ai', $event)"
/>
```

The two elements are siblings of the existing side panel / splitter / editor-area / status-bar in the outer vault grid. The grid auto-places them in the new columns that `vaultStyle` declares — no further wiring needed.

## 4. State summary

| Ref | Type | Default | Persisted? | Owner |
|---|---|---|---|---|
| `aiOpen` | `Ref<boolean>` | `false` | yes (`docus.vault.layout.aiOpen`) | `useVaultLayout` |
| `aiPanelWidth` | `Ref<number>` | `320` | yes (`docus.vault.layout.aiPanelWidth`) | `useVaultLayout` |

Single localStorage key (`docus.vault.layout`), same as the rest of the vault layout. The serializer's `read` falls back to defaults for any missing key, so users on the old shape don't see a broken panel.

## 5. Visual / interaction details

- **Header height / divider**: 36px, `border-bottom: 1px solid var(--vs-border)`. Matches the FileTree / TagPanel header so the three panels swap-read identically.
- **Message bubbles**:
  - Welcome (assistant): max-width 85%, background `--vs-bg-2`, color `--vs-text-1`, padding 8/12, border-radius 8px, bottom-left radius 2px (small "tail" feel without drawing one).
  - User (right-aligned): same shape, bottom-right radius 2px, background `--vs-accent`, color white (in both themes).
- **Composer**: `border-top: 1px solid var(--vs-border)`. Textarea background transparent, focus-within shows `--vs-accent` on the 1px outline of the send button (not the textarea itself, to keep the chrome calm).
- **Send button**: 28×28, rounded (border-radius 50%), `--vs-accent` background, white `↑` glyph; disabled (greyed) when textarea is empty.
- **No animation** for the open/close transition. The grid-template-columns change is instant; the panel appears/disappears with the column reflow. This is intentional: animation here would require keyframing the column track, which complicates the splitter math.

## 6. Out of scope

- LLM client / network call. No `@anthropic-ai/sdk` or `openai` dependency added.
- Message persistence (no IndexedDB / localStorage for chat).
- Slash-commands, file attachments, code actions, etc.
- Keyboard shortcut to open/close the AI panel. The NavBar button is the only entry point in this iteration.
- Modifying FileTree / TagPanel / EditorPane / ReadingPane behavior.

## 7. Testing

- `pnpm typecheck` passes.
- `pnpm test` (vitest, 117 tests) passes — no existing test should be touched.
- Visual smoke check via Puppeteer: with `aiOpen: true`, the panel renders on the right with the three regions; the splitter can be dragged; toggling via the NavBar button hides/shows the panel; toggling view mode keeps the panel visible; page reload preserves `aiOpen` and `aiPanelWidth`.

## 8. Implementation notes

Implemented across 10 commits. Notable deviations from the original spec:
- The `startDrag` `'ai'` branch uses `min(600, rect.width - 480)` for `max`, same as the tree case. The clamp range is `[220, max]`, matching the spec.
- The send button is disabled (`:disabled`) when the textarea is empty — a small affordance not called out in §5.
- The composer uses `<form @submit.prevent="onSend">` so Enter is captured by both `keydown` (for Shift+Enter) and form submission (defensive belt-and-suspenders).
- The NavBar AI button is `v-if="isVault"` to match the search and view-mode buttons; it never appears outside the vault.

No LLM client or message persistence was added (still in scope §6).
