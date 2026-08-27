# D7.4 — Lifecycle and Conflict Regression Evidence

## Status

`D7.4 = REVIEW-READY`

Independent Review: `PENDING`

Self-review findings: `P0 = 0`, `P1 = 0`, `P2 = 0`

Starting HEAD: `14b1efdf03a13063420fe344dc36eafc40c61dc8`

D7.4 test implementation commit: `ed8524b46e40fb15b38fd39320bfd7f3af2f442c`
(`test(diary): cover D7.4 lifecycle conflicts`)

This document records the D7.4 lifecycle/conflict regression evidence. The
implementation/evidence phase started as `IN PROGRESS` and stops at
`REVIEW-READY`; this document does not claim independent review closure.

Current lifecycle:

```text
D7.0A = REVIEW-CLOSED
D7.0  = REVIEW-CLOSED
D7.1  = REVIEW-CLOSED
D7.2  = REVIEW-CLOSED
D7.3  = REVIEW-CLOSED
D7.4  = REVIEW-READY
D7.4 Independent Review = PENDING
D7.5  = NOT STARTED
D7.6  = NOT STARTED
D7 Mood release = NOT STARTED
```

## 1. Scope

D7.4 verifies that the D7 Mood metadata contract survives the existing Docus
document lifecycle. This is a test/evidence phase, not a new Mood feature
phase. It covers clean and dirty body state, metadata compare-and-swap (CAS),
History, Recovery, delete/recreate identity boundaries, native tab/route
reconciliation, Calendar presentation continuity, and ordinary Vault
regression.

No production code was changed for D7.4. The implementation commit adds only
the focused browser regression file. This evidence document is the only other
D7.4 change. No server, shared domain, migration, PRD, Implementation Plan,
package, lockfile, or dependency change is included.

D7.4 does not start D7.5, D7.6, or a Mood release. It does not add a Diary
route, a Diary-specific editor/reader, a second tab store, a second save or
recovery pipeline, or a second metadata owner.

## 2. Frozen contracts and current owners

The following contracts are inherited from the reviewed D7.0–D7.3 phases:

- Calendar is a navigation and presentation surface; the native Vault owns
  documents.
- A canonical Diary remains one file at `diary/YYYY-MM-DD.md`.
- `openDiaryDate()` remains the only canonical date create/open command.
- `useDiaryMoodCommand` performs the authoritative Mood metadata mutation
  with the current `metadataUpdatedAt` expected value.
- SQLite `documents.mood` is the live Mood owner. Persisted values are stable
  Mood IDs or `NULL`, never asset paths.
- Existing tabs, `activePath`, route synchronization, raw body, save, dirty
  state, drafts, History, Recovery, and file mutation keep their existing
  owners.
- Calendar summary enrichment uses the existing bulk `PostSummary[]` seam;
  D7.4 does not introduce per-day metadata reads or N+1 requests.
- Calendar remains keep-mounted when its native document surface is shown;
  presentation changes do not close or recreate the backing tab.
- Unknown Mood values remain opaque and are not silently rewritten by a
  lifecycle operation.

The ownership model exercised by the tests is:

| Concern | Current owner | D7.4 boundary checked |
| --- | --- | --- |
| Diary date validation/create/open | `useDiaryDateCommand` / `openDiaryDate()` | Mood-first and existing-date paths reuse the canonical command |
| Mood set/change/clear | `useDiaryMoodCommand` → metadata API | CAS result is authoritative; no direct Calendar persistence |
| Live Mood storage | SQLite `documents.mood` / server metadata owner | Body writes and tab changes do not create a second Mood source |
| Body raw/model | `useTabWorkspace` and native Editor/Reader surfaces | Dirty raw remains distinct from metadata writes |
| Save/autosave/dirty | `useDocumentSave` and existing tab workspace | Manual save persists the body without losing Mood or identity |
| Draft persistence/recovery | existing draft persistence/recovery owners | Recovery handles body state and preserves current durable Mood |
| History capture/restore | existing server History owner and native History UI | v2 matching metadata restores together; legacy policy preserves current Mood |
| Tabs/active document | `useTabWorkspace` / existing tab lifecycle | Same tab and stable document identity survive tested transitions |
| Route synchronization | Vue Router + `useRouteSync()` | Browser navigation remains router-owned |
| Calendar projection/presentation | `DiaryCalendar` / `VaultView` | Calendar continuity is observed, not a new document owner |
| Ordinary Vault behavior | existing Vault/FileTree/editor lifecycle | Note and non-Diary flows remain outside Mood policy |

## 3. Characterization matrix

The D7.4 matrix is composed from the new focused browser suite plus the
existing lower-level and cross-phase regression suites. A row marked
“existing” is not presented as a newly invented D7.4 implementation; it is
included to show the already-verified owner that D7.4 depends on.

| Lifecycle / conflict case | Evidence | Result |
| --- | --- | --- |
| Clean Mood set, change, and clear | New E2E: `Mood set/change/clear stays separate from a dirty native Diary body`; existing D7.3 Calendar set/clear coverage | PASS |
| Dirty body plus Mood mutation | New E2E test 1: disk body remains unchanged while the native buffer is dirty; Mood changes independently | PASS |
| Body save ordering and draft removal | New E2E test 1: real `Ctrl+S` persists the dirty body and removes the draft while Mood and identity remain stable | PASS |
| Metadata CAS conflict | New E2E test 5 plus `server/__tests__/diary-mood-metadata.test.ts` | PASS |
| External body conflict | Existing D6.4 real conflict E2E: buffer/disk reconciliation through the native owner | PASS |
| Unknown Mood value | Focused server metadata tests and D7.2/D7.3 opaque-value coverage | PASS |
| Dirty History Comparison does not mutate live body | Existing D6.4 History Comparison E2E with a dirty native editor | PASS |
| v2 History Restore restores matching Mood | New E2E test 2 plus `server/__tests__/history-metadata-revisions.test.ts`; actual native History Restore UI | PASS |
| Legacy/pre-Mood History Restore preserves current Mood | Focused `history-metadata-revisions` coverage from D7.0/D7.1 | PASS |
| Baseline Recovery preserves current Mood | New E2E test 3: body draft adoption, native identity, and current Mood remain separate | PASS |
| Divergent Recovery preserves current Mood | New E2E test 4: draft/disk divergence, View Diff, Open Recovered Content, and Use Disk Version use the existing Recovery owner | PASS |
| Delete/recreate generation boundary | New E2E test 5: stale CAS rejects, delete/recreate receives a new document identity, and Mood starts `NULL` | PASS |
| Same-date reopen | Existing D6.5 close/reopen identity regression | PASS |
| Scope exit and re-entry | Existing D6.5 Diary/Note/Ledger scope regression | PASS |
| Multi-tab selection and close | Existing D6.5 tab-selection and fallback lifecycle regression | PASS |
| Refresh | Existing D6.5 refresh lifecycle regression; new Recovery tests also reload a native Diary | PASS |
| Deep link | Existing D6.5 deep-link native Vault regression | PASS |
| Browser Back / Forward | Existing D6.5 route reconciliation regression | PASS |
| Identity continuity | New History/Recovery/CAS tests plus existing native lifecycle suites | PASS |
| Raw/dirty continuity | New tests 1, 3, and 4 plus D6.4 dirty editor coverage | PASS |
| Metadata continuity | New tests 1–5 and focused server metadata/history suites | PASS |
| Calendar continuity | New History Restore/Recovery assertions and existing D6.5/D7.3 Calendar lifecycle | PASS |
| No N+1 metadata reads | D7.3 bulk `PostSummary[]` projection contract and static owner audit; no Calendar component fetch was added | PASS |
| Ordinary Vault regression | Existing D6.5 ordinary Note/Archive/Ledger coverage, focused VaultView tests, and full browser/unit suites | PASS |

## 4. New D7.4 browser scenarios

`e2e/diary-mood-lifecycle-regression.spec.ts` uses a real authenticated
browser page, real Vault files, real metadata routes, real History routes, and
the existing native Recovery UI. It does not mock away the lifecycle under
test.

### 4.1 Dirty body and metadata separation

The test sets, changes, and clears Mood through the metadata API, then opens a
native Diary, creates a dirty editor buffer and persisted draft, and repeats
Mood changes while the body remains dirty. It verifies:

- the on-disk body is still the baseline before the body save;
- the Mood is cleared without replacing the stable document identity;
- the native tab remains dirty and no tab-close confirmation is triggered by
  metadata mutation;
- the existing `Ctrl+S` owner later persists the body and removes the draft;
- the final Mood and document identity remain intact.

### 4.2 Mood-aware History Restore

The test captures a real History revision after the Diary has Mood `happy`,
changes the body and current Mood to `sad`, and invokes the existing native
History Comparison → Restore flow. It verifies the historical body and
matching Mood are restored, the stable document identity is retained, and the
metadata version advances. It then closes the History and Diary tabs through
the existing tab controls and verifies Calendar continuity and the restored
Mood marker.

### 4.3 Baseline Recovery

The test creates a dirty native body draft for a Diary with Mood `happy`,
reloads the application, and verifies the existing baseline recovery adopts
the body draft without changing the on-disk baseline, stable identity, or
current Mood. The existing save owner then persists the recovered body.

### 4.4 Divergent Recovery

The test creates a dirty body draft, changes the disk body externally, changes
the durable Mood through the real CAS route, and reloads. It then resolves the
divergent Recovery through the existing prompt, View Diff, Open Recovered
Content, and Use Disk Version flow. The resulting disk body is the selected
disk version while the externally current Mood and stable identity remain
unchanged.

### 4.5 CAS and generation isolation

The test submits a stale metadata update and verifies the server returns `409`
without changing the current raw body or Mood. It then deletes and recreates
the same Diary date and verifies a fresh document identity and `NULL` Mood
before setting a Mood on the new generation.

All five new scenarios use an explicit `Asia/Shanghai` Playwright timezone,
the same civil-date authority used by the Diary E2E helpers, and generated
dates selected from unused candidates. They do not rely on fixed calendar
dates or sleeps.

## 5. Defects and test-only remediation

No D7.4 production defect was found. During the first focused browser run, the
dirty-body test asserted a specific `data-save-status="dirty"` state after an
intentionally aborted autosave and several independent metadata writes. The
existing save owner can expose an error status after that transport is
aborted, while the editor buffer and tab dirty indicator remain correct. The
test was tightened to assert the user-visible dirty tab indicator and the
actual body/draft invariants instead of overfitting to that transient status.

This was a test-only portability/stability correction. It did not change the
save owner or production behavior. The final test file contains no `skip`,
`only`, fixed delay, fake metadata mutation, or test-only production branch.

## 6. Validation evidence

The following commands were run against the D7.4 test commit and current
working tree:

| Command | Result |
| --- | --- |
| `npm exec playwright test e2e/diary-mood-lifecycle-regression.spec.ts --project=chromium` | **5 passed** |
| `npm exec playwright test e2e/diary-editor-lifecycle.spec.ts e2e/diary-lifecycle-regression.spec.ts e2e/diary-calendar-surface.spec.ts --project=chromium` | **24 passed** |
| `npm run test:e2e` | **124 passed** |
| Focused Vitest: metadata/history/mood command/VaultView/draft recovery/save suites | **6 files, 120 tests passed** |
| `npm run test:unit` | **235 files, 3520 tests passed, 2 skipped** |
| `npm run typecheck:client` | **PASS** |
| `npm run typecheck:server` | **PASS** |
| `npm run typecheck` | **PASS** (client and server) |
| `npm run build` | **PASS** |

The two skipped unit tests are pre-existing suite skips; no D7.4 test is
skipped. The build emitted existing dependency annotation and large-chunk
warnings but completed successfully. The full browser run also emitted known
Monaco cancellation messages on the web-server log while all 124 tests
passed; the five D7.4 tests recorded no page errors or unexpected console
errors.

## 7. GitHub status

GitHub checks were queried after the D7.4 commits were pushed. At the time of
the evidence snapshot, Actions run `33103894152` was still `in_progress`:

```text
visual                    PASS
auth-browser              PASS
tags-scale                PASS
docker-smoke              IN PROGRESS
verify Ubuntu 22          IN PROGRESS
verify Ubuntu 24          IN PROGRESS
verify macOS 24           IN PROGRESS
verify Windows 24         IN PROGRESS
```

The run was not used as a completed CI proof. D7.4 readiness is based on the
local focused/full validation listed above; this document does not claim
`GitHub CI = PASS` while the remote run is incomplete.

## 8. Review and readiness

Task-scoped self-review:

```text
P0 = 0
P1 = 0
P2 = 0
```

The D7.4 evidence phase is ready for independent review. Independent Review
is intentionally still `PENDING`; this document does not convert the phase to
`REVIEW-CLOSED`.

The following remain unchanged and not started:

```text
D7.5 = NOT STARTED
D7.6 = NOT STARTED
D7 Mood release = NOT STARTED
```

No D7.5 responsive/accessibility work, D7.6 release work, or unrelated
feature work is included.

## 9. Evidence commands and conclusion

Repository and validation commands used for this phase included:

```text
git status --short --branch
git rev-parse HEAD
git log -20 --oneline --decorate
git fetch github main
git diff --check
npm exec vitest run ...
npm run test:unit
npm exec playwright test ...
npm run test:e2e
npm run typecheck:client
npm run typecheck:server
npm run typecheck
npm run build
```

The final D7.4 conclusion is:

```text
D7.4 = REVIEW-READY
Independent Review = PENDING
Self-review P0/P1/P2 = 0/0/0

D7.5 = NOT STARTED
D7.6 = NOT STARTED
D7 Mood release = NOT STARTED
```

D7.4 is ready for independent review. Do not start D7.5 in this phase.
