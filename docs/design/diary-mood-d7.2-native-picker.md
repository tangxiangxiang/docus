# D7.2 — Native Diary Context and 4×6 Mood Picker

## Status

**D7.2 = REVIEW-READY**

This document records the D7.2 implementation and validation evidence. It is
not the independent review closure record.

- Starting HEAD: `b5794392ed5dae8235ea4018f443ff89d2b35a89`
- Implementation commit: `1f8148d187e6268d3a7c6088e1150b11de203ea7` (`feat(diary): add native mood context and picker`)
- Independent Review: `PENDING`
- Self-review: `P0 = 0`, `P1 = 0`, `P2 = 0`
- D7.1: `REVIEW-CLOSED`
- D7.3: `NOT STARTED`
- D7.4: `NOT STARTED`

The final docs-only evidence commit is the child of the implementation
commit above. No D7.3 work is included in this phase.

## Scope

D7.2 adds the Native Vault document context for Mood Diary and one shared
controlled picker. It supports setting, changing, and clearing the Mood
metadata of an already-open canonical managed Diary document.

The implementation does not add Calendar markers or actions, missing-date
creation, a Diary route, a Diary-specific Reader or Editor, a second document
lifecycle, or a second persistence owner.

## Files changed

Production presentation and wiring:

- `src/components/diary/DiaryMoodPicker.vue`
- `src/components/diary/DiaryMoodContextAction.vue`
- `src/components/diary/diaryMoodContext.ts`
- `src/views/VaultView.vue`
- `src/components/vault/EditorTabs.vue` — generic `context-actions` slot only
- `src/composables/useI18n.ts`
- `src/style.css`

Tests and browser evidence:

- `src/components/diary/__tests__/DiaryMoodPicker.test.ts`
- `src/components/diary/__tests__/DiaryMoodContextAction.test.ts`
- `src/components/diary/__tests__/diaryMoodContext.test.ts`
- `src/components/vault/__tests__/EditorTabs.test.ts`
- `src/views/__tests__/VaultView.test.ts`
- `e2e/diary-editor-lifecycle.spec.ts`

No server, shared domain, migration, dependency, Calendar, ReaderPane, or
EditorPane file was changed by D7.2.

## Ownership and integration

`VaultView` owns the Native Diary context projection and the single mutation
entry point. `EditorTabs` exposes only a generic optional slot; it does not
import Diary code, classify paths, or own Mood state. The slot is outside the
tablist, so the context action is a document-context action rather than a
workspace tab.

The single mounted context is shared by both native presentation branches:

```text
VaultView
├── EditorTabs
│   └── one generic context-actions slot
│       └── one DiaryMoodContextAction
│           └── one DiaryMoodPicker when open
├── ReadingPane
└── EditorPane
```

READ/EDIT toggling therefore reuses the same context action, picker state, and
authoritative Mood projection. Neither `ReadingPane` nor `EditorPane` owns a
Mood control.

The current value is projected from the existing reactive `posts` summary
whose path equals the existing `activeTab.path`. D7.2 does not introduce a
`ref` or cache for the current Mood. Local `open`, `focusedIndex`, and `busy`
values are presentation state only.

## Native Diary eligibility

The context resolver returns a value only when all of the following hold:

1. An active document tab exists and is not loading or in an error state.
2. Its path is classified by `classifyDiaryPath()` as `managed`.
3. `diaryDateFromPath()` returns the canonical `DiaryDate`.
4. The existing `posts` summary for that exact path is available.
5. Diary Calendar Home, History Comparison, Working Tree Diff, and Draft
   Recovery are not the active surface.

This excludes ordinary Notes, Inbox, Literature, Archive, Ledger, Diary root,
unmanaged/invalid/nested Diary paths, missing tabs, and special surfaces.
Calendar Home has no Native Mood control. A missing Diary is not created by
this context; a command `not-found` result only reports and refreshes through
the existing safe path.

## Canonical Mood registry

The picker consumes the single D7.1 registry in `shared/diaryMood.ts`. No
second catalog or filename map was added.

The canonical row-major order is fixed at four columns by six rows:

| Row | Column 1 | Column 2 | Column 3 | Column 4 |
| --- | --- | --- | --- | --- |
| R1 | `kiss` | `sad` | `surprised-big` | `surprised-small` |
| R2 | `watching` | `like` | `laughing` | `disappointed` |
| R3 | `afraid` | `shy` | `happy` | `smiling` |
| R4 | `amazed` | `angry` | `flirty` | `speechless` |
| R5 | `dizzy` | `indignant` | `frowning` | `mysterious` |
| R6 | `laughing-tears` | `playful` | `unwell` | `devilish` |

`happy` is R3C3. The DOM renders exactly 24 radios in this order and uses a
fixed `grid-template-columns: repeat(4, minmax(0, 1fr))`. There is no
transpose, auto-fit, pagination, or infinite scrolling. The compact CSS only
reduces padding, icon size, and gaps; it never changes the four-column
contract.

Each registry entry supplies its stable ID, Chinese and English labels,
accessible name, row/column position, and canonical `public/emoji/*.svg`
asset. The UI derives a runtime `/emoji/*.svg` URL. Persisted metadata carries
only the stable Mood ID, never an asset path or Chinese filename.

## Picker behavior

The picker is a controlled presentation component:

- The grid has `role="radiogroup"` and exactly 24 `role="radio"` buttons.
- Every radio has `aria-checked`, an accessible name, and a stable Mood ID.
- The separate Clear action is a button, not a 25th radio.
- A canonical current Mood is selected and initially focused.
- `null` shows an explicit Not set state, leaves every radio unchecked, and
  starts focus at R1C1.
- An unknown stored Mood is preserved and shown as Unknown; all canonical
  radios remain unchecked. Only an explicit canonical selection or Clear can
  replace it.
- Clear is enabled for an unknown value and emits the metadata clear intent;
  it is disabled for `null`.
- There is no default Mood.

Keyboard behavior uses roving tabindex:

- Right/Left move by `+1`/`-1`.
- Down/Up move by `+4`/`-4`.
- Edges use deterministic clamping.
- Arrow keys only move focus and never submit a mutation.
- Enter and Space select the focused canonical Mood.
- Escape closes without mutation.
- Opening focuses the selected radio or R1C1; Escape and successful local
  close return focus to the trigger.

Busy state prevents another mutation and keeps the picker close/Escape path
available. Outside pointer close is also presentation-only.

## Metadata mutation boundary

`VaultView` creates the one `useDiaryMoodCommand()` instance for this
document-context action and reuses the existing `historyMutationLock`.

Set, change, and clear all call:

```text
useDiaryMoodCommand.setMood(
  current DiaryDate,
  MoodId | null,
  current PostSummary.metadataUpdatedAt,
)
```

The CAS token is read from the current authoritative summary. If it is
missing, non-safe, or invalid, the trigger is disabled and no mutation is
submitted. No guessed version, `Date.now()`, raw mtime, or picker-local token
is used.

On success, the server-returned `DocumentMetadata` follows the existing
authoritative update path:

```text
onMetadataSaved(metadata)
→ applyMetadataToPostSummary(post, metadata)
→ applyPostSummary(updated)
→ existing refresh/link-index synchronization
```

There is no optimistic Mood assignment and no direct `posts[index].mood`
write. A conflict or not-found response leaves the raw document, tab, route,
active path, and dirty state alone, then uses the existing refresh seam to
reconcile authoritative metadata. Other errors keep the current projection
and report through the existing toast mechanism.

## Native document invariants

The Mood path is metadata-only:

- It does not call the Diary date creation command.
- It does not call the body save pipeline.
- It does not alter `raw`, `originalRaw`, Monaco model contents, or dirty
  state.
- It does not create or close a tab, change tab order, change `activePath`,
  navigate the router, or change view mode.
- It does not create a Mood draft, Mood Recovery path, or Mood History path.
- An existing managed future Diary document is eligible; missing-date
  Calendar orchestration remains D7.3.

The browser regression creates a managed Diary, sets `happy` in READ, enters
the native EDIT surface, makes the body dirty while autosave is intentionally
aborted, changes the Mood to `sad`, and verifies that the server raw remains
the base body, the stable document identity is unchanged, and the tab remains
dirty. The same context action remains the only instance in both branches.

## Validation evidence

The following commands were run for this implementation:

```text
npm exec vitest run \
  src/components/diary/__tests__/DiaryMoodPicker.test.ts \
  src/components/diary/__tests__/DiaryMoodContextAction.test.ts \
  src/components/diary/__tests__/diaryMoodContext.test.ts \
  src/components/vault/__tests__/EditorTabs.test.ts \
  src/views/__tests__/VaultView.test.ts \
  src/composables/diary/__tests__/useDiaryMoodCommand.test.ts
→ 6 files passed, 98 tests passed

npm run test:unit
→ 235 files passed, 3508 tests passed, 2 skipped

npm exec -- playwright test e2e/diary-editor-lifecycle.spec.ts
→ 8 tests passed

npm run typecheck:client
→ PASS

npm run typecheck
→ PASS

npm run build
→ PASS
```

The first restricted-environment attempt at the full unit suite reported
only existing child TCP/tsx IPC `listen EPERM` failures; the same suite was
rerun with the allowed environment permission and passed as recorded above.
The browser suite likewise required permission to bind its local web server;
the final 8-test run passed. No failure was a D7.2 assertion or product
behavior failure.

## Scope and lifecycle checks

- Calendar production components were untouched.
- Native Reader/Editor components were untouched.
- Server, shared Diary protocol, migrations, History, Recovery, and D7.1
  foundation were untouched.
- No package, lockfile, dependency, route, or backend API change was made.
- The generic `EditorTabs` slot contains no Diary-specific policy.
- No D7.3 marker, Calendar picker entry, or missing-date flow was started.
- GitHub status was not queried for this local implementation evidence.

## D7.2 readiness result

All D7.2 implementation gates are satisfied by the implementation and tests
above. The phase is intentionally stopped before independent review:

```text
D7.0A = REVIEW-CLOSED
D7.0  = REVIEW-CLOSED
D7.1  = REVIEW-CLOSED

D7.2  = REVIEW-READY
Independent Review = PENDING
Self-review P0/P1/P2 = 0/0/0

D7.3  = NOT STARTED
D7.4  = NOT STARTED
```

No D7.3 implementation is included in this evidence.
