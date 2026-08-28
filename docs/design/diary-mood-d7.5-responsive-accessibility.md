# D7.5 — Responsive and Accessibility Validation

## Status

`D7.5 = IN PROGRESS`

`D7.5 Round 1 = REVIEW-CLOSED`

Independent Re-review: `PASS`

Independent Re-review findings: `P0 = 0`, `P1 = 0`, `P2 = 0`

Self-review findings: `P0 = 0`, `P1 = 0`, `P2 = 0`

GitHub CI #555: `PASS`

`D7.6 = NOT STARTED`

This document records the Round 1 responsive, viewport, and overflow
validation only. Round 1 is closed by the docs-only closure sync recorded
below; D7.5 remains in progress. This document does not begin Round 2 or
D7.6.

## Starting HEAD

`93dca2729003069beffc6060336a72a737771b87`

`docs(diary): close D7.4 lifecycle review`

The starting worktree was clean, and `github/main` pointed at this exact
commit before Round 1 work began.

## Round 1 Scope

Round 1 is limited to the following browser-visible contract:

- 1280×800, 768×1024, 375×812, and 320×700;
- the real Calendar and the single Teleported Mood Picker;
- fixed 4 columns × 6 rows and canonical row-major Mood order;
- picker horizontal containment, option geometry, and Clear reachability;
- Calendar date/Mood spatial separation and month navigation;
- page-level horizontal overflow;
- light/dark and zh/en layout smoke coverage;
- ordinary Vault boundary smoke.

Full keyboard semantics, ARIA semantics, contrast certification, and complete
locale/accessibility validation remain outside this Round 1 evidence and are
not being promoted into D7.5 Round 2 here.

## Baseline Characterization

The focused suite was added before changing production CSS. At the baseline,
the 375px and 320px cases exposed one responsive layout defect:

```text
D7.5-R1-P2-1
viewport: 375×812 and 320×700
theme/locale: light / zh-CN
scenario: existing Diary with a Mood marker, Calendar Home
expected: the Mood hit area remains inside its own Calendar row and does not
          enter the following row's date targets
actual: the 24px Mood sibling extended below the fixed 44px VCalendar week
        row and crossed the following week's date hit area
root cause: the optional Mood control shared a narrow 44px row without enough
           vertical space for both the 44px date target and the Mood target
severity: P2; the controls remained visible, but their click ownership was
          ambiguous at narrow widths
```

The baseline did not show a P0/P1 data or lifecycle failure. No production
change was made until the browser geometry assertion exposed this condition.

## Production Changes

Implementation commit:

`3b43867e21f7af2e137c379621a775a6d37d04c0`

`fix(diary): keep mobile mood inside calendar row`

The remediation is component-local to
[`DiaryCalendar.vue`](/Users/txx/docus/src/components/diary/DiaryCalendar.vue):

- narrow Calendar week rows and shared day content reserve 72px for the
  date target plus the optional Mood target;
- the date target remains 44px, preserving the existing keyboard/touch target
  contract;
- the Mood remains a separate sibling control below the date;
- the fixed 4×6 Mood Picker grid is unchanged;
- no global `overflow-x: hidden`, transform, zoom, JavaScript viewport layout
  state, duplicate mobile picker, or generic Vault CSS was added.

The characterization and browser-proof commit is:

`f48c77fe4638f176e58418a09e96618467d1e499`

`test(diary): expose D7.5 responsive regression`

## Viewport Matrix

The dedicated suite
[`diary-mood-responsive.spec.ts`](/Users/txx/docus/e2e/diary-mood-responsive.spec.ts)
uses the same real browser behavior for every viewport. It reads browser
bounding boxes rather than relying on screenshots or CSS source inspection.

| Viewport | Calendar Home | Mood Picker | Grid | Clear | Calendar/Mood geometry | Page horizontal overflow | Native Diary |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1280×800 | PASS | PASS | 4×6 / 24 | PASS | PASS | PASS | PASS |
| 768×1024 | PASS | PASS | 4×6 / 24 | PASS | PASS | PASS | PASS |
| 375×812 | PASS | PASS | 4×6 / 24 | PASS | PASS | PASS | PASS |
| 320×700 | PASS | PASS | 4×6 / 24 | PASS | PASS | PASS | PASS |

For every matrix viewport the browser proof checks:

- six measured option row positions and four measured option column positions;
- four options in each row and six options in each column;
- all 24 options in canonical row-major order;
- non-zero, non-overlapping option hit boxes;
- picker and Clear containment without internal horizontal overflow;
- no page-level horizontal overflow in Calendar Home, picker-open, or native
  Diary states;
- date/Mood vertical separation and no Mood overlap with neighboring date
  targets;
- month previous/next navigation remains usable;
- the selected Calendar date has no filled background, border, or shadow;
- a single picker presentation is mounted.

The narrow mobile run therefore proves the remediation without changing the
semantic grid to 3×8, 2×12, or 6×4.

## Theme / Locale Geometry

The dedicated browser suite covers:

- `zh-CN` + light theme across all four official Round 1 viewports;
- `en-US` + dark theme at 1280×800 and 320×700, including the English
  `Clear mood` control;
- visible month/header and picker text remaining contained in the tested
  layouts;
- the ordinary Note/Vault boundary remaining outside Mood policy.

The existing D6.6 responsive suite continues to provide the broader keyboard,
focus-visible, selected-state, and mobile native-workspace evidence. Round 1
does not relabel that evidence as a new accessibility certification.

## Calendar and Native Workspace Boundary

The Calendar remains a keep-mounted presentation surface. The responsive
suite verifies that date navigation still opens the native Diary workspace,
the picker does not navigate the date, and closing the Diary tab returns to
Calendar Home. The date button remains the navigation owner and the Mood
control remains the separate Mood entry point.

The ordinary Vault smoke opens an ordinary Note with the FileTree, verifies
that no Calendar or Mood Picker is present, then closes the FileTree and
checks the wide native workspace for page-level overflow. Existing D6.6
coverage remains the owner for the mobile native workspace contract; this
Round 1 does not redesign generic Vault layout.

## Validation

Focused responsive browser suite:

```text
npm exec playwright test e2e/diary-mood-responsive.spec.ts --project=chromium
2 passed
```

The two tests contain the full four-viewport matrix, light/dark geometry,
zh/en smoke, Calendar navigation, native Diary smoke, and ordinary Vault
boundary assertions.

Existing Calendar and D7.4 lifecycle browser smoke:

```text
e2e/diary-mood-lifecycle-regression.spec.ts
e2e/diary-calendar-surface.spec.ts
27 passed
```

Existing focused component/Vault tests:

```text
8 test files
129 passed
```

Draft Store browser regression:

```text
npm run test:e2e:draft-store
38 passed
```

Complete Chromium browser suite:

```text
npm exec playwright test --project=chromium
140 passed
```

Full unit suite:

```text
npm run test:unit
235 test files passed
3524 passed, 2 skipped
```

Type checks:

```text
npm run typecheck:client  PASS
npm run typecheck:server  PASS
npm run typecheck         PASS
```

Production build:

```text
npm run build             PASS
```

The build emitted existing dependency/chunk-size warnings but completed
successfully. No warning was caused by the D7.5 production diff.

The first full-unit attempt in the restricted sandbox was not used as a
result: existing `tsx` crash-child tests could not listen on their temporary
IPC sockets and reported `EPERM`. The authorized rerun above passed in full.

## CI

GitHub Actions CI #555 covered the exact Round 1 implementation/evidence
HEAD before this closure-only commit:

```text
run number: 555
run ID: 33179840394
attempt: 1
HEAD: 5838773095d3468630c0789b7152cb8a48825b16
status: completed
conclusion: success
```

Required jobs all passed:

- Ubuntu 22 verify;
- Ubuntu 24 verify;
- Windows 24 verify;
- macOS 24 verify;
- auth-browser;
- visual;
- docker-smoke;
- tags-scale.

The four platform jobs also passed their typecheck, build, unit/integration,
cross-platform browser E2E, and Draft Store E2E stages. The docs-only closure
sync does not change the tested production or test implementation.

## Findings and Self-review

Baseline finding `D7.5-R1-P2-1` is closed by the component-local row-height
remediation and the real browser geometry proof above.

Current self-review:

```text
P0 = 0
P1 = 0
P2 = 0
```

Independent Re-review:

```text
PASS
P0 = 0
P1 = 0
P2 = 0
```

No lifecycle, data, Mood ownership, route, tab, History, Recovery, CAS,
FileTree query, server, shared domain, schema, dependency, or package change
was introduced by this Round 1 work. No new Mood catalog or production
feature was started.

## Commit Scope

Starting from `93dca2729003069beffc6060336a72a737771b87`, the implementation
chain is:

```text
f48c77fe4638f176e58418a09e96618467d1e499
test(diary): expose D7.5 responsive regression
        ↓
3b43867e21f7af2e137c379621a775a6d37d04c0
fix(diary): keep mobile mood inside calendar row
```

Files changed by the implementation chain:

- [`e2e/diary-mood-responsive.spec.ts`](/Users/txx/docus/e2e/diary-mood-responsive.spec.ts)
- [`src/components/diary/DiaryCalendar.vue`](/Users/txx/docus/src/components/diary/DiaryCalendar.vue)

This evidence document is the only file added by the following docs commit.
There are no server/shared/router/tab/schema/package/lockfile/dependency
changes.

## Final State

```text
D7.0A = REVIEW-CLOSED
D7.0  = REVIEW-CLOSED
D7.1  = REVIEW-CLOSED
D7.2  = REVIEW-CLOSED
D7.3  = REVIEW-CLOSED
D7.4  = REVIEW-CLOSED

D7.5  = IN PROGRESS
D7.5 Round 1 = REVIEW-CLOSED
D7.5 Round 1 Independent Re-review = PASS (P0/P1/P2 = 0/0/0)
GitHub CI #555 = PASS

D7.6  = NOT STARTED
D7.5 Round 2 = NOT STARTED
D7.5 implementation beyond Round 1 = NOT STARTED
```

Do not begin Round 2, D7.6, or any unrelated responsive/generic Vault work in
this Round 1 closure boundary.
