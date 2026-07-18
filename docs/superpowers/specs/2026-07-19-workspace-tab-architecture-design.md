# Workspace Tab Architecture — Design Spec

**Date:** 2026-07-19
**Status:** Proposed
**Scope:** Edit-08 — extract the interaction state machines from `EditorTabs.vue` without changing Workspace Tab behavior.
**Baseline:** Edit-07 is behaviorally complete at `9afb4e1`.

## 1. Motivation

Edit-07 began as presentation and save-state polish, then grew to cover the complete
Workspace Tab experience: tooltip lifecycle, context-menu actions, mixed-tab closing,
path operations, pointer and keyboard reordering, persistence, focus recovery, and
rename safety.

The resulting behavior is correct and covered by regression tests, but
`EditorTabs.vue` now owns several independent interaction state machines:

- tab rendering and `TabUiPresentation`;
- tooltip visibility and viewport positioning;
- context-menu targeting, positioning, keyboard navigation, and global listeners;
- pointer drag/drop, keyboard reorder, synthetic-click suppression, and auto-scroll;
- focus restoration and live-region announcements.

At the Edit-08 baseline the component is about 742 lines and its component test is
about 1,479 lines. Adding more behavior directly to the component would increase the
chance that a change to one state machine regresses another.

Edit-08 is therefore an architecture-only phase. It makes the existing behavior
easier to reason about and test before any new Workspace Tab feature is considered.

## 2. Goals and Non-Goals

### Goals

- Make `EditorTabs.vue` primarily responsible for rendering tabs and wiring DOM
  events to composables.
- Give tooltip, menu, reorder, and focus behavior explicit ownership boundaries.
- Preserve every Edit-07 user-visible behavior and event payload.
- Preserve the existing `WorkspaceTab`, `WorkspaceTabReorderRequest`, and
  `TabUiPresentation` contracts.
- Keep listener, timer, `nextTick`, and animation-frame cleanup local to the
  composable that creates the resource.
- Move detailed interaction tests to focused suites while retaining small
  component-level wiring tests.
- Keep each extraction independently reviewable and revertible.

### Non-Goals

- No new tab features, menu entries, shortcuts, or visual states.
- No pinned tabs, groups, multi-row tabs, split windows, or cross-window dragging.
- No changes to Workspace ordering semantics or persistence format.
- No changes to close confirmation, save barriers, fallback selection, or focus
  policy.
- No changes to document save, external-conflict, polling, restore, or rename
  protocols.
- No service or API changes and no new dependency.
- No migration of temporary History/Diff order to persistent storage.
- No rewrite of `workspaceTabOrder.ts`; it remains the pure ordering layer.

## 3. Behavior Freeze

The Edit-07 baseline is the contract for this refactor. In particular:

1. Tooltip text, tab text, and `aria-label` continue to derive from the same
   `TabUiPresentation`.
2. Tooltip and context menu remain mutually exclusive.
3. Right-clicking a non-active tab does not select it.
4. Menu close operations continue to emit intent only; `VaultView` and the
   Workspace close coordinators remain the only mutation owners.
5. Dirty confirmation remains all-or-nothing for mixed Document, History, and Diff
   batches.
6. Menu actions restore focus before a confirmation can activate its focus trap.
7. Successful close operations leave focus on the active or fallback tab, or on
   the Vault when no tab remains.
8. Clipboard fallback restores its prior focus.
9. Pointer and keyboard reorder preserve active-tab state and use the complete
   visual Workspace order.
10. Drag payload, signature, generation, rename, and tab-set validation remain
    fail-closed.
11. `Ctrl/Cmd+Tab`, `Ctrl/Cmd+Shift+Tab`, `Ctrl/Cmd+W`, close-left/right, and close
    fallback continue to use the current visual order.
12. Document order continues to flush synchronously to the existing v1 tab
    persistence structure; History and Diff remain session-only.
13. External rename remains transactional and preserves dirty targets, current
    order, and user-directed focus.

Any extraction that changes one of these behaviors is not part of Edit-08 and must
be reverted or proposed separately.

## 4. Target Structure

```text
src/composables/vault/workspace-tabs/
├── useWorkspaceTabTooltip.ts
├── useWorkspaceTabMenu.ts
├── useWorkspaceTabReorder.ts
├── useWorkspaceTabFocus.ts
└── __tests__/
    ├── useWorkspaceTabTooltip.test.ts
    ├── useWorkspaceTabMenu.test.ts
    ├── useWorkspaceTabReorder.test.ts
    └── useWorkspaceTabFocus.test.ts
```

Existing pure modules keep their current ownership during the extraction:

```text
src/composables/vault/editor-tabs/tabPresentation.ts
src/components/vault/workspaceTabOrder.ts
```

Moving `tabPresentation.ts` to `workspace-tabs/` is optional cleanup after all
interaction extractions are complete. It must be a mechanical move with no
presentation changes.

## 5. Ownership Boundaries

### 5.1 `EditorTabs.vue`

The component continues to own:

- props, emits, and the public `focusTab(id)` method;
- tab and menu markup, Teleports, CSS classes, and ARIA bindings;
- mapping DOM events to composable commands;
- rendering `TabUiPresentation`;
- emitting `select`, `close`, `close-many`, `copy-path`, `reveal-in-tree`, and
  `reorder`.

It must not:

- mutate `props.tabs`;
- mutate Workspace order or persistence;
- close tabs directly;
- inspect raw save-state fields instead of presentation;
- own document/window listeners, timers, or animation frames that belong to an
  extracted interaction.

### 5.2 `useWorkspaceTabTooltip`

Owns:

- active tooltip tab ID and style;
- hover/focus show and mouseleave/blur hide rules;
- Escape, click, middle-click, context-menu, active-tab-change, tab-removal, and
  unmount lifecycle;
- first-pass positioning and post-render real-rect viewport clamping;
- stable tooltip IDs and `aria-describedby` state;
- suppression while dragging.

Inputs are readonly tab IDs/presentations, active ID, element lookup callbacks, and
a readonly drag-active signal. The composable does not emit tab actions.

### 5.3 `useWorkspaceTabMenu`

Owns:

- menu target and source element;
- visible state, generation, position, and roving item index;
- exact menu item ordering and disabled-state calculation;
- mouse and keyboard opening;
- ArrowUp/Down, Home, End, Enter, Space, Escape, and Tab behavior;
- outside pointer, external scroll, resize, active-tab-change, tab-signature-change,
  and unmount cleanup;
- real-rect viewport clamping;
- synchronous source-focus preparation before an action callback.

The composable returns user intents; it never mutates tabs or calls close
coordinators. Path operations use `WorkspaceTab.documentPath`, with the existing
Document-ID compatibility fallback only.

### 5.4 `useWorkspaceTabReorder`

Owns:

- dragged ID, drag-start signature, drop target, and before/after position;
- project MIME validation and internal-source validation;
- `dragging`, `drop-before`, and `drop-after` presentation state;
- pointer auto-scroll and its single animation-frame loop;
- close-button drag blocking;
- synthetic-click suppression;
- keyboard move requests and live-region announcements;
- cleanup on drop, dragend, cancellation, signature change, rename, and unmount.

The composable may use the pure functions in `workspaceTabOrder.ts`, but only emits a
complete `WorkspaceTabReorderRequest`. It never changes order itself.

### 5.5 `useWorkspaceTabFocus`

Owns component-local DOM focus helpers:

- find a tab element by Workspace ID;
- expose `focusTab(id)`;
- restore focus only when the expected source still owns focus;
- provide the small focus primitives shared by menu and keyboard reorder.

Workspace close and rename focus policy stays in `VaultView`; this composable does
not select a tab or decide fallback order.

## 6. API Design Rules

- Inputs that represent tabs or IDs are `Readonly`/`readonly`.
- DOM dependencies are passed as refs or narrow callbacks rather than queried
  through global selectors where practical.
- Composables expose state as readonly refs and mutation through named commands.
- Callbacks that can await `nextTick()` or focus restoration return `Promise<void>`.
- Each global listener uses a stable handler and is installed at most once.
- Each deferred callback uses a generation or disposed check before touching state.
- Each `requestAnimationFrame` owner keeps a single frame ID and cancels it on every
  terminal path.
- Composables do not call each other through hidden module state. Coordination is
  explicit in `EditorTabs.vue` (for example, starting drag first closes tooltip and
  menu).
- Existing emitted payloads remain unchanged so `VaultView` does not need a
  behavior change.

## 7. Implementation Sequence

### Edit-08.1 — Seal and document

- Run `npm test`, `npm run typecheck`, and `npm run build`.
- Record this architecture and behavior-freeze specification.
- Create a standalone Edit-07 closure commit.
- Do not move production code.

### Edit-08.2 — Extract tooltip

Tooltip is first because it has the narrowest output surface and no mutation intent.

- Characterize current tooltip behavior with focused tests before moving code.
- Extract state, positioning, and lifecycle cleanup.
- Keep the component markup and presentation rendering unchanged.
- Retain a small component wiring suite for DOM/ARIA integration.

Exit condition: tooltip behavior is independently tested and `EditorTabs.vue` no
longer owns tooltip listeners or positioning.

### Edit-08.3 — Extract context menu

- Characterize focus-trap timing, menu generation, internal scrolling, and stale-tab
  invalidation.
- Extract menu state, positioning, keyboard navigation, and listener lifecycle.
- Keep menu action emits and close coordination unchanged.
- Preserve one-menu-only Teleport and all ARIA roles.

Exit condition: menu actions are independently tested as intents and the existing
`EditorTabs + ConfirmHost` focus integration tests remain green.

### Edit-08.4 — Extract reorder

- Characterize pointer-source blocking, payload/signature validation, synthetic
  click suppression, and auto-scroll.
- Extract pointer and keyboard interaction state.
- Keep pure order algorithms in `workspaceTabOrder.ts`.
- Keep parent revalidation, persistence, fallback, and active-ID behavior unchanged.

Exit condition: reorder state and cleanup are independently tested, while
`EditorTabs.vue` only binds drag/keyboard events and emits validated requests.

### Edit-08.5 — Consolidate focus and split tests

- Extract only the focus primitives that are still duplicated after menu/reorder
  extraction.
- Move detailed scenarios from `EditorTabs.test.ts` to composable suites.
- Retain component tests for rendering, emits, Teleport/ARIA wiring, and a small
  number of cross-composable regressions.
- Optionally move `tabPresentation.ts` as a final mechanical change.

Exit condition: no loss of regression coverage, and the component test describes
component wiring rather than re-testing every state-machine branch.

## 8. Test Strategy

Every extraction uses a characterize-first approach:

1. Identify the exact current behavior in `EditorTabs.test.ts`.
2. Add or move the equivalent focused composable test.
3. Extract the implementation without changing assertions.
4. Keep at least one component-level integration test for each interaction.
5. Run the focused suite, all Workspace/Vault tests, and the full quality gate.

Proposed focused suites:

- `useWorkspaceTabTooltip.test.ts`: lifecycle, viewport clamping, stale generations,
  tab removal, active change, and drag suppression.
- `useWorkspaceTabMenu.test.ts`: target calculation, keyboard navigation, focus
  preparation, global-listener cleanup, menu scrolling, and viewport clamping.
- `useWorkspaceTabReorder.test.ts`: MIME/signature validation, pointer moves,
  keyboard moves, close-button blocking, synthetic clicks, classes, announcements,
  and single-loop auto-scroll.
- `useWorkspaceTabFocus.test.ts`: element lookup, connected-element checks, and
  expected-focus preservation.
- `EditorTabs.test.ts`: presentation rendering, core emits, public `focusTab`, basic
  ARIA/Teleport wiring, and cross-interaction exclusions.

The full gate for every Edit-08 sub-step is:

```bash
npm test
npm run typecheck
npm run build
```

`npm run lint:icons` is also required when a touched file contains or imports icons.

## 9. Review and Rollback Boundaries

Each extraction is a separate commit. A commit must not combine:

- movement of more than one interaction state machine;
- production extraction and unrelated behavior changes;
- test-file splitting and feature additions;
- presentation migration and save/close/rename changes.

If an extraction reveals that the current behavior is incorrect, record the issue
separately. Finish or revert the behavior-preserving extraction before fixing the
behavior in its own reviewed change.

Useful review signals:

- lower `EditorTabs.vue` line count is desirable but not itself an acceptance
  criterion;
- event payloads, DOM order, focus destination, and listener counts are acceptance
  criteria;
- a composable is not complete if its consumer must still know how to clean up the
  composable's listeners, timers, or animation frames.

## 10. Acceptance Criteria

Edit-08 is complete when:

- all Edit-07 behavior-freeze items remain true;
- Tooltip, menu, reorder, and focus logic have explicit, independently tested
  owners;
- `EditorTabs.vue` is primarily markup and event wiring;
- no extracted composable mutates tabs, persistence, router state, save state, or
  close state;
- no global listener, timer, deferred callback, or animation frame survives
  component unmount;
- `EditorTabs.test.ts` is materially smaller and focused on integration;
- no third-party dependency or persistence migration is introduced;
- the full test, typecheck, and build gates pass after every extraction.

## 11. Follow-Up Boundary

Edit-09 (Unsaved Draft Recovery) and Edit-10 (Live AI Context) are separate product
features. Neither begins until Edit-08 is complete, and neither should be used to
justify changes to Workspace Tab interaction behavior during this refactor.
