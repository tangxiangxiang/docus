# D6 — Diary Home Workspace Implementation Plan

状态：`REVIEW-CLOSED` design amendment；D6.3 Native Document Workspace replacement 为 `REVIEW-READY`。

基线：D6.0–D6.2.1 `REVIEW-CLOSED`。旧 D6.3 Reader Dialog implementation 在 closure 前被产品决定替代；D6.4 `NOT STARTED`。

日期：2026-08-26（Asia/Shanghai）

## 1. Superseding architecture

Canonical implementation direction：

```text
Calendar
  -> existing openDiaryDate()
  -> existing openPost()/tab lifecycle
  -> native Vault ReadingPane
  <-> native EditorPane through existing viewMode

FileTree
  -> generic exactPathFilter for the selected Diary context
```

旧 Reader/Editor Dialog architecture 只保留历史 evidence，不再实施。Calendar does navigation; Vault does documents.

## 2. Ownership matrix

| Concern | Owner | D6.3 allowed change | Forbidden change |
| --- | --- | --- | --- |
| Router/history | existing Vue Router | observe resulting path | new route、popstate、fake history |
| Diary scope | existing `useScopeFilter` | read `isDiaryScope` | second scope store |
| Calendar mount | `VaultView` | keep `isDiaryScope` predicate | document-triggered unmount |
| Calendar visibility | Diary presentation | HOME only | tab-count ownership |
| Date command | existing `openDiaryDate()` | consume result | second create/open command |
| Tabs/activePath | existing tab workspace | observe and reconcile | presentation mutation/clone |
| READ/EDIT | existing `VaultViewModeKey` | set READ after date success | Diary reader/editor mode |
| Raw/model/save/dirty | existing tab/editor lifecycle | reuse | duplicate state or pipeline |
| Reader | existing `VaultView` `ReadingPane` | native visibility | DiaryReader/second renderer |
| Editor | existing `EditorPane` / Monaco | native visibility | DiaryEditor/second Monaco |
| History/Recovery/Draft | existing Vault lifecycle | preserve precedence | copied state/workflow |
| FileTree filtering | generic FileTree prop | exact path + ancestors | DiaryDate/domain parsing |
| Calendar return | Diary presentation | HOME + focus restore | route/tab/dirty mutation |

## 3. State model

Use the minimum presentation model:

```ts
type DiaryPresentationMode = 'home' | 'document'
```

Presentation may own `selectedDiaryDate`, `backingPath`, `focusReturnTarget`, `dateIntentEpoch` and eligibility. It must not own Reader/Editor mode, raw, tab, activePath, save, dirty, History, Recovery or route.

`document` opens only after an explicit successful Calendar command and `activePath === result.path`. `activePath` may reset a stale document presentation but may never open one.

## 4. Command flow

```text
DiaryCalendar date-selected
  -> DiaryCalendarSurface forward
  -> VaultView.onDiaryDateSelected(date)
  -> begin date intent epoch
  -> await existing openDiaryDate(date)
  -> existing openPost() completes
  -> verify intent/current scope/eligibility
  -> record result
  -> verify opened|created and activePath === result.path
  -> presentation DOCUMENT
  -> existing viewMode.set('read')
```

No extra fetch, `getPost`, create or `openPost()` is allowed after the command result.

## 5. FileTree exact-path seam

Add a generic optional prop equivalent to:

```ts
exactPathFilter?: string | null
```

Semantics:

- null: current scope/search/tag behavior unchanged;
- non-null: recursively retain only `node.path === exactPathFilter` and required ancestor folders;
- exact filter has precedence over text/tag query without mutating its model value;
- missing exact path produces empty filtered tree, never full-tree fallback;
- exact context forces required ancestors visible without persisting expansion changes;
- FileTree does not parse Diary dates or hard-code Diary paths for this filter.

VaultView derives the prop only when Diary scope + presentation DOCUMENT + backing path are active.

## 6. Native document presentation

When presentation is DOCUMENT:

- `isDiaryPresentationPrimary` is false;
- ordinary `EditorTabs` render;
- ordinary READ `ReadingPane` renders exactly once;
- existing EDIT `EditorPane` renders through global view mode;
- FileTree, RightRail and StatusBar follow native Vault rules;
- Calendar remains attached but hidden.

Remove Reader slot/runtime, `DiaryReaderDialog`, Reader-only CSS and unused Reader i18n. Do not mount `ReadingPane` inside `DiaryWorkspace`.

## 7. Calendar Home action

Provide a compact FileTree context for the exact Diary path with selected date and a “返回日历” action. It calls only presentation `closePresentation()` / `showHome()` and semantic Calendar focus restoration.

It must not call router navigation, `closeTab()`, change `activePath`, discard/save, or clear the user search model. On HOME the exact prop becomes null and D6.2.1 layout hides FileTree as before.

## 8. Reconciliation

| Event | Document lifecycle result | Diary presentation result |
| --- | --- | --- |
| date success | backing tab active | DOCUMENT + READ |
| date failure/future/stale | no adopted document | HOME |
| Calendar Home action | unchanged | HOME, exact filter cleared, focus restored |
| view toggle | same tab/model | DOCUMENT remains, READ ⇄ EDIT native |
| activePath changes away | existing lifecycle authoritative | passive HOME; no auto-open |
| another Diary becomes active | existing lifecycle authoritative | HOME; no filter retarget |
| backing tab closes | existing dirty policy | HOME |
| Browser Back | Router/useRouteSync reconcile | observe mismatch -> HOME |
| scope exit | tabs remain lifecycle-owned | reset HOME |
| History/Diff/Recovery | special surface active | reset HOME, exact cleared, Calendar mounted |
| same date reopened | existing tab reused | DOCUMENT + READ; unsaved raw preserved |

## 9. Phase breakdown

### D6.0 — Architecture Confirmation

Status: `REVIEW-CLOSED`.

### D6.1 — Diary Workspace Shell

Status: `REVIEW-CLOSED`. Its presentation owner and Calendar keep-mounted seam remain; Reader/editor future seams are superseded where applicable.

### D6.2 — Calendar Home Migration

Status: `REVIEW-CLOSED`.

### D6.2.1 — Full-Bleed Calendar Polish

Status: `REVIEW-CLOSED`. Visual contract frozen.

### D6.3 — Native Document Workspace Handoff

Status: `REVIEW-READY`; production/tests/canonical evidence complete, new independent review pending.

Deliverables:

- remove Diary Reader Dialog runtime/component/tests/dead CSS;
- simplify presentation to HOME/DOCUMENT;
- successful Calendar result enters native READ;
- add generic FileTree exact-path constraint and compact Calendar return affordance;
- preserve filters, backing tab, route, activePath and dirty state;
- prove native Reader/Edit, Browser Back, repeated cycles and responsive matrix;
- mark old Reader evidence SUPERSEDED and create canonical replacement evidence.

### D6.4 — Native Editor Lifecycle Verification

Status: `NOT STARTED`.

Future goal: verify the same Diary backing tab through native READ -> existing EDIT -> save/dirty/history/recovery/external changes -> Calendar Home -> reopen. No Editor adapter or new lifecycle is allowed. D6.3 may prove only the minimum native Edit and dirty-preservation seam; it must not execute D6.4 verification.

### D6.5 — Lifecycle Regression

Status: `BLOCKED` by D6.4. Verify broader scope/tab/route/close/reopen regressions.

### D6.6 — Responsive / Accessibility

Status: `BLOCKED`. Validate Calendar Home + Native Vault Diary context + exact FileTree + native read/edit keyboard/a11y. Dialog focus trap/modal/fullscreen requirements are superseded.

### D6.7 — Release Closure

Status: `BLOCKED`. Consolidate evidence and independent review.

## 10. Testing strategy

### Unit/component

- presentation HOME/DOCUMENT transitions and stale intent epoch;
- successful result + activePath gate;
- activePath mismatch/backing close/scope/special-surface passive reset;
- activePath cannot open DOCUMENT;
- DiaryWorkspace hosts only keep-mounted Calendar Home;
- FileTree exact file + ancestors, missing exact path, null regression and filter preservation;
- VaultView native surface predicates and no Reader runtime.

### Browser

- existing date and today/past create -> native READ, one ReadingPane;
- future missing remains HOME; existing future opens native READ;
- two Diaries seeded: clicked one is the only rendered FileTree file;
- existing toggle enters same-tab EditorPane/Monaco;
- dirty edit -> Calendar Home -> same-date reopen preserves existing tab raw;
- Calendar Home action preserves route/activePath/tab and restores date focus;
- real `page.goBack()` reconciles to HOME without interception;
- five open/Home cycles keep Calendar attached and produce no `dayIndex`/pageerror;
- 1280×800、768×1024、375×812、320×700 native workspace smoke/no overflow;
- light/dark and zh/en compact context;
- ordinary note/archive/ledger smoke.

### Validation commands

Run focused Diary presentation/FileTree/VaultView/Calendar Vitest, then:

```text
npm run typecheck:client
npm run typecheck
npm run build
git diff --check
```

Run focused Playwright for native Diary workspace, Calendar surface and Diary release/VCalendar regressions. Record actual file/test counts; do not inherit historical PASS.

## 11. Risks and STOP conditions

| Risk | Mitigation | STOP signal |
| --- | --- | --- |
| Reader/editor duplication | native Vault only | second ReadingPane/Monaco/pipeline required |
| Exact filter leaks Diary policy | generic path equality seam | FileTree must parse Diary domain |
| Dirty content loss | presentation-only HOME | raw lost, forced save/discard |
| Router ownership conflict | passive activePath reconciliation | new route/popstate/fake history required |
| Calendar runtime regression | scope mount + hidden visibility | unmount or `dayIndex`/pageerror |
| Search regression | exact layer does not mutate model | user filter overwritten |
| Ordinary Vault regression | focused note/archive/ledger tests | ordinary behavior changes |

Also STOP for server/shared/dependency change, `openDiaryDate()` ownership change, extra fetch, D6.4 implementation, or Calendar visual change.

## 12. Rollback

Runtime rollback to D6.2.1 must be newest to oldest:

```text
592a1d5181edc84d1d66392f2c87fe8a2d4a23eb
-> fa85f431d274e36fccbeaa0446ed63cf0d017a36
-> d270ee5756c0f742e92955f06fa308fd6f77bc4a
-> ce3e08c514f50304d9b73f066191a22d5739c179
```

Docs rollback is informational-only; it is not an asserted exact history chain.

## 13. D6.3 exit criteria

- [x] Old Reader evidence marked SUPERSEDED before closure.
- [x] New canonical D6.3 evidence created.
- [x] DiaryReaderDialog runtime absent.
- [x] Calendar success enters native READ through existing command/tab.
- [x] Exactly one existing ReadingPane; existing EditorPane/Monaco reused.
- [x] Generic exact-path FileTree renders only current Diary + ancestors.
- [x] User filter preserved.
- [x] Calendar return preserves route/activePath/tab/dirty and restores focus.
- [x] activePath mismatch cannot auto-open a Diary presentation.
- [x] Browser Back remains router-owned.
- [x] Calendar remains mounted; visual contract unchanged.
- [x] focused Vitest/E2E/typecheck/build/diff checks pass.
- [x] server/shared/router/dependencies unchanged.
- [x] task self-review P0/P1/P2 = 0/0/0.

After these pass: `D6.3 = REVIEW-READY`, `D6.4 = NOT STARTED`, then STOP for a new independent review.
