# D6.2.1 Full-Bleed Calendar Polish Evidence

## Status

D6.2 = REVIEW-CLOSED
D6.2.1 = REVIEW-READY pending independent review
D6.3 = NOT STARTED

Independent review is required for D6.2.1. This is a post-closure presentation follow-up; it does not reopen D6.2 or start D6.3.

Starting HEAD: c2d9e6a8310af10597e421fcb89661e4dd53db4e
Production commit: b24a02bf1bf2d33f16a38388d65f4746e90703fc

## Scope

The Calendar Home was simplified into a full-bleed workspace surface. The visible Diary page heading and standalone Today toolbar were removed. Today remains a button inside the Calendar host's navigation band. The surface-inner centered/max-width wrapper and outer Calendar card treatment were removed.

No Diary command, routing, tab, document, scope, save, dirty, server, shared, VCalendar dependency, or lifecycle ownership changed.

## Structure and semantics

- diary-calendar-surface-header and the visual Diary heading: removed.
- diary-calendar-toolbar: removed.
- Today: preserved as data-testid=diary-calendar-today, button, accessible label, and keyboard target.
- goToToday() semantics: unchanged; it moves to localCivilToday() and emits date-selected(today).
- Prev/Next and month-change: still owned by VCalendar.
- Surface role=region and aria-label: preserved.
- loading role=status, error role=alert, and empty role=status/aria-live: preserved.
- Calendar mount predicate: unchanged and remains isDiaryScope.

Today is positioned inside diary-calendar-host in the same visual header band as VCalendar's month navigation. The current VCalendar 3.1.2 DOM was inspected: its root arrow header is .vc-pane-header-wrapper, its month title is .vc-pane .vc-header, and its grid is .vc-weeks/.vc-week. The implementation uses those rendered classes only for presentation sizing and stacking; it does not patch node_modules or reimplement month state.

## Full-size layout

The height chain is now flex-based:

Vault editor area
-> diary-calendar-content
-> DiaryWorkspace / Diary Home
-> diary-calendar-surface
-> DiaryCalendar
-> diary-calendar-host
-> vc-container
-> vc-pane-container / vc-pane-layout
-> vc-pane
-> vc-weeks
-> vc-week rows

Each owned layer has width/height propagation and min-width/min-height: 0. No 100vh sizing is used. The VCalendar container is borderless, transparent, full-size, and has no outer border, radius, or shadow. Desktop/tablet week rows flex to the available height; mobile keeps a 44px minimum row/day target rather than stretching dates excessively. No week count was hardcoded or synthesized.

Empty, loading, and error messages are compact overlays and do not reserve a permanent row or replace/unmount Calendar.

## Actual browser geometry evidence

The combined Playwright run completed 10/10 PASS:

- e2e/diary-calendar-surface.spec.ts: 3/3 PASS.
- e2e/diary-release.spec.ts: 6/6 PASS.
- e2e/vcalendar-compatibility.spec.ts: 1/1 PASS.

The responsive geometry test exercised 1280x800, 768x1024, 375x812, and 320x700. At every viewport it measured surface, Calendar, host, and vc-container rectangles and passed these non-brittle thresholds:

- host width >= 95% of surface width.
- vc-container width >= 95% of host width.
- host height >= 90% of surface height.
- vc-container height >= 90% of host height.
- document horizontal scroll width did not exceed the viewport.

The same test confirmed at every viewport that the old surface header and toolbar are absent, Today and the month title are visible, prev/next and day targets are usable, and FileTree/RightRail/StatusBar remain hidden only under the existing Diary Home presentation policy.

## Calendar/browser regressions

- Today browser flow: PASS through the existing Diary Home keyboard/date flow; Today remains usable and enters the existing date intent path.
- Previous/next month: PASS.
- Existing Diary date click and D5 document fallback: PASS; Calendar becomes hidden while remaining attached, and returns after the backing tab closes.
- Missing future date: PASS browser-visible no-op.
- Repeated existing date open/close: PASS for five repetitions.
- Marker create/delete: PASS.
- pageErrors: [] and unexpected consoleErrors: [] in the diagnostic-covered browser tests.
- VCalendar dayIndex regression: none observed; exact-stack compatibility browser test PASS.

Light/dark and en-US/zh-CN behavior passed in the exact-stack VCalendar browser compatibility test and in the focused Diary Calendar integration tests. Month titles and weekday layout remained usable after locale/theme toggles.

## Focused validation

- Focused Vitest: 5 files, 63/63 tests PASS.
- npm run typecheck:client: PASS.
- npm run build: PASS. Existing non-blocking Vite annotation/chunk warnings remain.
- git diff --check: PASS.
- Worktree after validation: clean.
- Dependencies and lockfiles: unchanged.

Existing History/Diff/Recovery precedence, hidden-workspace keyboard contract, panel-state preservation, ordinary note/archive/ledger layout boundary, local civil Date semantics, Diary markers, and openDiaryDate contract remain unchanged.

## Rollback

### Production rollback

Revert only:

b24a02bf1bf2d33f16a38388d65f4746e90703fc — style(diary): make calendar home full bleed

This restores the closed D6.2 Calendar Home presentation. It does not require reverting D6.2, D6.1, Diary data, routes, tabs, server state, or dependencies.

### Documentation rollback

The separate D6.2.1 evidence commit can be reverted independently if the evidence/history needs to return to its pre-follow-up state. Documentation rollback is not part of the production runtime rollback chain.

## Handoff

D6.2 remains REVIEW-CLOSED.
D6.2.1 = REVIEW-READY pending independent review.
D6.3 = NOT STARTED.

No Reader Dialog, Editor Dialog, modal, focus trap, D6.3 command, or D6.3 implementation was started.
