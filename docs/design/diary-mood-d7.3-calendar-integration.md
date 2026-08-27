# D7.3 — Calendar Integration Evidence

## Status

`REVIEW-READY`

Independent Review: `PENDING`

Self-review findings: `P0 = 0`, `P1 = 0`, `P2 = 0`

D7.4: `NOT STARTED`

This document records the D7.3 Calendar integration implementation. It does
not close D7.3 or start D7.4.

## Baseline and implementation

- Starting HEAD: `5d14967e2a1de829c084cf1cc6a08ade10cdcc3c`
- Implementation commit: `e1a5b6c61373a99f42fb3b1d4af22d8805409b1e`
- Suggested commit subject: `feat(diary): integrate mood picker with calendar`

The implementation commit contains only Calendar/Mood integration code, tests,
and the focused browser regression. No closed D7 PRD or Implementation Plan
was rewritten.

## Scope delivered

D7.3 adds the Calendar presentation seam for the D7.1 metadata contract and
the D7.2 native picker:

- Calendar day content shows a non-interactive known Mood marker.
- Unknown stored Mood values remain opaque and are represented without
  inventing a catalog asset.
- Each in-month date has a sibling Mood action; it is never nested inside the
  VCalendar date button.
- The date button remains the VCalendar date-navigation and
  `date-selected(DiaryDate)` owner.
- The Mood action only opens the Calendar-level picker and emits a
  `mood-change(DiaryDate, MoodId | null)` intent; it does not emit a date
  navigation event.
- The Calendar owns one active `DiaryMoodPicker` presentation instance,
  teleported to `body`. It does not create one picker per cell.
- Picker selection and clear stay open until VaultView receives the
  authoritative mutation result; successful mutation closes the picker and
  restores focus to its trigger.

## Projection and data ownership

The Calendar projection consumes the existing bulk `PostSummary[]` returned by
the `useTabWorkspace.refresh()` path together with the authoritative Vault
tree. It does not call `getPost`, `listPosts`, `fetch`, or any other API from a
Calendar component.

Projection rules are:

1. Only a direct file under the exact `diary/` root whose path parses as the
   canonical `diary/YYYY-MM-DD` identity can produce a Calendar day.
2. A `PostSummary` can enrich an existing tree day, but can never create an
   orphan Calendar day by itself.
3. Mood, `metadataUpdatedAt`, and `documentId` are joined by exact canonical
   path. Unknown Mood strings are preserved unchanged.
4. Duplicate summary anomalies use the newest valid metadata version, with a
   deterministic document-id tie-breaker.

VaultView remains the mutation owner. It consumes the Calendar intent, uses
the existing `openDiaryDate()` command for a missing today/past date, leaves a
missing future date blocked by that command, and delegates the metadata write
to `useDiaryMoodCommand.setMood()` with the current
`metadataUpdatedAt` CAS value. Existing Diary files, including existing future
dates, do not cause Calendar Mood selection to navigate or create a file.

An existing managed Diary day without a valid metadata version is disabled for
Mood mutation rather than guessed or updated without CAS. Clear is not offered
for a missing day.

## DOM and accessibility boundary

The VCalendar-provided `dayProps` and `dayEvents` are bound to the date button.
The Mood action is a sibling button, so `button` elements are not nested and a
Mood click cannot accidentally invoke date navigation. The Mood marker is
visual/non-interactive; the date button's accessible name includes Diary and
known/unknown Mood information where available. The Mood action has a
date-specific accessible label, `aria-haspopup`, and `aria-expanded` state.

The existing D7.2 picker remains the single 24-option, four-column by six-row
radio grid with keyboard movement, focus-visible treatment, Enter/Space
selection, Escape close, clear, and the established responsive Teleport
positioning. Calendar integration does not add a second registry or picker
implementation.

## Calendar lifecycle and compatibility

The D5/D6 keep-mounted boundary is unchanged:

- Diary scope owns Calendar subtree mounting.
- Diary presentation owns Calendar visibility.
- Mood picker visibility is local Calendar presentation state.
- Calendar remains free of router, API, tab, raw, save, dirty, or document
  lifecycle ownership.

The existing VCalendar `day-content` seam remains in use. The implementation
does not introduce UTC conversion, `toISOString()`, `Date.UTC()`, a new
VCalendar candidate, DatePicker/range behavior, or a dependency change.

## Tests and validation

Focused Vitest command:

```text
npm exec vitest run \
  src/components/diary/__tests__/DiaryCalendar.test.ts \
  src/components/diary/__tests__/DiaryCalendarSurface.test.ts \
  src/components/diary/__tests__/diaryCalendarProjection.test.ts \
  src/components/diary/__tests__/VCalendarCompatibility.test.ts \
  src/components/diary/__tests__/DiaryMoodPicker.test.ts \
  src/components/diary/__tests__/DiaryMoodContextAction.test.ts \
  src/components/diary/__tests__/diaryMoodContext.test.ts \
  src/views/__tests__/VaultView.test.ts \
  src/composables/diary/__tests__/useDiaryDateCommand.test.ts \
  src/composables/diary/__tests__/useDiaryMoodCommand.test.ts
```

Result: **10 test files, 124 tests passed**.

The focused tests cover:

- exact tree + bulk-summary Mood projection;
- no orphan projection from summary-only content;
- unknown/null/known Mood values and deterministic duplicate handling;
- known and unknown Calendar markers;
- one Calendar-level picker and 24 options;
- sibling, non-nested date/Mood buttons;
- Mood selection/clear without `date-selected` emission;
- reactive Mood updates without Calendar remount;
- VaultView bulk-summary and existing-command/CAS wiring;
- existing D7.1/D7.2 Calendar, picker, date-command, and Mood-command
  regressions.

Calendar browser regression:

```text
npm exec -- playwright test e2e/diary-calendar-surface.spec.ts
```

Result: **4 tests passed**. The new browser case uses a real existing Diary to
verify the single picker, 24 radios, no nested buttons, Mood save and clear,
no `/api/diary/dates` request, no date navigation, unchanged `/vault` URL, and
no page/console errors.

Existing native Diary lifecycle browser regression:

```text
npm exec -- playwright test e2e/diary-editor-lifecycle.spec.ts
```

Result: **9 tests passed**, preserving D6.4/D7.2 native reading, editing,
History, Recovery, conflict, and responsive Mood-context behavior.

Full unit validation:

```text
npm run test:unit
```

Result: **235 test files passed; 3518 tests passed; 2 skipped**. The first
sandboxed attempt was limited by local `listen EPERM` errors in unrelated
HTTP/IPC crash-fixture tests; the same command was rerun with the repository's
permitted elevated local test environment and passed. This is not a feature
failure.

Typecheck and build:

- `npm run typecheck:client` — PASS
- `npm run typecheck` — PASS (client and server)
- `npm run build` — PASS

`git diff --check` before the implementation commit: PASS.

## Scope audit

The implementation commit changed 11 files:

- `e2e/diary-calendar-surface.spec.ts`
- `src/components/diary/DiaryCalendar.vue`
- `src/components/diary/DiaryCalendarSurface.vue`
- `src/components/diary/__tests__/DiaryCalendar.test.ts`
- `src/components/diary/__tests__/DiaryCalendarSurface.test.ts`
- `src/components/diary/__tests__/diaryCalendarProjection.test.ts`
- `src/components/diary/diaryCalendarAdapter.ts`
- `src/components/diary/diaryCalendarProjection.ts`
- `src/composables/useI18n.ts`
- `src/views/VaultView.vue`
- `src/views/__tests__/VaultView.test.ts`

No `server/**`, `shared/**`, Calendar dependency/version, package manifest,
lockfile, or new dependency changed. No D7.4/UI phase was started; D7.3 does
not add Mood statistics, custom icons, multi-select, or a new Reader/Editor
surface.

## Lifecycle state

```text
D7 PRD                  = REVIEW-CLOSED
D7 Implementation Plan = REVIEW-CLOSED
D7.0A                  = REVIEW-CLOSED
D7.0                   = REVIEW-CLOSED
D7.1                   = REVIEW-CLOSED
D7.2                   = REVIEW-CLOSED

D7.3                   = REVIEW-READY
D7.3 Independent Review = PENDING

D7.4                   = NOT STARTED
D7 Mood production     = NOT STARTED
```

## Readiness and stop conditions

The D7.3 implementation is ready for independent review. The implementation
stopped at the Calendar integration boundary: no D7.4 work, no mood statistics,
no custom catalog changes, no new lifecycle, and no new route/API were added.

Independent review should re-check the real browser behavior for existing and
missing dates, CAS rejection/refresh behavior, unknown Mood preservation, the
single-picker boundary, no-N+1 projection, and keep-mounted VCalendar
compatibility.

GitHub status: **GitHub status not queried**.
