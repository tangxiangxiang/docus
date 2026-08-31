# D8.3 — Privacy Enforcement PRD

Status: `PLAN-READY` after this planning task; implementation has **not** started. The repository remains at D8.2 `REVIEW-CLOSED`; D8.3 and D8.4 remain `NOT STARTED`.

This is a source-backed design record. It intentionally does not change production code, tests, CI, Docker configuration, security behavior, or legacy data.

## 1. Status / lifecycle

The required baseline was rechecked rather than assumed:

```text
HEAD:   fe5e0d08580058376c2d8c15045d1ce1ddae9c8f
branch: main
tree:   clean before this document-only change
HEAD~0: docs(diary): sync D8.2 lifecycle entry point
HEAD~1: fix(ci): restore diary browser and production boundaries
```

`fe5e0d0` is a docs-only synchronization commit after the prompt’s expected
`8710acfd7964c690b3ac26d30e2f9b13479b7f53`; it is not a D8.3 implementation
change. `docs/design/diary-encryption-d8.2-body-storage.md` and the canonical
`docs/design/diary-encryption-implementation-plan.md` both record D8.0,
D8.1, and D8.2 as `REVIEW-CLOSED` with self-review and independent review
`PASS (P0/P1/P2 = 0/0/0)`, and D8.3/D8.4 as `NOT STARTED`. No lifecycle drift
was found at the actual HEAD.

The prompt supplied CI run `#587` / run id `33328478854` with 8/8 required
jobs passing. That result is recorded as supplied baseline evidence; this
planning task does not re-run or alter CI.

The intended lifecycle after implementation is:

```text
NOT STARTED → PLAN-READY → IMPLEMENTING → REVIEW-READY
→ Independent Review → remediation (if required)
→ Independent Re-review PASS → docs-only closure → REVIEW-CLOSED
```

Passing tests or green CI alone must not be recorded as an independent-review
pass.

## 2. Background

D8.0–D8.2 established authenticated encrypted primary storage for a managed
Diary document whose canonical identity is `diary/YYYY-MM-DD.md`. D8.3 is the
privacy-enforcement phase: it must follow the plaintext from an authorized
read through editing, derived data, conflicts, exports, and teardown. The
security question is:

> After a managed Diary body becomes authorized plaintext, can it reach an
> uncontrolled durable or long-lived plaintext surface, or can an old async
> result publish it after the session is locked?

The D8.3 closure answer must be provably **no**. When an existing surface has
no safe owner, disabling that surface for managed Diary is preferred to adding a
second crypto, history, cache, or session subsystem.

## 3. D8.2 inherited contracts

These contracts are frozen and are not redesigned by D8.3:

| Contract | Inherited rule |
| --- | --- |
| Managed identity | One date maps to one `diary/YYYY-MM-DD.md` managed document; stable `documentId` remains owned by `DocumentMetadata`. |
| Workspace | Reuse Calendar, Native Vault workspace, ReadingPane, EditorPane, existing tabs, route, dirty/save/CAS lifecycle, and metadata owner. No Diary-specific editor, reader, workspace, tab lifecycle, or route. |
| Session authority | `useDiaryAccessSession` is the sole client authority with `UNINITIALIZED`, `LOCKED`, `UNLOCKING`, `UNLOCKED(sessionEpoch)`, `LOCKING`; server `diaryAccess/service.ts` is the sole capability/body-operation authority. |
| Key material | Secondary password, KEK, unwrapped DEK, capability, and plaintext body are ephemeral runtime values only. They never enter local/session storage, IndexedDB, SQLite, Git, URLs, logs, telemetry, storage state, traces, or error artifacts. |
| Envelope | AES-256-GCM, fresh 96-bit nonce per write, 128-bit tag, explicit version/algorithm, vault/document/path/version AAD, fail closed on unknown/malformed/identity/auth failure. |
| Primary body | Diary routes create/read/save through the existing body operation and persist the authenticated envelope; plaintext is returned only to an authorized operation. |
| Ordinary Note | Ordinary Note behavior remains unchanged unless a shared infrastructure fix is required and covered by explicit Note regressions. |

## 4. Problem statement

The primary save path is encrypted, but existing lifecycle surfaces are broader
than `PUT /api/posts/*`. Source inspection found:

* History route guards reject managed Diary in HTTP callers, while the actual
  Git mutation owner `server/history/git.ts:addAndCommit` is generic and can
  still receive a mixed path batch.
* `server/linkIndex.ts` has an unguarded singleton rebuild/query path and Diary
  save/create currently call `applyWrite(logicalPath, raw)`, retaining plaintext
  links/title in long-lived server memory. Cold generic rebuild can parse an
  encrypted envelope as Markdown.
* IndexedDB `drafts` and `draftConflicts` store `content` strings from
  `useUnsavedDraftPersistence`; disposal/pagehide can flush them without a
  Diary policy.
* Client search `primeBody()` stores response bodies in a module-level
  `bodyCache`, and search results have no authoritative Diary session epoch.
* Folder delete lacks the managed-Diary preflight that folder rename has;
  rename/reference journals and staging APIs serialize raw before/after data
  when their callers are not blocked.
* External-conflict, history-comparison, recovery-tab, current-note, Monaco,
  PDF, clipboard, and AI context paths hold or transmit plaintext in memory;
  lock teardown currently does not synchronously clear every holder or suppress
  every late result.
* Metadata migration exposes `frontmatterBackup` records and scans raw Markdown
  at startup; title/summary/tags in SQLite are privacy-sensitive even though
  Mood and canonical date/path are approved structural metadata.

## 5. Security goals

1. Every managed-Diary body-bearing surface uses the D8.2 adapter/authorized
   body operation, fails closed, or is an explicit user-created external copy.
2. No new managed-Diary body revision (plaintext, ciphertext, envelope, temp,
   recovery, restore, rename, move, or reference rewrite) enters a new vault
   Git commit.
3. No new managed-Diary plaintext enters filesystem temp/staging/journals,
   IndexedDB, SQLite backups, LinkIndex, persistent search, logs, telemetry,
   traces, screenshots, storage state, or failure artifacts.
4. Locked, logged-out, auth-invalidated, expired, and replaced sessions expose
   no Diary body or body-derived preview.
5. A result started under session epoch `E1` cannot repopulate a cache, tab,
   dialog, DOM, index, or model after lock advances the authoritative epoch.
6. Unknown or malformed encrypted envelopes never flow to Markdown,
   frontmatter, link, search, or AI parsers.
7. Ordinary Note read/write/history/recovery/search/link/rename/move/conflict/
   export/tree behavior remains unchanged.

## 6. Non-goals

* No new production implementation in this planning task.
* No retroactive rewrite, purge, deletion, or migration of legacy plaintext
  primary files, Git history, IndexedDB drafts/conflicts, or metadata backups.
* No encrypted IndexedDB draft crypto owner, encrypted Diary Git history, or
  Diary-specific LinkIndex in D8.3 MVP.
* No claim that a user’s OS clipboard or an explicitly downloaded PDF can be
  wiped by Docus.
* No change to ordinary Note semantics and no second Diary lifecycle owner.
* No promise to protect an already compromised/unlocked browser or server
  process, developer tools, or user-authorized external copies.

## 7. Threat model

D8.3 protects a local filesystem/database/Git/diagnostic reader who does not
possess the Diary secondary password. It covers server and browser memory
retention, durable temporary files, cache/index derivation, lifecycle races,
and artifact collection. It does not protect plaintext while an authorized
operation is actively rendering or editing, nor content the user deliberately
copies to the clipboard or downloads as a PDF. Those explicit copies must be
user-visible and are outside Docus’ automatic storage guarantee.

The primary login password, `DOCUS_MASTER_KEY`, and AI credential encryption
are separate concerns. D8.3 must not reuse them as a second Diary key owner.

## 8. Privacy classification

| Data | Classification | Locked visibility | Durable plaintext allowed? | D8.3 disposition |
| --- | --- | --- | --- | --- |
| Diary body | secret | No | No | Adapter/authorized memory only; otherwise reject. |
| Secondary password | secret | No | No | Existing session owner only. |
| KEK / DEK | secret | No | No | Existing server/client ephemeral owners only. |
| Diary capability | secret | No | No | `diaryAuthFetch`/body lease only; never ambient storage. |
| `documentId` | structural | Yes when approved | Approved metadata only | Keep in `DocumentMetadata`; never body-derived. |
| Canonical date/path | structural | Yes | Yes | Calendar/tree/list identity projection. |
| Existence | structural | Yes | Yes | File/tree existence is allowed. |
| Mood | structural product metadata | Yes per D7 contract | Yes | Keep existing metadata owner. |
| Title | privacy-sensitive metadata | No unless explicitly approved | No new plaintext Diary title | Locked projection is basename/date; no body/frontmatter extraction. |
| Summary | privacy-sensitive metadata | No | No new plaintext Diary summary | Hide from locked list/tag/search; D8.4 handles old rows. |
| Tags | privacy-sensitive metadata | No | No new plaintext Diary tags | Hide from locked list/tag/search; D8.4 handles old rows. |
| Links/backlinks | body-derived metadata | No | No | Exclude managed Diary from body-derived LinkIndex in MVP. |
| Search snippets | body-derived secret | No | No | Diary body search disabled in MVP. |
| Draft/conflict body | secret | No | No persistent plaintext | Persistent managed-Diary draft/recovery disabled; memory only. |
| PDF | explicit user copy | N/A | Outside automatic guarantee | Allow only while unlocked/current epoch; browser memory rendering. |
| Clipboard | explicit user copy | N/A | Outside automatic guarantee | Allow only while unlocked/current epoch; do not claim OS wipe. |
| Logs/telemetry/artifacts | security metadata | No body/keys | No | Structured identifiers only; canary and artifact-grep gates. |

## 9. Complete plaintext / derived-data graph

The table records production evidence, not file-name guesses. “Current locked
behavior” describes the inspected code; “D8.3 target” is the required policy.

| Surface | Entry point | Current owner / source evidence | Reads plaintext? | Persists plaintext? | Lifetime | Current locked behavior | D8.3 target |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Primary read | `GET /api/posts/:path` | `server/routes/posts.ts` managed GET → `withDiaryBodyOperation` → `readDiaryBody` / decrypt | Yes in operation | Ciphertext file only on successful primary storage | Request/response + tab memory | `requireDiaryBodyAccess` returns `423 diary-locked` | Keep adapter/lease; bind response publication to session epoch. |
| Primary save | `PUT /api/posts/:path` | `server/routes/posts.ts:saveManagedDiary` → CAS → `prepareAtomicTextWrite` with envelope | Yes in request memory | Encrypted envelope | Request/atomic write | Locked request rejected | Keep; prohibit raw bytes at durable writer for managed paths. |
| Diary create | `POST /api/diary/dates` | `server/routes/diary.ts` creates raw in memory, encrypts, commits metadata | Yes in request memory | Encrypted envelope; metadata | Request + tab | Access required | Keep; make LinkIndex update structural/no-op for body. |
| History list/log | `/api/history/log`, `/file`, `/diff`, `/content-hashes` | `server/history/routes.ts` + `rejectEncryptedDiaryHistory` | Git raw/diff can be body-bearing | Git legacy data | Request | Managed path currently 422 at guarded routes; status is structural | Keep explicit 422; add service/mutation-owner defense. |
| History commit | `/api/history/commits` | Route → `withVaultMutation` → `server/history/git.ts:addAndCommit` (`git add`, `hash-object`, `update-index`, `write-tree`, `commit-tree`, `update-ref`) | Accepts raw/captured bytes | Git object/index/commit | Durable Git | Route guard only | Reject any managed path before any Git mutation, including mixed batches. |
| History restore | `/api/history/restore` | `server/history/restore.ts:restoreHistoricalDocument` → atomic write from historical raw | Yes if caller bypasses route | Filesystem temp/primary | Request + file | Route 422 for managed | Keep fail-closed route and service; no managed restore until encrypted-history owner. |
| Generic recovery | `PUT /api/recover/:path` | `server/routes/posts.ts` recovery route | Raw request body | Atomic file/metadata | Request + file | Managed identity rejected (`diary-recovery-identity-required`) | Keep rejection; no plaintext recovery payload. |
| Draft | `useUnsavedDraftPersistence.schedule` | `src/.../useUnsavedDraftPersistence.ts` → `draftStore.save` | `snapshot.content` | IndexedDB `drafts` (`docus-draft-recovery`) | Until clear/retention | No Diary classification | Disable managed-Diary writes; no pagehide/dispose flush; memory editing only. |
| Draft conflict | `saveConflict` / `saveConflictCandidate` | `src/.../draftStore.ts`, `draftTypes.ts` (`content` field) | Yes | IndexedDB `draftConflicts` | Until conflict clear | No Diary classification | Disable managed-Diary persistence; do not read legacy records while locked. |
| Recovery discovery/read | `draftRecovery.discover`, `readDisk`, `classify` | `useUnsavedDraftRecovery.ts`, `DraftRecoveryPane.vue` | Draft and disk raw | Recovery tab refs | Component/session | Discover runs on vault id; no Diary filter | Filter managed Diary; unavailable message; clear on epoch change. |
| Search index | `buildIndex(posts)` | `src/lib/search.ts` / `searchResults.ts` MiniSearch fields | Title/summary/tags, not body in this step | Module memory | Module lifetime | Existing summaries may remain | Exclude managed Diary private fields; structural date/path only. |
| Search preview/body cache | `primeBody(posts)` → `/api/posts` | `src/lib/search.ts:bodyCache` | Yes (`data.content`) | Module `Map` | Until `dispose()` | No lock/epoch check | Do not prime Diary; clear cache/results on lock/logout/expiry; epoch-gate runners. |
| Server body cache | No standalone owner found in inspected `server/` source; LinkIndex is the long-lived derived holder | `rg` found no generic `bodyCache` server module; runtime instrumentation remains required | **UNRESOLVED** for undiscovered runtime cache | **UNRESOLVED** | **UNRESOLVED** | Must not assume absence | D8.3 gate: prove no cache or classify/disable it; any discovered Diary body cache is STOP-1. |
| LinkIndex build | `getIndex()` / `rebuild()` | `server/linkIndex.ts` reads `.md`, extracts links/title; `routes/links.ts` calls unguarded `getIndex()` | Yes; cold generic rebuild can parse envelope as Markdown | Singleton `Map` forward/paths/titles | Process lifetime | Query can expose warm data after lock | MVP keeps structural paths only; never read/parse/store managed Diary body-derived data. |
| Backlinks/outgoing | `/api/links/index`, `/backlinks`, rename impact | `server/routes/links.ts` → `linkIndex` snapshot/backlinks | Derived from body | Server singleton + client `useLinkIndex` state | Process/client lifetime | No Diary epoch filter | Filter managed source/target; clear client state on lock; ordinary Note rows unchanged except suppressed Diary edges. |
| Tree | `/api/tree` | `server/tree.ts:buildTree` / `walk` | Managed path uses empty frontmatter; ordinary path reads frontmatter | Response/tree reactive state | Request/client view | Structural Diary node visible | Preserve date/path/existence/mood/id; never parse envelope. |
| List | `/api/posts` | `server/tree.ts:listPostsFlat`, `server/routes/posts.ts` | Managed path uses empty frontmatter; metadata row may contain private fields | Response/client posts | Request/client view | Public projection partly strips fields | Hide title/summary/tags for managed Diary while locked and prevent new private derivation. |
| Metadata preview | `/api/metadata/:id`, tag management | `server/routes/metadata.ts:publicManagedDiaryMetadata`; `server/tagManagement.ts` | Can read DB private fields | SQLite `documents` | Durable | Public ID projection exists; tags endpoints unguarded | Return only approved projection; exclude managed Diary from tag/private metadata surfaces. |
| Metadata migration | startup + `/api/metadata/migration` | `server/metadataMigration.ts`, `frontmatterArchive.ts`, `server/prod.ts`, `vite-plugin.ts` | Scans raw Markdown/frontmatter | SQLite `frontmatter_backup` | Durable | Migration listing exposes failure records | Skip managed Diary for new scans/backups; filter legacy backups; D8.4 owns cleanup. |
| Document rename | `PATCH /api/posts/:path` | `server/routes/posts.ts`, `documentMutationPolicy.ts`, `useDocumentLifecycle.ts` | Reads source/reference raw for generic rewrite | Rename journal/temp/files | Request + durable journal | Managed rename currently 422 | Keep fail closed before read/journal/filesystem mutation. |
| Folder move/rename | `PATCH /api/folders/:path` | `server/routes/folders.ts`, folder transaction/journal modules | Reads subtree/reference raw | Durable v4 journal/staging | Request + recovery window | Rename footprint rejects managed; delete does not | Reject any managed-Diary footprint before staging/journal; no partial move. |
| Folder/document delete | `DELETE /api/folders`, `DELETE /api/posts` | `server/routes/folders.ts` / `posts.ts` stage `.docus-delete-inflight-*`, then LinkIndex update | Raw bytes may be read for reindex/rollback | Staging/journal/metadata snapshots | Until cleanup/recovery | Folder/post delete lacks uniform managed preflight | Reject managed/mixed footprint before stage; explicit user deletion policy is separate from migration. |
| Reference rewrite | `renameReferences`, `renameReferenceJournal` | `server/renameReferences.ts`, journal/owner-binding modules | Parses and serializes raw before/after | Durable journal payloads | Recovery window | Caller preflights some Diary footprints | Reject if any managed source/target; no partial rewrite. |
| External conflict | disk watcher + save CAS | `useExternalFileChanges.ts`, `useDiskFileChanges.ts`, `useDocumentSave.ts` | `tab.raw`, `externalRaw`, conflict response | Usually memory; draft conflict can be IndexedDB | Tab/session | No Diary epoch; dialogs can outlive lock | Authorized memory only; clear/invalidate on epoch; never render envelope as Markdown. |
| History comparison/diff | Vault history UI | `useHistoryComparisons.ts`, `useWorkingTreeDiffs.ts` | `beforeRaw`, `afterRaw`, diff strings | Vue refs | Until deactivate/unmount | deactivate clears active id, not raw refs | Clear all body refs and gate loaders by authoritative epoch. |
| PDF export | `exportPdfDocument` | `src/lib/pdfExport.ts`, `PdfExportSurface.vue`, `VaultView.vue` | Live tab/getPost raw; DOM clone | Browser download is explicit external copy; no server temp found | Request/DOM/download | No lock epoch | Permit only unlocked/current epoch; cancel/ignore on lock; no automatic cleanup claim for download. |
| Clipboard | `VaultView.copyActiveContent` | `navigator.clipboard.writeText` from active tab/recovery/history raw | Yes | OS clipboard (external) | OS/user controlled | No authorization check in current source | Require current authorization; user-visible external-copy semantics; do not wipe on lock. |
| Logs | server startup/routes and browser console | `server/prod.ts`, `vite-plugin.ts`, route logs, client logging | Intended identifiers only; arbitrary error serialization risk | Log files/process output | Process/log retention | No body-specific guarantee | Structured redaction, no body/keys/envelope; canary tests. |
| Failure artifacts | E2E fixture/Playwright | `e2e/fixtures/diary.ts`, `playwright.config.ts`, traces/screenshots/attachments | Diagnostics include paths/state, not body; binary artifact coverage is separate | Attachments, trace/screenshot files | Test result retention | Diary specs use trace off; defaults retain failures | Secret-bearing profile disables trace/video/screenshot or proves scrub; artifact grep gate. |
| Editor model | `EditorPane`/Monaco registry | `tabState.ts`, `useEditorTabs.ts`, `monacoModelRegistry.ts` | `Tab.raw/originalRaw/externalRaw` | No durable raw in tab persistence; model memory | Until close/lock/unmount | `clearManagedDiaryWorkspace` is best-effort and does not await draft dispose | Synchronous epoch invalidation, dispose/clear models and tab refs before new publication. |
| Reader DOM/render | `ReadingPane`, `useMarkdownRender` | Vue raw props, TOC/render AbortController | Yes | DOM/browser memory | Until replacement/unmount | Watch resets TOC; lock does not own all render cancellation | Abort render, clear DOM/TOC, reject stale completion by epoch. |
| Route hydration/current note | route mirror | `useCurrentNote.ts`, `createVaultContext.ts` | Live tab/getPost raw | Vue refs/context | Route/session | No Diary epoch filter | Guard route hydration and clear route mirror on lock; no auto-open from stale result. |
| Tab persistence | localStorage | `useTabPersistence.ts` stores paths/active only | No body | Path/existence structural only | Across reload | Diary paths restore deferred while locked | Keep structural paths; ensure no raw/model restoration and clear sensitive view/recent-link keys. |
| Browser recent/view cache | localStorage + module caches | `EditorPane.ts` recent wiki links/view state; search/link modules | Paths/view state; recent links are body-derived navigation | localStorage/module memory | Across reload/module lifetime | No lock clear | Remove managed-Diary entries on lock or disable recording; clear module caches/results. |
| AI live context | `AiPanel` send | `aiLiveContext.ts` captures document/diff/recovery raw; `server/ai/chat.ts` sends provider | Yes | Server comments say not persisted, but provider/user prompt is external | Request/provider | Tool guards do not cover snapshot | Disable managed-Diary live context/summary/commit-message/body tools until explicit external-copy contract. |
| Markdown resources | `/api/markdown-resources` | `server/routes/markdownResources.ts` guard + client resolver promise cache | Resource snippets/body | Per-render promise Map only | Render | Access guard exists; no epoch cancellation | Keep guard, abort/clear resolver on lock, never cache across epochs. |

## 10. History / Git

### 10.1 Owner and current enforcement

The call graph is:

```text
POST /api/history/commits
  → server/history/routes.ts
  → withVaultMutation()
  → server/history/git.ts:addAndCommit()
  → git hash-object / add / update-index / write-tree / commit-tree / update-ref
```

`server/history/routes.ts` currently calls
`rejectEncryptedDiaryHistory()` and `requireDiaryBodyAccess()` for managed
paths. The guard is route-level. `addAndCommit()` itself is generic and writes a
temporary Git index under `os.tmpdir()`; it has no managed-Diary exclusion. All
current `addAndCommit` callers are in the history route, but the invariant must
not depend on that caller inventory remaining complete.

### 10.2 Frozen D8.3 policy

The mutation owner must reject a batch before `git add`, `hash-object`,
`update-index`, temp-index creation, tree creation, or ref update when any
normalized path is managed Diary. A mixed Note + Diary batch is rejected as a
whole and performs no Git mutation. History status may continue to expose
structural state, but body-bearing log/file/diff/restore and new Diary commits
remain explicit fail-closed operations. Legacy Diary Git objects are neither
rewritten nor purged in D8.3.

The same policy is applied at `restoreHistoricalDocument`/document mutation
service boundaries so a new non-HTTP caller cannot write a Git Diary blob into
the filesystem. Ordinary Note history keeps its existing add/commit/restore
behavior.

### 10.3 History acceptance checks

Tests inspect Git objects, not only HTTP status: Diary create/save/recovery/
restore/rename attempts leave `git log`, `git diff-tree`, tree entries, object
counts, and refs unchanged; a mixed batch leaves them unchanged; Note commit and
restore tests continue to pass.

## 11. Draft / Recovery

`draftTypes.ts` defines plaintext `content: string` for `UnsavedDraft` and
`DraftConflictRecord`. `draftStore.ts` opens IndexedDB database
`docus-draft-recovery` (version 2) with `drafts` and `draftConflicts` stores;
`save`, `saveConflict`, `saveConflictCandidate`, `moveFamily`, and cleanup
operate on cloned plaintext objects. `useUnsavedDraftPersistence.ts` schedules
`snapshot.content` writes, pagehide flushes, and `dispose()` flushes. Recovery
discovers and reads those objects in `useUnsavedDraftRecovery.ts`; recovery tabs
retain `draftRaw`/`diskRaw` refs.

The D8.3 MVP decision is **disable persistent managed-Diary draft/recovery**.
This avoids a second IndexedDB crypto owner and keeps editing in existing tab
memory while unlocked. Managed Diary drafts are not written on change,
pagehide, dispose, or crash-like flush. Recovery UI reports that Diary recovery
is unavailable; ordinary Note drafts remain unchanged.

Legacy plaintext records are not silently read, migrated, or deleted. A locked
session filters them before any body read. D8.4 owns an explicit migration or
discard flow with inventory, user-visible confirmation, idempotence, and
rollback. An explicit user discard may be added only with that D8.4 contract;
D8.3 must not turn cleanup into implicit migration.

## 12. Search / cache

`src/lib/search.ts` builds a MiniSearch index from title/path/tags/summary and
`primeBody()` fetches every post body into module-level `bodyCache`. The
`searchResults.ts` provider primes bodies for a non-empty query, while its
latest-runner version only protects UI ordering. No IndexedDB or persistent
server search body cache was found in the inspected source; a runtime
instrumentation check is a D8.3 gate for the unresolved server-cache row in the
graph.

The D8.3 MVP disables managed-Diary body search. Structural canonical date/path
may remain searchable; private title/summary/tags and body snippets may not.
`primeBody()` must exclude managed paths, existing Diary cache entries and
results must clear on lock/logout/expiry, and every provider/render completion
must compare the authoritative Diary session epoch. Ordinary Note search is
unchanged.

## 13. LinkIndex

`server/linkIndex.ts:rebuild()` walks Markdown files, parses frontmatter and
links, and stores forward links, paths, and titles in a process singleton.
`getIndex()` is unguarded and is used by `server/routes/links.ts`; only the
special `getIndexForBodyOperation(canReadBody)` path performs a managed-body
preflight. `applyWrite()` currently accepts raw plaintext from Diary create/save
routes. Therefore both cold envelope-as-Markdown parsing and warm plaintext
retention are real current gaps.

D8.3 uses one structural LinkIndex policy, not a second Diary database:

* managed Diary contributes canonical path/existence only (and any explicitly
  approved structural date fallback), never body links, backlinks, snippets,
  frontmatter title, or decrypted title;
* cold rebuild skips managed Diary bytes before `fs.readFile`; incremental
  Diary writes/deletes/renames do not add body-derived entries;
* link/backlink/rename-impact snapshots filter any managed-Diary source or
  target edge; the client `useLinkIndex` clears state on lock/epoch change;
* ordinary Note-to-Note links are unchanged; suppressing a Note-to-Diary edge
  is intentional because the target relation is body-derived sensitive data;
* a warm legacy Diary projection is purged or, if that cannot be proven
  synchronously, the query fails closed. D8.4 handles legacy state inventory.

## 14. Tree / structural projection

`server/tree.ts` deliberately uses `emptyFrontmatter()` for managed Diary in
`listPostsFlat()` and `buildTree()`, while ordinary paths use `readFrontmatter()`
and `gray-matter`. This safe split is retained. Tree/list responses may expose
canonical date/path, existence, stable id, and Mood. They must not parse an
encrypted envelope, derive title/summary/tags from it, or expose old private
SQLite fields while locked.

`server/routes/metadata.ts` already has
`publicManagedDiaryMetadata()` for a locked public projection, but
`GET /api/metadata/migration` returns migration records (including
`frontmatterBackup`) without a whole-vault body gate. `metadataMigration.ts`
and `frontmatterArchive.ts` scan/parse raw files. D8.3 filters managed records,
prevents new managed scans/backups, and fails closed for managed cleanup,
restore, export, or private-field mutation unless an adapter-aware owner is
approved. D8.4 owns legacy backup cleanup. Tag management excludes managed
Diary private associations; Mood remains available.

## 15. Rename / move / rewrite

Envelope AAD binds vault identity, stable document id, canonical logical path,
and version. A ciphertext `mv` to a new path is therefore not a valid rename.

`documentMutationPolicy.ts` and the document PATCH route already reject managed
Diary rename. Folder rename has a reference-footprint preflight and rejects a
managed path; folder delete and document delete do not have equivalent uniform
preflight before `.docus-delete-inflight-*` staging. Generic
`renameReferences.ts`, `renameReferenceJournal.ts`, and folder transaction
modules serialize raw before/after data.

D8.3 freezes the smallest safe contract: managed Diary document rename, move,
folder rename/move/delete, bulk operations, and any reference rewrite whose
footprint contains a managed Diary fail closed before reads, journals,
staging, metadata mutation, LinkIndex mutation, or filesystem mutation. No
partial Note+Diary operation is allowed. A future re-encrypt/rebind transaction
is a separate design; D8.4 may specify it only with an identity proof,
authenticated decrypt/re-encrypt, atomic commit, and rollback.

## 16. Conflict handling

`useExternalFileChanges.ts`, `useDiskFileChanges.ts`, and
`useDocumentSave.ts` retain `tab.raw`, `originalRaw`, and `externalRaw` in
memory. `SavePostConflictError` can carry the current raw body. History
comparisons and working-tree diffs retain raw/diff refs; recovery tabs retain
draft/disk raw. `VaultView.showExternalDiff()` currently builds a confirmation
from raw slices. These are authorized runtime holders, not durable stores, but
the current lock watcher does not clear every ref or invalidate every pending
request.

For managed Diary, conflicts are memory-only while the authoritative session is
unlocked. The server must not return a managed body after the request has lost
its body lease. Client conflict models, dialogs, diffs, and externalRaw are
cleared synchronously when the Diary epoch advances. A stale confirmation,
save, disk read, or external-file event is rejected by epoch plus tab identity
and request token. Encrypted envelope bytes are never passed to Markdown,
frontmatter, diff, or recovery renderers.

## 17. Export / clipboard

`src/lib/pdfExport.ts` renders a browser DOM clone and calls `html2pdf().save()`;
the inspected path has no server PDF temp file. `VaultView.copyActiveContent()`
calls `navigator.clipboard.writeText()` for active/recovery/history/tab raw.

PDF and clipboard are supported only as explicit user actions while the current
Diary session is `UNLOCKED` and the request’s captured epoch is still current.
Lock/expiry/logout aborts or invalidates in-flight PDF rendering and removes its
temporary DOM; a late completion cannot download. A downloaded PDF or OS
clipboard is an explicit external copy outside Docus’ automatic storage
guarantee; Docus must not claim it can wipe that copy after lock.

## 18. Logging / diagnostics

`shared/sanitize-diagnostic.ts` redacts known password literals, sensitive query
parameters, bearer/auth/cookie headers, and caps diagnostic size. It does not
prove arbitrary body redaction. Server startup (`server/prod.ts`,
`server/vite-plugin.ts`), route errors, client console/error serialization, and
Playwright binary artifacts are separate surfaces. `e2e/fixtures/diary.ts`
attaches bootstrap NDJSON containing routes/scopes/dialog/tab paths; Diary specs
turn tracing off, while the global Playwright default retains failure traces.

D8.3 rules:

* never log body, password, KEK/DEK, capability, envelope/ciphertext, raw
  conflict, request/response body, or AI context;
* use structured identifiers, stable error codes, and sanitized metadata only;
* run representative failures with canaries such as
  `D8_3_BODY_SECRET_...`, `D8_3_PASSWORD_SECRET_...`, and
  `D8_3_CAPABILITY_SECRET_...`, then grep server output, logs,
  `test-results`, attachments, screenshots/metadata, and trace archives;
* use a secret-bearing Diary browser profile with trace/video/screenshot off,
  or prove a post-capture scrub. Sanitizing a text attachment does not scrub a
  binary trace or screenshot.

## 19. Lock teardown

`useDiaryAccessSession.clear()` synchronously advances the authoritative
generation/epoch and clears capability; server `diaryAccess/service.ts`
quiesces body-operation leases and zeroes the DEK. D8.3 adds one teardown
coordinator derived from that owner (not a second session state machine):

| Event | Required sequence |
| --- | --- |
| Explicit lock | Advance epoch synchronously → reject new body work → cancel timers/requests/render/worker tasks → clear tab/model/raw/external/conflict/recovery/history/search/link/PDF/context refs → clear sensitive localStorage entries → await best-effort disposal; server lease quiesces independently. |
| Logout | Auth generation and Diary epoch advance first; perform the same clear; suppress late auth/body responses. |
| Auth invalidation / `423` | Treat as lock immediately; no response body publication before the clear. |
| Capability expiry | Session owner invalidates epoch and server capability; all derived operations compare epoch before cache/UI publication. |
| Same-session capability replacement | Old epoch is fenced before new capability is visible; old requests cannot publish into the new session. |
| Application restart | No body or key is reconstructed from storage; only structural tab paths may restore. |
| Route/scope leave | Do not silently unlock or persist; clear body-specific views when leaving Diary scope. |
| Tab close/editor dispose | Cancel save/draft flush and clear raw/model refs; managed Diary draft persistence remains disabled. |

The lock watcher in `VaultView.vue` and `clearManagedDiaryWorkspace()` are
therefore coordination points to harden, not new authorities. Late result
tests must use `E1 → lock → E2` and prove no rehydration of UI, cache, tab,
LinkIndex, search preview, or renderer.

## 20. Unsupported behavior

The following statuses are frozen for D8.3 MVP:

| Capability | Status | User-visible behavior |
| --- | --- | --- |
| Primary Diary read/save/create | Supported through D8.2 adapter/lease | Works only while unlocked; lock is `423 diary-locked`. |
| Diary Git History/restore/diff/body log | Fail closed | Stable `422 diary-history-encrypted-unsupported`; no Git mutation. |
| Persistent Diary draft/conflict/recovery | Disabled | “Diary recovery unavailable”; no IndexedDB write/read for managed paths. |
| Diary body search/snippets | Disabled | Structural date/path remains available; no body result or cache. |
| Diary body-derived LinkIndex/backlinks | Disabled | Structural paths only; no links/title/snippets; filtered endpoint results. |
| Diary rename/move/delete/reference rewrite | Fail closed | Stable unsupported error before mutation; no partial mixed operation. |
| Private Diary title/summary/tags migration/tag mutation | Fail closed/filtered | Public date/path/Mood projection only; D8.4 owns old rows/backups. |
| AI live context, Diary summary, commit-message, body tools | Disabled | Stable unsupported error; ordinary Note AI remains unchanged. |
| Tree/list structural projection | Supported | Date/path/existence/id/Mood only; no envelope parsing. |
| PDF/clipboard | Explicit external copy | Current epoch/unlocked check; no OS/download wipe claim. |
| Markdown resources | Supported only with body operation | Guarded target, abort/clear on lock, no cross-epoch cache. |

## 21. User-visible semantics

* Calendar, tree, and list may show that a date/document exists and its Mood;
  they do not reveal private Diary title/summary/tags or body previews while
  locked.
* Opening a Diary while locked prompts for the existing unlock flow; there is
  no alternative editor or reader.
* History, recovery, body search, body-derived backlinks, rename/move, and
  private metadata actions show a stable “unavailable while encrypted” state,
  not a generic empty success and not ciphertext rendered as Markdown.
* A lock/logout immediately removes open Diary content, diffs, previews, AI
  context, and conflict dialogs. A late request is ignored rather than shown.
* PDF/export and copy are explicit actions. The UI states that the resulting
  download/clipboard is an external copy outside automatic Docus retention.
* Ordinary Note behavior and messaging remain unchanged.

## 22. Failure behavior

Existing stable contracts are reused:

| HTTP | Code | Use |
| --- | --- | --- |
| 423 | `diary-locked` | Missing/expired body access or lease. |
| 422 | `diary-history-encrypted-unsupported` | Managed Diary body History operation. |
| 422 | `diary-encrypted-rename-unsupported` | Managed document rename/move. |
| 422 | `diary-encrypted-reference-unsupported` | Reference/folder footprint includes managed Diary. |
| 422 | `diary-recovery-identity-required` | Generic recovery cannot create managed Diary. |

Names to approve before implementation (do not invent ad hoc strings in a
route) are:

```text
diary-draft-recovery-unsupported
diary-private-metadata-unsupported
diary-ai-context-unsupported
diary-ai-summary-unsupported
diary-ai-commit-message-unsupported
diary-session-invalidated
```

Filtered search/link/list endpoints return no body-derived Diary data rather
than exposing an error body. Every error response is `no-store`, contains only
stable code/message/path identity, and never includes raw content, envelope,
keys, or provider context. Unknown/malformed/identity-mismatched/auth-failed
envelopes stop at the adapter and are not passed to downstream parsers.

## 23. STOP conditions

Implementation and review stop immediately if any condition is observed:

1. Managed Diary plaintext reaches `fs.writeFile`, atomic temp/staging,
   journal, Git, IndexedDB, LinkIndex, persistent search, recovery payload,
   logs, trace, screenshot, or failure artifact.
2. Locked History, Recovery, Search, LinkIndex, tree/list, route, tab, or
   conflict surfaces return body or body-derived preview.
3. Gray-matter, Markdown, link, search, diff, or AI parser consumes an
   encrypted envelope or malformed bytes as document text.
4. A managed rename/move changes AAD-bound path without an authenticated,
   identity-checked, atomic decrypt/re-encrypt transaction.
5. A stale async result after epoch advancement rehydrates any UI/cache/index/
   tab/model or downloads an export.
6. A second key, unlock, session, body, or History owner is introduced.
7. A shared change alters ordinary Note semantics without independent review
   and Note regression coverage.

## 24. Acceptance criteria

D8.3 is implementation-ready only when the plan’s file map, test matrix, and
error contracts are approved. It is implementation-complete only when all of
the following are evidenced:

* Git mutation-owner tests prove no managed Diary object/tree/ref changes for
  create/save/recovery/restore/rename/move/reference/mixed batches, while Note
  history remains unchanged.
* IndexedDB inspection proves no new managed-Diary plaintext draft/conflict;
  lock/reload/crash-like flows do not read legacy records while locked.
* Search and LinkIndex canary tests prove no envelope parsing, no Diary body
  result/edge after lock, no stale repopulation, and unchanged Note results.
* Tree/list/metadata/tag/migration tests prove structural-only locked output,
  no new Diary frontmatter backups, and no private field leak.
* Rename/folder/delete/reference tests prove pre-mutation rejection and no
  journal/staging/metadata/filesystem partial state.
* Conflict/history/PDF/clipboard/AI/resource tests prove authorization,
  epoch fencing, and no envelope rendering or late publication.
* Lock/logout/expiry/replacement/restart/route/tab teardown tests clear every
  listed holder and suppress late results.
* Diagnostic canaries are absent from logs, server output, browser artifacts,
  attachments, traces, screenshots, and test result metadata.
* The eight supplied CI dimensions plus new D8.3 browser/negative suites pass
  without skip, retry, timeout, sleep, or platform-conditional masking.
* Independent review records `PASS (P0/P1/P2 = 0/0/0)` only after remediation
  and evidence review; docs-only lifecycle sync then marks `REVIEW-CLOSED`.

## 25. Deferred D8.4 scope

D8.4 owns legacy inventory and migration: plaintext primary files, legacy Git
history, IndexedDB drafts/conflicts, SQLite private metadata and
`frontmatter_backup`, mixed encrypted/plaintext state, idempotent migration,
rollback/recovery proof, and any approved encrypted Diary History/search/
LinkIndex/draft design. D8.3 may classify legacy state and prevent new leakage,
but it must not silently migrate, delete, rewrite, purge, or claim retroactive
protection.
