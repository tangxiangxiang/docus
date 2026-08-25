# D6.1 Diary Workspace Shell Evidence

## 1. Status

```text
D6.0 = REVIEW-CLOSED
D6.1 = REVIEW-READY
D6.2 = NOT STARTED
D6.3 = NOT STARTED
```

This document records the D6.1 implementation evidence. It is ready for
independent review; it does not close D6.1 and it does not start D6.2 or D6.3.

## 2. Starting HEAD and implementation commit

```text
Starting HEAD:
1561596264b7aea5b35f0be173a2c8a06e3eaf75

Implementation commit:
95f48d314c0721a73256fd2f0b390b75a25f13bb
feat(diary): add D6 workspace shell
```

The implementation was created from a clean `main` worktree. No intervening
commit changed the D6 ownership contracts before implementation.

## 3. Scope

D6.1 establishes the Diary presentation owner and shell at the existing
`VaultView` Diary-scope seam. It does not implement a Reader Dialog, an Editor
Dialog, a new route, a second tab store, or a second document lifecycle.

The shell owns only presentation state:

- `presentationMode`: `home | reader | editor`;
- selected `DiaryDate` presentation context;
- backing logical path as a reference only;
- focus origin/return context;
- presentation eligibility and visibility.

It does not own document identity, tab state, `activePath`, route state, raw
Markdown, Monaco models, save/dirty state, draft, History, Recovery,
fileChanges, server mutations, or document close behavior.

## 4. Files changed

Implementation commit files:

- `src/components/diary/DiaryWorkspace.vue`
- `src/composables/diary/useDiaryWorkspacePresentation.ts`
- `src/views/VaultView.vue`
- `src/style.css`
- `src/components/diary/__tests__/DiaryWorkspace.test.ts`
- `src/composables/diary/__tests__/useDiaryWorkspacePresentation.test.ts`
- `src/views/__tests__/VaultView.test.ts`

This evidence document is a separate docs-only follow-up to the implementation
commit. No `server/**`, `shared/diaryProtocol.ts`, router record, package file,
lockfile, or dependency changed.

## 5. Presentation ownership

`useDiaryWorkspacePresentation()` is the single D6.1 presentation owner.
`DiaryWorkspace.vue` is its visual shell and named-slot boundary.

The shell exposes Home, future Reader, and future Editor slots. D6.1 wires only
the existing `DiaryCalendarSurface` into Home. The Reader and Editor slots are
empty extension points; no Reader or Editor implementation was added.

Presentation-only actions have no document lifecycle callback. The
`closePresentation()` primitive changes mode to `home` and keeps the backing
reference for future focus restoration. It does not navigate, close a tab, or
run dirty confirmation.

## 6. Presentation state model

```text
HOME
READER       future D6.3 slot; not wired in D6.1
EDITOR       future D6.4 slot; not wired in D6.1
```

Successful date commands in D6.1 record `selectedDiaryDate`, `backingPath`, and
`focusOrigin = calendar`, but intentionally remain in `HOME`. D6.3 will consume
the existing successful `DiaryDateCommandResult` to request Reader presentation.
No `activePath` watcher can enter Reader or Editor mode.

Failed, future, invalid, busy, and error results reset presentation context and
cannot leave a future Dialog state behind.

## 7. Diary presentation eligibility

The owner computes:

```text
diaryPresentationEligible
= activeScope === 'diary'
  && no active History Comparison
  && no active Working Tree Diff
  && no active Recovery surface
```

The ordinary Vault surface is unchanged when the scope is not Diary. The
presentation owner has no route or tab ownership input that could turn an
ordinary document selection into a Diary Dialog intent.

## 8. Non-document workspace precedence

History Comparison, Working Tree Diff, and Recovery retain primary-surface
precedence. When any one is active:

- Diary presentation is ineligible and hidden;
- Calendar remains mounted while Diary scope remains active;
- the existing special-surface owner remains responsible for its workflow;
- Diary presentation does not close, select, restore, or mutate that surface.

When the special surface clears, eligibility is re-evaluated from the current
state. The safe D6.1 default is `HOME`; a prior future Reader/Editor state is
not automatically reopened.

## 9. Calendar lifecycle and visibility

The mount predicate remains scope-only:

```text
isDiaryCalendarMounted = activeScope === 'diary'
```

`DiaryWorkspace` is mounted with that `v-if`. Its Home slot, which contains
`DiaryCalendarSurface` and the existing `DiaryCalendar`, is hidden with
`v-show`/equivalent shell visibility. A date click therefore does not
synchronously unmount the VCalendar subtree.

The normal D6 presentation target is:

```text
Diary scope
  + eligible
  + presentationMode === HOME
    -> Calendar Home visible
```

D6.1 retains one explicit, local D5 fallback while Reader is not implemented:
after a successful date command, the existing Editor surface remains primary
while its backing document path is still present in the existing document tab
list. This is not a fourth presentation mode and is not a second lifecycle.
When that backing tab disappears, Home becomes visible again. An unrelated
ordinary tab by itself does not block Diary Home.

## 10. Ordinary EditorTabs decision

When Diary Home is primary and backing ordinary document tabs exist,
`EditorTabs` remains mounted but is hidden with `v-show`; tabs, active document,
route, and `activePath` are preserved. CSS collapses the hidden tab row for the
Diary Home presentation without treating the document workspace as empty.

During the explicit D5 date-intent fallback, the existing tab strip and editor
are visible exactly as before so D3/D4 date-open behavior remains safe until
D6.3 owns the Reader transition.

No `closeTab()`, tab clearing, route replacement, or dirty confirmation is
performed by Diary presentation.

## 11. Date-intent handoff

The current command flow remains:

```text
DiaryCalendar
  -> DiaryCalendarSurface date-selected
  -> VaultView onDiaryDateSelected()
  -> existing openDiaryDate()
  -> get/create exact Diary path
  -> existing openPost()
  -> existing tab/document lifecycle
  -> DiaryDateCommandResult
```

`onDiaryDateSelected()` records the result only after `openDiaryDate()`
resolves. The public command API and its ownership are unchanged. There is no
`openDiaryReaderDate()`, `openDiaryEditorDate()`, direct Calendar API call, or
activePath-driven open path.

## 12. Scope reconciliation

```text
enter Diary scope
  -> presentation owner starts at HOME when eligible

leave Diary scope
  -> presentation resets to HOME baseline
  -> selected context is cleared
  -> no tab close, route change, or dirty confirmation

Diary scope + special surface
  -> Diary presentation yields
  -> Calendar hidden but mounted

special surface clears
  -> eligibility re-evaluates
  -> safe result is HOME, not automatic Dialog reopen
```

Note, archive, and ledger scopes do not satisfy the Diary eligibility
predicate, so they continue through the existing Vault surface conditions.

## 13. Active-path and router invariants

The presentation composable does not consume `activePath`, `useRouteSync()`, or
the router. Browser Back therefore remains:

```text
Vue Router history
  -> route/pathMatch
  -> existing useRouteSync()
  -> existing openPost()/tab reconciliation
```

There is no `popstate` interception, fake Dialog history, Diary route, router
navigation from the shell, or `activePath -> Dialog` watcher.

## 14. Focus seam

D6.1 records a typed focus origin (`calendar`, `reader`, or `editor`) and keeps
the Calendar/slot boundary stable for future focus restoration. It does not
implement a modal focus trap or complete Dialog accessibility policy; that is a
later D6 Dialog phase. Hidden Home/tab surfaces use `display: none` through
`v-show`, so their controls are not keyboard reachable while hidden.

## 15. VCalendar and browser evidence

The existing Calendar adapter, projection, local-civil-date behavior, and
VCalendar version were not changed. The real browser regression completed:

```text
npm exec playwright test \
  e2e/diary-calendar-surface.spec.ts \
  e2e/diary-release.spec.ts

7 passed
pageerror = 0
unexpected console error = 0
expected console diagnostic = one exact future-document GET 404
```

Covered behavior includes Diary Home/month navigation, existing Diary date
open, future missing no-op, managed tab close, keyboard focus, marker update,
and five repeated opens. The responsive matrix passed at:

```text
1280 x 800
768 x 1024
375 x 812
320 x 700
```

The matrix reported no horizontal overflow and retained usable Calendar
controls/touch targets. The existing VCalendar keep-mounted behavior remained
attached through date-open fallback.

## 16. Test evidence

New D6.1 focused tests:

```text
npm exec vitest run \
  src/composables/diary/__tests__/useDiaryWorkspacePresentation.test.ts \
  src/components/diary/__tests__/DiaryWorkspace.test.ts \
  src/views/__tests__/VaultView.test.ts

3 test files passed
45 tests passed
```

Diary/Vault regression set:

```text
npm exec vitest run \
  src/components/diary \
  src/composables/diary \
  src/views/__tests__/VaultView.test.ts

8 test files passed
91 tests passed
```

These tests cover initial HOME, scope exit, History/Diff/Recovery precedence,
successful and failed date results, backing-tab fallback, presentation-only
close, shell slot visibility, Calendar wiring, projection, adapter, and the
existing Diary command contract.

## 17. Typecheck and build

```text
npm run typecheck       PASS
npm run build           PASS
git diff --check        PASS
```

The build emitted the repository's existing Rolldown warning about a VueUse
`#__PURE__` annotation and existing large-chunk warnings. These did not fail
the build and did not originate from the D6.1 shell.

## 18. Known limitations and D6.2/D6.3 handoff

D6.1 intentionally does not include:

- Reader Dialog rendering or Markdown/TOC adapter wiring;
- Editor Dialog rendering, Monaco mounting, save, or dirty wiring;
- Dialog Header Back/Escape runtime controls;
- D6.2 Calendar visual-weight/chrome migration;
- full Dialog focus trap/a11y policy;
- Browser Back reconciliation beyond existing router ownership;
- Recent Diaries, Mood, or Emoji features.

D6.3 owns the successful-command-result -> Reader transition. D6.4 owns the
Editor adapter and Monaco duplication gate. The temporary D5 fallback is the
rollback-safe bridge until those phases are independently implemented.

## 19. Rollback seam

The D6.1 presentation integration can be rolled back by reverting
`95f48d314c0721a73256fd2f0b390b75a25f13bb`. This restores the D5
`workspaceTabs.length === 0` Calendar visibility predicate without migrating
Diary files, tabs, routes, document identity, server contracts, History, or
Recovery state. No data migration or dependency change is involved.

## 20. STOP conditions checked

No STOP condition was triggered:

- no new Diary route;
- no second tab store or document lifecycle;
- no server/shared Diary contract change;
- no `openDiaryDate()` API change;
- no Router or `useRouteSync()` change;
- no Calendar adapter/projection/VCalendar change;
- no duplicate Reader/Markdown renderer;
- no duplicate Editor/Monaco lifecycle;
- no History/Diff/Recovery implementation change;
- no D7 Mood/Emoji integration;
- no production mutation or save pipeline in the presentation owner.

## 21. Conclusion

```text
D6.0 = REVIEW-CLOSED
D6.1 = REVIEW-READY
D6.2 = NOT STARTED
D6.3 = NOT STARTED

P0 = 0
P1 = 0
P2 = 0
```

The D6.1 Diary presentation owner and shell are ready for independent review.
The task stops here; no D6.2, D6.3, Reader Dialog, Editor Dialog, or D7 work
has started.
