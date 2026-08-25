# D6.0 — Diary Home Workspace Architecture Confirmation

## 1. Status

```text
Evidence status: D6.0 = REVIEW-READY
Independent review: pending
D6.1: NOT STARTED
Production implementation: not started by this evidence task
P0/P1/P2 self-review: 0/0/0
```

This document records current-code architecture evidence for D6.0. It does not implement `DiaryWorkspace`, a Dialog, a new route, or any D6.1 behavior.

## 2. Starting HEAD and scope

```text
Starting HEAD: aed89279d5abb275e8cfa6800e89e1c2223bc113
Commit: aed8927 docs(diary): close D6 design review
Branch: main
Worktree at start: clean
```

The repository was audited at the real current `HEAD`; `main` and `github/main` pointed to the same commit. This phase is architecture confirmation only. No production code, tests, E2E files, package files, lockfiles, or dependencies were changed.

## 3. Files inspected

### Design and contract documents

- `docs/design/diary-home-workspace-prd.md`
- `docs/design/diary-home-workspace-implementation-plan.md`
- `docs/design/diary-prd.md`
- `docs/design/diary-implementation-plan.md`
- `docs/design/diary-vcalendar-compatibility-report.md`

### Router, scope, and Vault integration

- `src/router/index.ts`
- `src/composables/vault/useScopeFilter.ts`
- `shared/scopeProtocol.ts`
- `src/components/NavBar.vue`
- `src/components/vault/FileTree.vue`
- `src/views/VaultView.vue`
- `src/composables/vault/context/createVaultContext.ts`
- `src/composables/vault/context/types.ts`

### Diary and date command

- `src/components/diary/DiaryCalendar.vue`
- `src/components/diary/DiaryCalendarSurface.vue`
- `src/components/diary/diaryCalendarProjection.ts`
- `src/components/diary/diaryCalendarAdapter.ts`
- `src/composables/diary/useDiaryDateCommand.ts`
- `shared/diaryProtocol.ts`

### Document, tab, route, and save lifecycle

- `src/composables/vault/useEditorTabs.ts`
- `src/composables/vault/editor-tabs/useTabWorkspace.ts`
- `src/composables/vault/editor-tabs/useRouteSync.ts`
- `src/composables/vault/editor-tabs/useDocumentSave.ts`
- `src/composables/vault/editor-tabs/useTabPersistence.ts`
- `src/composables/vault/useDocumentLifecycle.ts`
- `src/composables/vault/context/fileChanges.ts`

### Reader, Editor, History, Recovery, and Draft

- `src/components/vault/ReadingPane.vue`
- `src/components/vault/RenderedMarkdown.vue`
- `src/components/vault/EditorPane.vue`
- `src/components/vault/monacoModels.ts`
- `src/components/vault/monacoModelRegistry.ts`
- `src/composables/vault/useHistory.ts`
- `src/composables/vault/useHistoryRestore.ts`
- `src/composables/vault/useHistoryTimeline.ts`
- `src/composables/vault/draft-recovery/useUnsavedDraftRecovery.ts`
- `src/composables/vault/draft-recovery/useDraftRecoveryTabs.ts`
- `src/composables/vault/draft-recovery/useUnsavedDraftPersistence.ts`
- `src/components/vault/HistoryComparisonPane.vue`
- `src/components/vault/DraftRecoveryPane.vue`
- `src/components/vault/DraftRecoveryCenter.vue`

## 4. Current architecture facts

The intended D6 contract and the production code agree on the main ownership boundaries. The important D5-to-D6 presentation discrepancy is recorded explicitly below: Calendar visibility is still coupled to the number of workspace tabs, while Calendar mounting is already independent of that count.

### 4.1 Router ownership

`src/router/index.ts` defines the authenticated Vault workspace routes:

```text
/vault
/vault/:pathMatch(.*)*
```

There is no `/diary`, `/diary/:date`, or `/diary/:date/edit` route and no Diary-specific route lifecycle. The router owns browser history and route transitions. `VaultView` is the component for both Vault routes.

### 4.2 Diary scope ownership

`useScopeFilter()` owns the module-level `activeScope` ref, toggling and localStorage persistence. `shared/scopeProtocol.ts` defines:

```text
note   -> inbox, literature, archive
diary  -> diary
ledger -> ledger
```

`NavBar` writes the scope through `toggleScope()`. `FileTree` and `VaultView` read the same singleton ref. Scope switching does not navigate the router, create a tab, close a tab, or change `activePath`.

Diary is therefore a Vault content scope, not route identity.

### 4.3 VaultView and the D5 coupling

The current production code in `src/views/VaultView.vue` contains:

```ts
const isDiaryScope = computed(() => activeScope.value === 'diary')
const isDiaryCalendarMounted = computed(() => isDiaryScope.value)
const isDiaryCalendarMode = computed(
  () => isDiaryScope.value && workspaceTabs.value.length === 0,
)
```

The template uses:

```vue
<div v-if="isDiaryCalendarMounted" v-show="isDiaryCalendarMode">
  <DiaryCalendarSurface ... />
</div>
```

The existing editor and reading surfaces use the inverse `isDiaryCalendarMode` visibility rule. `EditorTabs` is rendered whenever `workspaceTabs.length > 0`; History, Working Tree Diff, and Recovery remain separate workspace surfaces.

This is the central D6.0 finding:

```text
Calendar mounted lifetime = Diary scope lifetime
Calendar visible lifetime = Diary scope AND zero workspace tabs
```

The first line is the keep-mounted compatibility workaround. The second line is a D5 presentation coupling that cannot remain the sole Calendar Home visibility rule for D6. A backing Diary tab must be allowed to exist while Diary Home is visible.

### 4.4 Keep-mounted compatibility contract

`ed47c94` was inspected against current code. Its bounded workaround remains present:

- `isDiaryCalendarMounted` follows only `isDiaryScope`;
- Calendar is mounted while Diary scope is active;
- `v-show` controls visibility after a document/tab transition;
- opening a document does not synchronously unmount the VCalendar subtree;
- leaving Diary scope still unmounts the Diary Calendar through `v-if`.

D6.1 may change the visibility predicate, but must preserve the mounted predicate and must not replace it with synchronous Calendar unmount/remount behavior.

### 4.5 Date command ownership

`useDiaryDateCommand()` is the only current Diary date command. `VaultView` creates it and passes:

- `getPost` for exact logical-path lookup;
- `createDiaryDate` for the existing server date-create contract;
- `openPost` from the existing editor-tab coordinator;
- `refresh`, `fileChanges`, and the existing mutation lock;
- local civil today and future/error/busy feedback handlers.

The verified current flow is:

```text
Calendar day / Today click
    ↓
DiaryCalendar emits DiaryDate
    ↓
DiaryCalendarSurface forwards date-selected
    ↓
VaultView calls openDiaryDate(date)
    ↓
parse and canonical diary/YYYY-MM-DD resolution
    ↓
exact getPost
    ├─ existing → openPost(path)
    └─ missing today/past → createDiaryDate → refresh → openPost(path, refresh:false)
                         missing future → feedback, no create/open
    ↓
existing document/tab lifecycle
```

The command keeps exact-path, conflict, future-date, mutation-lock, and in-flight deduplication semantics. It does not own Dialog state and does not call a Diary-specific editor or reader command. Repository search found no parallel `openDiaryReaderDate`, `openDiaryEditorDate`, or Dialog-owned create/open command.

### 4.6 Existing tab and document ownership

`useEditorTabs()` coordinates `useTabWorkspace()`, `useTabPersistence()`, `useDocumentSave()`, external file changes, editor shortcuts, and `useRouteSync()`.

`useTabWorkspace()` owns:

- `tabs` and `activePath`;
- `activeTab` derivation;
- existing-tab reuse and new-tab creation in `openPost()`;
- tab selection, close, reorder, rename, and route navigation;
- persisted tab restoration;
- Monaco model disposal when a document tab is truly closed.

Opening an existing path reuses its tab, sets `activePath`, and navigates to the path. Opening a new path creates a tab, sets `activePath`, navigates, then loads the document. A future Diary Dialog must consume this same backing tab/document identity and must not create a second tab store or call `closeTab()` for presentation close.

`createVaultContext()` exposes the same `tabs`, `activePath`, `activeTab`, `openPost`, and live content lookup to child presentation surfaces. This is the narrowest existing context seam for future Reader/Editor adapters.

### 4.7 Route synchronization and Browser Back

`useRouteSync()` derives a logical path from `route.params.pathMatch` and watches it:

```ts
if (path && path !== activePath.value) void openPost(path)
```

The current route flow is:

```text
Browser Back
    ↓
Vue Router history transition
    ↓
Vault route/pathMatch changes
    ↓
useRouteSync watches the logical path
    ↓
openPost(path), only when path is non-empty and differs
    ↓
existing tab/document reconciliation
```

Important current-code fact: when Browser Back lands on `/vault`, `pathMatch` is empty and `useRouteSync()` does not call `openPost()` or clear `activePath`. The route can temporarily be `/vault` while a backing tab remains active. This is not silently treated as a route/tab close; D6.1 must define presentation reconciliation for this resulting state without adding router interception or closing the tab from presentation code.

No production code uses `popstate` interception, `router.back()` as Dialog close, or fake Dialog history. The `history.replaceState()` found in `ReadingPane` is only used for a Markdown heading fragment after a TOC click; it is not Dialog navigation.

### 4.8 Reader seam

`VaultView` currently mounts one keyed `ReadingPane` for the active tab in read mode. It passes:

```text
raw          = activeTab.raw
resolver     = VaultView wikiResolver
sourcePath   = activeTab.path
```

`ReadingPane` delegates Markdown rendering to `RenderedMarkdown`, which uses the shared `useMarkdownRender()` pipeline and shared visual mounts. Wiki-link clicks call `vaultContext.editor.openPost(destination)`. Headings and TOC state use the Vault-scoped `useVaultTocState()`.

The Reader reuse seam is therefore confirmed: future Diary Reader presentation can consume the same active-tab raw/path/resolver inputs and the existing `ReadingPane`/`RenderedMarkdown` pipeline. D6.3 must preserve a single active Reader/TOC owner; mounting an additional independent Markdown pipeline is forbidden.

### 4.9 Editor and Monaco seam

`EditorPane` is a controlled presentation component. It receives `modelValue` and `path`, emits `update:modelValue`, and `VaultView` routes that event to `useEditorTabs().onEditorChange(path, value)`. Save, dirty, revision, external conflict, and autosave state remain in `useDocumentSave()` and the `Tab` object.

`EditorPane` acquires a model through `acquireMarkdownModel(path, value)`. The model registry is keyed by logical path and can return the same Monaco model for a repeated acquisition. `EditorPane` creates its own Monaco editor instance and registers model-content listeners/provider context for that instance.

This produces an explicit D6.4 risk:

```text
same path + two EditorPane instances
    → shared model may be reused
    → two Monaco editor instances/listener sets may still exist
    → duplicate change forwarding, hidden editor, focus, and disposal hazards
```

The model registry alone is not a safe duplicate-editor strategy. D6.4 must use one EditorPane instance for a path at a time, or establish a proven rehost/adapter strategy. A second Monaco model lifecycle is forbidden.

### 4.10 Save, dirty, draft, History, Recovery, and file changes

`useDocumentSave()` owns raw-to-tab updates, revisions, `originalRaw`, `savedRevision`, saving/error/external state, autosave, save barriers, before-unload protection, and draft scheduling. `useTabWorkspace().requiresCloseConfirmation()` and `useDocumentSave().prepareDocumentClose()` are the existing document-close/dirty boundary.

`VaultView` owns the Vault-scoped instances and wiring for:

- `createVaultFileChanges()` and its sequence/consumer bus;
- `createDraftStore()`;
- `createUnsavedDraftPersistence()`;
- `createUnsavedDraftRecovery()` and recovery discovery/classification;
- recovery tabs and recovery panels;
- `useHistory()`, comparisons, commits, withdraw, and restore;
- `useDocumentLifecycle()` for file/folder mutation and mutation barriers.

History restore prepares the existing editor mutation barrier, updates the existing tab when present, publishes through `fileChanges`, and refreshes existing projections. Recovery uses stable document identity and existing draft persistence/recovery tabs. None of these concerns belongs in Diary presentation state.

The D6 boundary is therefore:

```text
Dialog close       → presentation state only
Document/tab close → existing closeTab + dirty/draft policy
History/Recovery   → existing Vault workflow
```

## 5. D5 → D6 presentation migration seam

The minimum D6.1 seam is a presentation-only state boundary at the Diary/VaultView integration point:

```text
activeScope === 'diary'
    ↓
Diary presentation host is mounted

presentationMode === HOME
    → Calendar visible

presentationMode === READER
    → Calendar hidden but mounted, Reader presentation visible

presentationMode === EDITOR
    → Calendar hidden but mounted, Editor presentation visible
```

The future presentation owner may be a `DiaryWorkspace` component/composable introduced by D6.1, but D6.0 does not create it. Its allowed state is limited to:

- `presentationMode: HOME | READER | EDITOR`;
- selected `DiaryDate`/backing logical path as presentation context;
- Dialog visibility/mode;
- focus origin and return context;
- reconciliation with `activeScope`, route, `activePath`, `activeTab`, and tab existence.

It must not own raw Markdown, tabs, `activePath`, route navigation, save, dirty, History, Recovery, Draft, file changes, server mutations, or document identity creation.

The key migration is:

```text
D5: Calendar visible iff activeScope === diary && workspaceTabs.length === 0
D6: Calendar visible iff activeScope === diary && presentationMode === HOME
```

The `workspaceTabs.length` predicate must be removed from Calendar Home visibility in D6.1, while `workspaceTabs` remains the existing source for tab-strip/document state. The Calendar must remain `v-if`-mounted for Diary scope and use visibility control compatible with the `ed47c94` workaround.

## 6. Proposed ownership boundary

### 6.1 Presentation owner

Future `DiaryWorkspace` presentation ownership is proposed at the `VaultView` Diary-scope seam. `VaultView` remains the integration host for existing lifecycle dependencies; `DiaryWorkspace` is not a new document system.

### 6.2 Dialog-local actions

The following are local presentation actions:

- Explicit Dialog Close;
- Escape;
- Dialog Header Back.

They may transition `READER`/`EDITOR` to `HOME`, restore focus, and hide the Dialog. They must not call `router.back()`, `router.replace('/vault')`, `closeTab()`, discard, save, or mutate `activePath`.

### 6.3 Browser Back

Browser Back remains existing Vue Router/history ownership. Diary presentation may observe the resulting route/tab/scope state and reconcile its mode, but it may not intercept `popstate`, add fake Dialog history, or encode Dialog state in the URL.

### 6.4 Dialog close and dirty state

Presentation close leaves the backing tab, `activePath`, raw bytes, draft state, and dirty state intact. Dirty confirmation remains exclusive to true document/tab close through the existing `closeTab`/`prepareDocumentClose` path.

## 7. Browser Back reconciliation matrix

| Event/resulting state | Current code fact | D6 presentation result | Forbidden action |
| --- | --- | --- | --- |
| Back to the same backing Diary path | `pathMatch` equals `activePath`; `useRouteSync` does not reopen | Keep or reconcile current Reader/Editor mode according to final state | No fake history or route rewrite |
| Back to another Diary document | Non-empty different `pathMatch` calls existing `openPost`; existing tab is reused or created | Reconcile to the resulting Diary document; no parallel tab/document | No Diary-specific open command |
| Back to a note document | Same existing `useRouteSync` path flow | Exit Diary Dialog presentation and observe the note document | No `closeTab()` from presentation |
| Back to `/vault` | Empty `pathMatch`; current `useRouteSync` is a no-op, so active tab may remain | Close/reconcile Diary presentation from route/scope result; preserve tab unless existing lifecycle closes it | No `router.replace('/vault')` on Dialog close; no invented route semantics |
| Scope and route temporarily disagree | Scope filter is local UI state; route/tab state is existing Vault state | Presentation observes both; Diary presentation is only active when Diary scope and valid backing state permit it | No scope owner takeover by Dialog |

## 8. Scope switching reconciliation matrix

| Transition | Current owner/result | D6 presentation expectation |
| --- | --- | --- |
| Diary Home → note | `activeScope` changes; tabs/route remain | Unmount Diary presentation through scope boundary; no document mutation |
| Diary Home → ledger | Same as above | Same; ledger remains ordinary Vault scope |
| Diary Reader/Editor → note | Scope changes; current D5 Calendar `v-if` would unmount it | Close Diary presentation and preserve backing tab/document; no dirty confirmation |
| Diary Reader/Editor → ledger | Same | Same |
| note → Diary with existing non-Diary tab | Scope changes; current `workspaceTabs.length` may keep Calendar hidden | D6 presentation state must explicitly enter/retain `HOME` independent of tab count, subject to D6.1 chrome decision |
| note → Diary with existing Diary tab | Existing tab state is unchanged | Calendar Home visibility is presentation-owned; selecting the date reuses existing lifecycle |

## 9. Command and state diagrams

### 9.1 Command flow

```text
DiaryCalendar
    │ date-selected(DiaryDate)
    ▼
DiaryCalendarSurface
    │ forwards event
    ▼
VaultView.openDiaryDate()
    │ exact date contract / create policy
    ▼
existing openPost()
    ▼
useEditorTabs → useTabWorkspace
    ├─ tabs / activePath / activeTab
    ├─ route navigation
    └─ document load / save / draft lifecycle

D6.1 insertion seam:
existing document-ready/backing-state result
    ▼
DiaryWorkspace presentation transition to READER or EDITOR
```

The insertion happens after the existing date command has established or reused document identity. `openDiaryDate()` remains the sole public date command.

### 9.2 State ownership diagram

```text
Router layer
  Vue Router → /vault and /vault/<path>
       │ route/pathMatch
       ▼
Document lifecycle layer
  useRouteSync → openPost → useTabWorkspace/useEditorTabs
  tabs, activePath, activeTab, raw, save, dirty, draft, history, recovery
       │ resulting state observation
       ▼
Diary presentation layer
  future DiaryWorkspace
  HOME / READER / EDITOR, Dialog visibility, focus context
       │ presentation inputs only
       ▼
Calendar / Reader / Editor presentation

Calendar day intent → openDiaryDate → existing document lifecycle
Calendar does not call server/router/tab APIs directly.
```

Dependencies point from presentation to existing state consumption. Presentation does not mutate router or persistence to simulate its own state.

## 10. Reconciliation matrix

| Event | Route | Tab/document state | Required D6 owner/result |
| --- | --- | --- | --- |
| Date click | Existing route navigation after `openPost` | Existing tab reused or created | Presentation enters Reader/Editor only after existing identity is available |
| Dialog Close | Route may remain backing `/vault/<path>` | Backing tab, activePath, raw, dirty remain | Presentation → HOME only |
| Escape | No route change | No tab change | Same presentation close policy |
| Dialog Header Back | No route change | No tab change | Same presentation close policy |
| Browser Back | Vue Router owns transition | `useRouteSync` reconciles non-empty path; `/vault` null path is current no-op | Presentation observes final route/scope/tab state |
| Scope switch | No route navigation | Tabs/activePath unchanged | Close Diary presentation when leaving Diary |
| Refresh | Existing Vault route and persisted-tab restoration run | Existing `useEditorTabs` restores tabs and active path; Dialog state is not URL-backed | Do not restore Dialog in D6 MVP |
| Reopen same date | Exact `getPost` then existing `openPost` | Existing tab reused | Presentation can reopen Reader for same identity |
| Open different Diary date | Exact command then existing open/create flow | Existing/new tab selected | Presentation follows resulting identity |
| Backing tab closed externally | Existing close lifecycle changes tabs/activePath and may navigate | Model disposal and dirty policy remain existing | Presentation exits if its backing identity no longer exists |
| Document deleted/recovered externally | `fileChanges`, external-file workflow, History/Recovery/Draft seams update state | Existing workflow decides close/orphan/recovery behavior | Presentation never retains stale independent raw; reconcile/exit |

## 11. Ownership matrix

| Concern | Current owner | Current file/seam | D6 owner | Allowed change | Forbidden change |
| --- | --- | --- | --- | --- | --- |
| Router | Vue Router | `src/router/index.ts` | Existing Router | Observe route result | New Diary route, popstate interception |
| Diary scope | Scope singleton + NavBar | `useScopeFilter.ts`, `NavBar.vue` | Existing scope owner | Observe `activeScope` | Dialog-owned scope switching |
| Calendar mount | VaultView Diary scope | `VaultView.vue` `isDiaryCalendarMounted` | Existing mount seam | Preserve `v-if` scope lifetime | Synchronous unmount on date click |
| Calendar visibility | VaultView D5 predicate | `isDiaryCalendarMode` | D6 presentation mode | Decouple from tab count | Reuse `workspaceTabs.length === 0` as sole rule |
| Date command | `useDiaryDateCommand` | `useDiaryDateCommand.ts` | Existing command | Add post-command presentation handoff | Parallel create/open command |
| Document identity | Diary protocol + API | `shared/diaryProtocol.ts`, API | Existing domain/lifecycle | Consume identity | New Diary entity or suffix |
| Tabs | `useTabWorkspace` | `useEditorTabs.ts`, `useTabWorkspace.ts` | Existing tab workspace | Reuse backing tab | Second tab store or Dialog tab |
| Active path | `useTabWorkspace` | `activePath` ref | Existing tab workspace | Observe | Dialog mutation on close |
| Route sync | `useRouteSync` | `editor-tabs/useRouteSync.ts` | Existing route sync | Observe resulting route | Dialog router navigation |
| Raw Markdown | `Tab.raw` | `useEditorTabs`, `useDocumentSave` | Existing tab | Pass to presentation | Presentation raw copy/store |
| Editor model | Monaco + path registry | `monacoModels.ts`, `monacoModelRegistry.ts` | Existing EditorPane strategy | One-instance adapter | Duplicate Monaco lifecycle |
| Save | `useDocumentSave` | `editor-tabs/useDocumentSave.ts` | Existing save owner | Invoke existing commands | Dialog save pipeline |
| Dirty state | Tab revisions/save status | `Tab`, `useDocumentSave`, close guard | Existing document lifecycle | Preserve while Dialog closes | Dirty confirmation on presentation close |
| Draft | Draft persistence/recovery | `draft-recovery/*`, VaultView | Existing draft owner | Reuse state | Dialog-local draft store |
| History | Vault-scoped history/comparison/restore | `useHistory*`, VaultView | Existing History workflow | Keep separate/rehost only with phase evidence | Diary History clone |
| Recovery | Draft recovery coordinator | `useUnsavedDraftRecovery`, VaultView | Existing Recovery workflow | Reconcile backing identity | Dialog-owned Recovery lifecycle |
| File changes | Vault file-change bus | `context/fileChanges.ts` | Existing bus | Observe/publish only through existing owners | New Diary bus |
| Reader rendering | `ReadingPane` + `RenderedMarkdown` | `ReadingPane.vue`, `RenderedMarkdown.vue` | Reuse existing Reader | One active Reader/TOC owner | Second Markdown pipeline |
| Dialog visibility | Not implemented | No current Diary Dialog | Future DiaryWorkspace | Presentation-only mode | Route/tab/document ownership |
| Reader/Editor mode | Not implemented | No current DiaryWorkspace | Future DiaryWorkspace | `HOME/READER/EDITOR` | Lifecycle duplication |
| Focus restoration | Existing component/shell focus seams | VaultView and existing panes | Future presentation adapter | Capture/restore focus | Focus logic that changes tabs/routes |

## 12. Unresolved questions with owners and target phases

These are not ownerless unknowns. Each is assigned to the phase that must produce the evidence.

| Question | Status | Owner / target phase |
| --- | --- | --- |
| How is Calendar Home decoupled from `workspaceTabs.length`? | Resolved as D6.1 seam: `presentationMode === HOME`; exact implementation deferred | D6.1 shell |
| With a backing tab, is the ordinary tab strip hidden, mounted, or unchanged in Home? | Deferred; current code shows the strip whenever workspace tabs exist | D6.1 product/presentation decision |
| How does Reader Dialog reuse the active document without duplicate TOC/Reader ownership? | Reuse seam confirmed; one-instance host strategy required | D6.3 Reader adapter |
| How does Editor Dialog avoid duplicate Monaco editor instances? | Risk confirmed; registry reuse alone is insufficient | D6.4 Editor adapter/lifecycle spike |
| How are History and Recovery presented while a Diary Dialog is open? | Existing workflows remain owners; Dialog integration policy deferred | D6.5 lifecycle regression |
| What happens when Browser Back changes to a different active document? | Router/tab flow confirmed; presentation reconciliation deferred | D6.5 lifecycle regression |
| What happens when backing tab is closed externally? | Existing tab close changes identity; Dialog exit condition deferred | D6.5 lifecycle regression |
| What does refresh do when route backs a document but Home is presented? | D6 MVP does not restore Dialog; existing route/tab restoration remains owner | D6.0 non-goal; D6.5 regression |
| How do focus trap and hidden Calendar satisfy accessibility? | Keep-mounted requirement confirmed; focus/inert implementation deferred | D6.6 accessibility |
| `/vault` Browser Back leaves `activePath` potentially unchanged because `pathMatch` is empty | Current fact recorded; no route/tab mutation is authorized by D6.0 | D6.5 must define presentation-only reconciliation |

## 13. Risks and mitigations

| Risk | Evidence/mitigation | Stop signal |
| --- | --- | --- |
| Calendar Home remains coupled to tab count | D6.1 replaces the visibility predicate with presentation mode while preserving mount ownership | D6.1 requires document/tab mutation to show Home |
| VCalendar `dayIndex` regression returns | Preserve `v-if` mount by Diary scope and hidden-but-mounted behavior from `ed47c94` | Any synchronous unmount workaround or new page error |
| Dialog becomes a second document system | Ownership matrix forbids second tab, raw, save, draft, History, Recovery, or route state | New Diary-specific lifecycle appears |
| Duplicate Monaco instances | `acquireMarkdownModel` reuse does not make two EditorPane instances safe | D6.4 cannot guarantee one editor instance per path |
| Browser Back is hijacked | Router remains authoritative; presentation only observes | popstate interception/fake history/router simulation |
| Dirty content is discarded on Dialog close | Presentation close leaves tab/raw/revision/draft intact | `closeTab`, discard, or dirty confirmation from Dialog close |
| Reader TOC state conflicts | Existing `ReadingPane` is keyed to one active path and publishes Vault-scoped TOC | Multiple active Reader instances publish competing TOC state |
| History/Recovery gets copied into Diary | Existing Vault workflows remain authoritative | Diary-specific History/Recovery/Draft store |
| Scope and route disagree | Presentation observes both and exits when Diary scope is no longer active | Dialog takes ownership of scope or router |

## 14. D6.1 readiness gate

The current code evidence supports a presentation-only D6.1 seam. The following are confirmed:

- [x] Current Router ownership confirmed;
- [x] Diary scope ownership confirmed;
- [x] Calendar mounted ownership confirmed;
- [x] Calendar visibility ownership and `workspaceTabs.length` coupling identified;
- [x] D6 presentation decoupling seam identified;
- [x] `openDiaryDate()` single ownership confirmed;
- [x] `openPost()` and tab lifecycle confirmed;
- [x] Browser Back ownership confirmed;
- [x] Dialog Close presentation-only feasibility confirmed;
- [x] Reader reuse seam identified;
- [x] Editor reuse seam identified;
- [x] duplicate Monaco risk explicitly analyzed;
- [x] save/dirty ownership confirmed;
- [x] History, Recovery, Draft, and file-change ownership confirmed;
- [x] scope-switch and backing-tab reconciliation owners assigned;
- [x] no new route required;
- [x] no second tab store required;
- [x] no second lifecycle or server/domain change required;
- [x] VCalendar keep-mounted contract preserved;
- [x] every unresolved question has an owner/target phase;
- [x] no D6.1 code written.

D6.1 minimum allowed seam:

```text
VaultView / future DiaryWorkspace presentation boundary
    ├─ own HOME / READER / EDITOR presentation mode
    ├─ derive Calendar visibility from presentation mode
    ├─ preserve Calendar mount by Diary scope
    ├─ consume active tab/raw/path through VaultContext
    └─ reconcile route/scope/tab changes without owning them
```

Forbidden D6.1 seams:

- new Diary route or Dialog URL;
- `router.back()`, `router.replace('/vault')`, or `popstate` interception for Dialog close;
- `closeTab()` or dirty discard from presentation close;
- second tab store, raw copy, save pipeline, draft store, History, Recovery, or Markdown renderer;
- second Monaco model/editor lifecycle for the same document;
- changes to D1/D2 domain contracts, server Diary API, or `openDiaryDate()` ownership;
- removal or timing-based replacement of the `ed47c94` keep-mounted workaround.

## 15. STOP conditions checked

```text
New Diary route required                         NO
Second tab store required                       NO
DiaryEditor required                            NO
Second Monaco model lifecycle required          NO; duplicate-instance risk is deferred to D6.4
Second save pipeline required                   NO
Second Reader pipeline required                 NO
D1/D2 contract change required                  NO
Server Diary API change required                NO
openDiaryDate ownership change required         NO
Keep-mounted workaround removal required        NO
popstate interception required                  NO
Dialog close must call closeTab                 NO
Presentation must own raw/dirty/save            NO
D6.1 cannot use presentation-only seam           NO, seam identified
```

The `/vault` empty-`pathMatch` behavior is recorded as a current-code reconciliation fact, not hidden or promoted into a new router contract. It has a named D6.5 owner and does not authorize a D6.0 code change.

## 16. Evidence commands and limitations

Static evidence commands used:

```text
git status --short --branch
git rev-parse HEAD
git log -5 --oneline --decorate
git show ed47c94 -- src/views/VaultView.vue
rg --files src server shared
rg -n "openDiaryDate|openPost|isDiaryCalendarMounted|isDiaryCalendarMode|workspaceTabs|activeScope|useRouteSync|..."
```

This phase did not run typecheck, build, Vitest, or Playwright. No historical test result is re-labelled as a new D6.0 run. GitHub status was not queried during this task.

## 17. Conclusion

Current production code confirms that D6 can be implemented through a presentation-only seam without copying document lifecycle ownership:

```text
D6.0 = REVIEW-READY
D6.1 = NOT STARTED
```

The key implementation gate for D6.1 is explicit:

```text
backing tab exists
    ≠
Calendar Home must be hidden
```

D6.1 may decouple Calendar visibility from tab count, but must preserve the Diary-scope keep-mounted lifetime, existing date command, existing tab/document identity, route ownership, save/dirty state, Reader/Editor reuse, History, Recovery, Draft, and Browser Back boundaries. This evidence is ready for independent review. No D6.1 implementation has started.
