# D6.2 Calendar Home Migration Evidence

## Status

`D6.2 = REVIEW-READY` pending independent review.

Starting HEAD: `f53b7b3ae724e1d5564cb56379accdbf5b9222e1`

This phase promotes the existing Calendar surface to the primary Diary Home presentation. It does not implement Reader or Editor Dialogs and does not change the document lifecycle.

## Scope and implementation

The existing `DiaryWorkspace` / `DiaryCalendarSurface` / `DiaryCalendar` stack remains in use. Home-specific chrome is driven by the existing `isDiaryCalendarMode` predicate, which is derived from Diary presentation eligibility and `presentationMode === 'home'`. It is not driven by Diary scope alone, so History Comparison, Working Tree Diff, and Recovery retain their precedence.

When Diary Home is primary, the Vault visually collapses FileTree, side-panel splitters, RightRail, and the document StatusBar. Their state is not mutated; leaving Home restores the normal Vault layout. Calendar remains mounted for the entire Diary scope through `v-if="isDiaryCalendarMounted"`, while Home visibility continues through presentation visibility. D5 fallback therefore exits the Home layout without synchronously unmounting the Calendar.

The Calendar surface no longer presents as a small centered card: its workspace width is expanded, outer card border/radius are removed, and day targets remain at least 44px with larger responsive desktop/tablet sizing. Existing month navigation, Today, date selection, markers, loading, empty, error, locale, theme, and local-civil-date behavior are unchanged.

## Ownership boundaries preserved

- `openDiaryDate()` and the existing tab/document lifecycle are unchanged.
- Router, route synchronization, `activePath`, tabs, and panel state are unchanged.
- No Reader Dialog, Editor Dialog, server/API, shared contract, VCalendar version, or dependency was added or changed.
- Ordinary note/archive/ledger layouts remain outside the Home-specific class.

## Test and visual evidence

The focused VaultView test asserts that Home uses the presentation class and that the Home-only CSS hides document chrome without changing the mount seam. Existing DiaryCalendar and DiaryCalendarSurface suites remain the behavioral source for date, month, marker, loading, empty, error, locale, and theme contracts.

Browser visual inspection should cover 320×700, 375×812, 768×1024, and 1280×800, including light/dark themes, English/Chinese locale, no horizontal overflow, toolbar hierarchy, and responsive day density. This document records the required evidence boundary; results must be filled from actual runs and must not be inferred from historical passes.

## Rollback seam

The migration is independently revertible: revert the D6.2 production commit and its evidence commit. The D6.0/D6.1 ownership and keep-mounted contracts remain intact.

## Phase gate

`D6.2 = REVIEW-READY`.

`D6.3 = NOT STARTED`.

