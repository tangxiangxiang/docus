# D7.3 — Calendar Integration Evidence

## Status

`REVIEW-CLOSED`

Independent Review: `PASS`

Independent Review findings: `P0 = 0`, `P1 = 0`, `P2 = 0`

Self-review findings: `P0 = 0`, `P1 = 0`, `P2 = 0`

D7.4: `NOT STARTED`

This document records the D7.3 Calendar integration implementation. It does
not start D7.4.

Post-closure Calendar UX revision: `REVIEW-READY`

Post-closure Independent Review: `PENDING`

Post-closure self-review findings: `P0 = 0`, `P1 = 0`, `P2 = 0`

The post-closure revision starts from
`7167487e4d2f89d2b5e67a0570f25efa05eac56d` and supersedes only the Calendar
Mood presentation/creation interaction described below. Historical D7.3
implementation and review records remain preserved.

## Baseline and implementation

- Starting HEAD: `5d14967e2a1de829c084cf1cc6a08ade10cdcc3c`
- Implementation commit: `e1a5b6c61373a99f42fb3b1d4af22d8805409b1e`
- Suggested commit subject: `feat(diary): integrate mood picker with calendar`

The implementation commit contains only Calendar/Mood integration code, tests,
and the focused browser regression. No closed D7 PRD or Implementation Plan
was rewritten.

## Focused remediation after the first independent review

The first independent review found two Calendar presentation findings:

1. The body-teleported Mood picker could survive a date or month context
   change while the keep-mounted Calendar was still alive.
2. The Mood action's larger hit area and duplicated Mood artwork could fully
   cover the non-interactive Mood marker, weakening the `marker != action`
   contract.

Remediation commit: `b0f8cdafcfacd7f1f2135f552ad125b6dcf606f0`

The remediation closes the picker with `restoreFocus = false` before date
navigation, before month navigation, and synchronously when Calendar Home is
about to become hidden. This is presentation cleanup only: it does not close
the backing tab, change the route, change `activePath`, or alter the existing
date command.

This was the first remediation's historical contract. The later post-closure
UX revision replaces the separate marker plus `+`/`✎` action with one sibling
Mood emoji button while preserving the non-nested DOM and the date button's
navigation ownership.

The remediation remains D7.3-only and does not start D7.4.

## Scope delivered

D7.3 adds the Calendar presentation seam for the D7.1 metadata contract and
the D7.2 native picker:

- Calendar day content shows a known Mood as the interactive Mood button
  directly below the date number.
- Unknown stored Mood values remain opaque and are represented without
  inventing a catalog asset.
- A Mood button exists only when that Diary already has a known or unknown
  Mood. Existing Diaries without Mood show no `+`/`✎` Calendar affordance.
- The Mood emoji button is a sibling of, and is never nested inside, the
  VCalendar date button.
- The date button remains the VCalendar date-navigation and
  `date-selected(DiaryDate)` owner for existing Diaries and missing future
  dates.
- The Mood button only opens the Calendar-level picker and emits a
  `mood-change(DiaryDate, MoodId | null)` intent; it does not emit a date
  navigation event.
- A missing today/past date opens the Mood picker before creation. Escape,
  explicit close, or outside-pointer dismissal creates no Diary. A successful
  selection delegates to the existing date command, obtains fresh bulk CAS,
  writes Mood through `useDiaryMoodCommand`, and only then presents the native
  Diary document.
- Missing future dates keep the existing date-command guard and do not enter
  the writable Mood-first flow. Existing future Diaries retain ordinary open
  and native Mood editing behavior.
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

VaultView remains the mutation owner. For a missing today/past date, Mood
selection starts one presentation intent, uses the existing `openDiaryDate()`
command to establish the canonical backing document, refreshes/reads the
current `metadataUpdatedAt`, delegates the write to
`useDiaryMoodCommand.setMood()`, and transitions from Calendar Home to the
native document only after that mutation succeeds. Calendar components still
own no API, route, tab, create, or metadata authority. Existing Diary Mood
selection, including an existing future Diary, does not navigate or create.

An existing managed Diary day without a valid metadata version is disabled for
Mood mutation rather than guessed or updated without CAS. Clear is not offered
for a missing day.

## DOM and accessibility boundary

The VCalendar-provided `dayProps` and `dayEvents` are bound to the date button.
The Mood emoji is a sibling button, so `button` elements are not nested and a
Mood click cannot accidentally invoke date navigation. Date and Mood hit areas
remain distinct even though they read visually as `date` over `emoji`. The
date button's accessible name includes Diary and known/unknown Mood information
where available. The Mood button has a date-specific accessible label,
`aria-haspopup`, and `aria-expanded` state.

Calendar cells have no hover background, selection background/frame, or
visible blue existence dot. Mouse focus leaves no persistent decoration.
Keyboard-only `:focus-visible` outlines remain for both date and Mood buttons.

The existing D7.2 picker remains the single 24-option, four-column by six-row
radio grid with keyboard movement, focus-visible treatment, Enter/Space
selection, Escape close, clear, and the established responsive Teleport
positioning. Calendar integration does not add a second registry or picker
implementation.

## Post-closure UX revision validation

The revision is covered by the final production contract rather than source
shape alone:

- component/Vault focused validation: **3 files, 67 tests passed**;
- Calendar + responsive browser validation: **16 tests passed**;
- full unit/integration validation: **235 files, 3521 tests passed, 2
  skipped**;
- client, server, and aggregate typecheck: **PASS**;
- production build: **PASS**.

Browser coverage proves that an existing Diary without Mood has no Calendar
Mood button; an existing Mood emoji opens the one picker without navigation;
missing today/past cancellation creates nothing; successful Mood-first intent
creates, writes Mood, and presents the native Diary; missing future remains a
no-op; blue dots and hover backgrounds are not visually rendered; and the
picker remains responsive without covering month navigation.

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

Original implementation result: **10 test files, 124 tests passed**.

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

Focused remediation result: **10 test files, 125 tests passed**. The added
component regression opens the Teleport picker and then changes both the date
and the month, proving that the old picker context is cleared before either
Calendar transition completes. It also verifies that the known marker remains
inside the date button and that the action uses the separate edit affordance.

Calendar browser regression:

```text
npm exec -- playwright test e2e/diary-calendar-surface.spec.ts
```

Original implementation result: **4 tests passed**.

Focused remediation result: **8 tests passed**. In addition to the original
coverage, the browser suite now verifies:

- picker open → existing Diary date navigation closes the picker before the
  Calendar Home is hidden;
- picker open → month navigation closes the picker;
- missing today and past dates use the existing `openDiaryDate()` command and
  create exactly through the existing Diary-date endpoint;
- a missing future date remains uncreated and the picker remains available
  until the user closes it; and
- known marker/action bounding boxes are disjoint at 1280px, 375px, and
  320px widths.

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

Current remediation result: **235 test files passed; 3519 tests passed; 2
skipped**. The first
sandboxed attempt was limited by local `listen EPERM` errors in unrelated
HTTP/IPC crash-fixture tests; the same command was rerun with the repository's
permitted elevated local test environment and passed. This is not a feature
failure.

Typecheck and build:

- `npm run typecheck:client` — PASS
- `npm run typecheck` — PASS (client and server)
- `npm run build` — PASS

`git diff --check` before the implementation commit: PASS.

## Review history

Initial Independent Review: **FAIL** (`P0 = 0`, `P1 = 2`, `P2 = 0`):

- P1: keep-mounted Calendar context changes could leave a stale body-teleported
  picker open;
- P1: the Mood action could visually and geometrically occlude the non-
  interactive marker.

Focused remediation self-review: **PASS** (`P0 = 0`, `P1 = 0`, `P2 = 0`).

Independent re-review: **PASS** (`P0 = 0`, `P1 = 0`, `P2 = 0`).

The re-review closed both remediation findings: the Teleport picker now closes
before Calendar date/month or Diary Home presentation transitions, and the
Mood action no longer overlaps the non-interactive marker. D7.3 is closed by
the subsequent docs-only closure sync; no D7.4 work is included.

GitHub CI #532 was not green at the time of review: visual, docker-smoke,
tags-scale, and auth-browser had passed; Ubuntu 24/22 and macOS 24 verification
jobs were still running; and Windows 24 verification had failed during the
full-unit stage after typecheck and build had passed. The failure details were
not available in this review, so CI #532 is not recorded as PASS and is not
used as the D7.3 closure proof.

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

The focused remediation commit changed five files: the Calendar adapter,
VaultView presentation wiring, their focused tests, and the Calendar browser
regression. It did not change server/shared contracts, the Mood registry,
Calendar projection, Reader/Editor lifecycle, package manifests, lockfiles, or
dependencies.

## Lifecycle state

```text
D7 PRD                  = REVIEW-CLOSED
D7 Implementation Plan = REVIEW-CLOSED
D7.0A                  = REVIEW-CLOSED
D7.0                   = REVIEW-CLOSED
D7.1                   = REVIEW-CLOSED
D7.2                   = REVIEW-CLOSED

D7.3                   = REVIEW-CLOSED
D7.3 Independent Review = PASS (`P0 = 0`, `P1 = 0`, `P2 = 0`)
D7.3 post-closure UX revision = REVIEW-READY
D7.3 UX revision Independent Review = PENDING

D7.4                   = NOT STARTED
D7 Mood production     = NOT STARTED
```

## Readiness and stop conditions

The D7.3 implementation and focused remediation are closed after independent
re-review. The implementation stopped at the Calendar integration boundary: no
D7.4 work, no mood statistics, no custom catalog changes, no new lifecycle, and
no new route/API were added.

The independent re-review covered the real browser behavior for existing and
missing dates, CAS rejection/refresh behavior, unknown Mood preservation, the
single-picker boundary, no-N+1 projection, and keep-mounted VCalendar
compatibility.

GitHub status: **queried; CI #532 was not green at review time and is not a
closure PASS**.
