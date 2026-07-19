# Unsaved Draft Recovery — Design Spec

**Date:** 2026-07-19
**Status:** Accepted for staged implementation
**Scope:** Edit-09 — preserve unsaved editor buffers across abnormal exits without silently replacing newer disk content.
**Baseline:** Edit-08 is closed at `f094456`.

## 1. Principle

The file on disk is always the authoritative persisted document. An unsaved draft is
only a recovery copy of an editor buffer.

Recovering a draft must never silently write it to disk, replace a newer disk
version, select a destructive conflict outcome, or bypass the existing save,
external-change, rename, and close coordinators.

## 2. Goals

- Persist dirty editor buffers locally so refreshes, crashes, browser termination,
  and system restarts do not discard recent typing.
- Scope drafts to the current vault and a stable document identity.
- Record the disk baseline used when editing began so recovery can distinguish an
  unchanged disk file from a divergent one.
- Delete obsolete drafts after a confirmed clean save or an explicit discard.
- Preserve drafts when storage, network, rename, or recovery work fails.
- Support document rename, move, deletion, and duplicate-target transactions
  without losing either draft.
- Bound local storage use and expose enough metadata for a later recovery center.

## 3. Non-Goals

- Edit-09.1 and Edit-09.2 do not modify the editor, save pipeline, `VaultView`, file
  transactions, or recovery UI.
- Drafts are not server backups, revision history, collaborative edits, or an
  alternative save protocol.
- No draft is uploaded to the server or synchronized between browsers.
- No automatic merge is attempted in the first recovery UI.
- No third-party storage, hashing, diff, or compression dependency is added.

## 4. Draft Identity and Shape

```ts
interface UnsavedDraft {
  version: 1
  vaultId: string
  documentId: string
  documentPath: string
  content: string
  baseContentHash: string | null
  baseModifiedAt: number | null
  createdAt: number
  updatedAt: number
}
```

- `vaultId` is the stable identifier already returned by `/api/health`. Draft
  persistence does not start until a non-empty vault ID is available.
- `documentId` is the stable document identity supplied by the document lifecycle.
  It is never derived by parsing History or Diff tab IDs.
- The primary identity is `(vaultId, documentId)`.
- `documentPath` is current display and compatibility metadata. It is not the
  primary key.
- `content` is the complete editor buffer at `updatedAt`.
- `baseContentHash` identifies the authoritative disk content from which the dirty
  buffer diverged. Hash creation belongs to the integration phase; the store treats
  it as opaque.
- `baseModifiedAt` is the corresponding server modification time when known.
- `createdAt` is preserved when an existing draft is updated or moved.
- `updatedAt` is monotonic for accepted writes and drives recovery ordering and
  cleanup.

Malformed, unsupported-version, empty-identity, or impossible timestamp records are
ignored on read. A corrupt record must not make other drafts unavailable.

## 5. Storage

Draft bodies are stored in a dedicated browser IndexedDB database:

```text
database: docus-draft-recovery
object store: drafts
key: [vaultId, documentId]
index: vaultUpdatedAt → [vaultId, updatedAt]
schema version: 1
```

IndexedDB is preferred over `localStorage` because editor buffers can be large,
transactions are required for identity migration, and synchronous storage would
block the main thread. No new dependency is required.

The storage layer is asynchronous and best-effort. It exposes a backend boundary so
tests can use a deterministic in-memory backend. Opening or writing IndexedDB may
fail because storage is disabled, quota is exhausted, or the database is blocked;
callers receive a failure result and normal editing continues.

The Edit-09.2 API is:

```ts
saveDraft(draft): Promise<boolean>
getDraft(vaultId, documentId): Promise<UnsavedDraft | null>
listDrafts(vaultId): Promise<UnsavedDraft[]>
deleteDraft(vaultId, documentId):
  Promise<
    | { status: 'deleted' }
    | { status: 'missing' }
    | { status: 'unsupported' }
    | { status: 'failed' }
  >
moveDraft(vaultId, oldDocumentId, newDocumentId, newPath):
  Promise<
    | { status: 'moved' }
    | { status: 'missing' }
    | { status: 'conflict' }
    | { status: 'unsupported' }
    | { status: 'failed' }
  >
clearVaultDrafts(vaultId): Promise<boolean>
```

Rules:

- Inputs and outputs are copied so callers cannot mutate stored state by reference.
- `saveDraft` rejects an older `updatedAt` for the same identity; delayed work cannot
  overwrite a newer buffer.
- Equal timestamps are idempotent only when the complete record is equal; a
  conflicting equal-timestamp write fails closed.
- Updating an existing valid record preserves the first draft's `createdAt`.
- An occupied key containing a corrupt or unsupported-version record fails closed;
  a current-version save never overwrites it.
- `listDrafts` returns only the requested vault, newest first, with deterministic
  document-ID tie breaking.
- Delete is fail-closed: it removes only a supported current-version record,
  reports `missing` idempotently, and preserves an occupied future-version or
  corrupt record as `unsupported`.
- Vault clear removes only supported current-version records. It does not treat
  skipped future-version or corrupt records as ordinary lifecycle data.
- `moveDraft` is atomic: either the old key remains unchanged or the new key is
  committed and the old key is removed.
- If the target identity already has a different draft, the move reports `conflict`
  and preserves both records regardless of their timestamps. Exact duplicate
  records may be coalesced.
- A successful move keeps the source draft's content and baseline, changes its
  identity/path, and preserves its original `createdAt`.
- A missing source reports the idempotent `missing` outcome. Unsupported/corrupt
  occupied source or target keys report `unsupported`; storage faults report
  `failed`.
- Unsupported or corrupt records are skipped on reads and are never rewritten
  automatically.
- `createdAt` and `updatedAt` are non-negative safe integers, matching the
  IndexedDB range used by vault listing. A non-null `baseModifiedAt` is a
  non-negative finite number so fractional filesystem `mtimeMs` values are
  preserved without truncation.
- Cached IndexedDB connections close on `versionchange` and clear themselves on
  `close`, so another application instance can upgrade the schema. A connection
  that succeeds after an already-rejected blocked open is closed immediately.

## 6. Draft Creation and Removal

The later editor integration creates or updates a draft only when:

- a loaded Document tab has a resolved vault and document identity;
- its editor buffer differs from its authoritative clean baseline; and
- the current close/save/rename generation still owns that tab.

Writes are independently debounced per document (target range 500–1000 ms). The
latest buffer is synchronously snapshotted before scheduling asynchronous storage
work. Each document has a generation so an older write cannot replace newer content
or recreate a draft after it was saved or discarded.

A draft is deleted only after:

- a save is authoritatively confirmed and the tab is clean;
- the buffer independently returns to the authoritative baseline; or
- the user explicitly confirms that the dirty content should be discarded.

A failed, offline, conflicted, or cancelled save retains the draft. Merely closing a
clean view, changing the active tab, or losing the source file externally does not
delete it. Teardown and `pagehide` flush the latest dirty snapshots where the
platform permits, but recovery correctness cannot depend solely on unload events.

## 7. Discovery and Recovery Decisions

After the vault ID is resolved, startup lists that vault's drafts. Opening a
document also checks its stable document identity. Draft discovery does not mutate
tabs or disk content.

### Disk equals the recorded baseline

The user is offered:

```text
Unsaved editing content was found.
[Recover draft] [Use disk version]
```

Recovering places the draft into the editor as dirty content. It does not save it.
Choosing the disk version is an explicit discard and removes the draft only after
the choice is committed.

### Disk differs from the recorded baseline

The user is told that both versions changed and is offered:

```text
[View differences] [Open draft as recovery] [Use disk version]
```

The default safe path is an independent Recovery/Diff view. The draft must not
replace the open document or be written to disk automatically.

### Source file no longer exists

The draft remains stored and can be opened as an orphan recovery document labelled
`Recovered: <original name>`. It has no writable disk target until the user chooses
a new path.

If hashing or disk metadata cannot be obtained, recovery follows the divergent/unknown
path rather than assuming the disk is unchanged.

## 8. Rename, Move, and Delete Transactions

Draft migration joins the existing file transaction; it is not a watcher that
reacts after paths change.

- A successful rename/move atomically migrates the source draft identity and path.
- If the target already has a draft, the conflict rules in section 5 apply before
  either source is removed.
- Failure to commit the draft migration must leave the old draft recoverable. File
  transaction integration will define whether the file operation rolls back or
  reports a recoverable draft warning; it may not silently delete the old draft.
- A failed or cancelled file operation leaves all draft keys and contents unchanged.
- Pending writes using an old ID are invalidated before migration commits.
- An explicit permanent delete may delete its draft only after the user confirms
  discard.
- An external delete never deletes the draft. It becomes orphaned recovery data.

## 9. Concurrency and Lifecycle

- Every scheduled editor write carries tab identity, document identity, revision,
  content snapshot, and generation.
- Completion validates ownership again before it can affect storage state.
- Save success, discard, close, rename, move, and restore increment the relevant
  generation and await/neutralize older work.
- Storage-level timestamp rejection is the final guard against late writes from a
  previous component owner.
- Multiple app instances may observe the same IndexedDB. Last-newer timestamp wins;
  equal conflicting writes fail closed rather than relying on tab ordering.

## 10. Privacy and Capacity

Draft content is local browser data and may contain sensitive notes.

- It is never included in analytics, logs, URLs, toast text, or server requests.
- UI must state that drafts are stored on this device/browser.
- A later recovery center supports individual and bulk deletion.
- Initial limits for the integration phase are:
  - maximum 2 MiB UTF-8 content per draft;
  - maximum 100 drafts per vault;
  - maximum 20 MiB estimated content per vault;
  - orphan retention target of 30 days.
- Cleanup orders candidates by `updatedAt`, oldest first.
- Cleanup never removes the currently dirty buffer's draft or a draft participating
  in save/rename/recovery work.
- Oversized active buffers remain editable and savable; draft persistence reports a
  non-blocking failure instead of truncating content silently.

The pure Edit-09.2 store preserves records and supplies deterministic ordering. The
limits and protected-record cleanup policy are implemented with editor integration,
where active ownership is known.

## 11. Staged Delivery

### Edit-09.1 — Design and behavior freeze

- This specification only.

### Edit-09.2 — Pure storage model

- `draftTypes.ts`
- `draftKey.ts`
- `draftStore.ts`
- deterministic backend contract and IndexedDB implementation
- characterization and implementation tests

No editor, save, `VaultView`, or file-transaction integration.

### Edit-09.3 — Dirty-buffer persistence

- per-document debounce and generation ownership;
- clean/save/discard deletion;
- teardown flush and non-blocking storage failures.

Implemented in:

- `draftHash.ts`: best-effort SHA-256 hashing of the synchronously captured
  authoritative baseline;
- `useUnsavedDraftPersistence.ts`: per-vault-context, per-document debounce,
  generation ownership, monotonic record timestamps, a shared write/delete
  operation chain, flush, clean/discard deletion, `pagehide` best-effort
  flushing, and idempotent disposal;
- `draftTypes.ts`: record timestamps remain safe integers while
  `baseModifiedAt` preserves finite fractional filesystem `mtimeMs` values;
- `useDocumentSave.ts`: the existing editor-change and
  `revision`/`savedRevision` acknowledgement paths schedule or remove drafts;
- `useTabWorkspace.ts` and `Tab`: loaded Document tabs retain the stable
  `PostDetail.metadata.id`; paths are metadata and are never substituted for
  missing document identity;
- `useEditorTabs.ts`: owns one coordinator instance and connects confirmed
  close/discard and context teardown.

Behavior remains write/delete only. This stage does not list or recover drafts,
add recovery UI, or migrate draft identities for rename/move/delete. Focused
coverage consists of 43 tests across the draft storage, hashing, persistence
coordinator, and save-state wiring suites.

### Edit-09.4 — Recovery decisions

- startup discovery;
- baseline comparison;
- safe recovery and divergent/orphan flows.

Implemented in:

- `draftRecoveryDecision.ts`: pure stable-identity, SHA-256, and fractional
  `mtimeMs` decision matrix with fail-closed `unknown`, `missing-source`, and
  `identity-mismatch` outcomes;
- `useUnsavedDraftRecovery.ts`: vault-scoped discovery with four-request bounded
  concurrency, discover/item generations, retry, session-only dismissal, and
  disposal guards;
- `useUnsavedDraftPersistence.ts`: identity-based explicit discard remains on
  the same per-document write/delete operation chain as editor-owned drafts.
  Recovery adoption compares the complete current stored record, establishes a
  runtime owner, and does not rewrite identical content with a newer timestamp.
  It observes generation, timer, snapshot, and pending-operation ownership
  across every storage read, so concurrent local edits fail adoption without
  losing their debounce work. Failed application rolls back only the exact
  adoption owner, never a newer editor generation. Each coordinator entry also
  retains the exact draft it successfully persisted or adopted; clean,
  return-to-baseline, and discard cleanup use atomic compare-and-delete and
  cannot remove a newer draft written by another browser context. Cleanup
  waits for an already-running draft write before reading that write's exact
  persisted record and advancing the generation; a new schedule during that
  wait invalidates the cleanup without touching the newer timer or snapshot;
- `useDocumentSave.ts`: `applyRecoveredDraft()` revalidates stable identity,
  clean state, external state, disk raw, and disk mtime before creating a dirty
  editor revision. It adopts the already-persisted browser draft without a
  write, and intentionally bypasses `onEditorChange()` and server autosave;
- `useDraftRecoveryTabs.ts`, `DraftRecoveryPrompt.vue`, and
  `DraftRecoveryPane.vue`: session-only read-only Recovery workspace tabs,
  decision-specific actions, local content view, and disk-versus-draft diff;
- `WorkspaceTab`, `workspaceClose.ts`, and `VaultView.vue`: Recovery is an
  explicit fourth workspace kind participating in visual order, keyboard
  navigation, fallback, focus, single close, and batch close without entering
  Document dirty-confirmation or session persistence.

This stage never restores automatically, never writes recovered content to disk,
and deletes a stored draft only after an explicit Use Disk/Discard action.
Document opening and View Current navigation both reclassify again after their
asynchronous boundary; View Current additionally verifies the actual loaded
Document tab's stable identity and load state before focusing it. A changed
stored draft, disk identity, or cached tab identity fails closed. Failed draft
application refreshes classification once more before showing Recovery content,
so the pane never falls back to the pre-adoption snapshot. If that refresh
cannot produce a current ready item, the recovery remains unresolved and
retryable instead of displaying or dismissing stale bytes.
Closing a Recovery tab or choosing Later keeps IndexedDB unchanged. Rename,
move, delete migration, recovery-center management, retention, and capacity
cleanup remain deferred to Edit-09.5/09.6.

### Edit-09.5 — File transactions

- rename/move/delete migration and rollback behavior.

Implemented in:

- `useDraftFileTransactions.ts`: explicit stable document identities, actual
  path mappings, preserve/discard delete policy, exhaustive non-throwing draft
  transaction results, and the idempotent barrier contract;
- `useUnsavedDraftPersistence.ts`: per-document file-transaction pause state.
  Preparing a mutation cancels an unstarted old-path debounce and waits for an
  already-running write. Input during the server request is synchronously
  retained as the latest snapshot without writing the old path. Commit moves
  the exact IndexedDB record without changing its content, baseline, or
  timestamps and then persists newer input only at the server-returned path;
  rollback resumes the latest input at the old path. Explicit delete uses the
  exact draft, pending buffer snapshot, editor revision, and generation
  synchronously captured when the user confirms deletion, before any save or
  lifecycle await. Confirmation can therefore discard a debounce or in-flight
  write that it actually covered, while a newer local revision/generation or
  cross-context record is preserved as orphan recovery content. Successful
  deletion also relinquishes the matching in-memory snapshot and persisted
  ownership. Move commit and entry release are separate phases: Document tab
  paths migrate before the barrier unlocks, and transaction-time snapshots are
  then flushed immediately at the actual server path before Recovery retry;
- `draftStore.ts`: schema version 2 adds an immutable `draftConflicts` store.
  If confirmed deletion finds both a newer cross-context primary draft and a
  post-CAS local edit, the primary record remains untouched while the local
  snapshot is persisted under a distinct conflict identity. Pagehide and
  disposal never flush that detached candidate back over the primary record;
- `useUnsavedDraftRecovery.ts` and `useDraftRecoveryTabs.ts`: primary and local
  conflict candidates for the same stable document identity are discovered,
  classified, and displayed as separate Recovery items/tabs. Conflict
  candidates are read-only and may be discarded independently; they cannot be
  restored directly over a Document tab;
- `useDocumentLifecycle.ts`: rename, drag move, archive, folder rename, file
  delete, and folder delete share the document-save and draft barriers. Stable
  identity is resolved before and after path changes, folder identity loading
  is bounded to four workers, and only server-confirmed results are committed.
  Draft conflict/unsupported/failure is reported as a non-blocking warning and
  never converts an already-successful server file operation into failure.
  Barrier finalization runs in `finally` around tab migration so an unexpected
  UI migration error cannot leave draft persistence paused;
- `FileTree.vue`: destructive user confirmation explicitly authorizes
  `discard-confirmed` and captures its delete token in the same synchronous
  call chain after confirmation; all programmatic lifecycle deletion defaults
  to `preserve`;
- `VaultView.vue`: loaded Document metadata is the preferred identity source,
  with `getPost()` as the safe fallback. Recovery items and open Recovery tabs
  are refreshed after moves/preserved deletes and removed only after an exact
  confirmed draft deletion. Refresh is an upsert, so a newly orphaned draft is
  visible in the current session without requiring a page reload.

Create and external-delete paths do not migrate or discard drafts. A newly
created document at an orphan path therefore remains isolated by stable
`documentId`. This stage does not add recovery management, retention, or
capacity cleanup.

If source identity resolution fails, path matching is used only to detect
possibly affected stored or in-memory drafts. Those identities are paused and
their latest transaction-time snapshot is flushed at the old path as orphan
recovery; they are never migrated by path inference. The completed file
operation reports one non-blocking warning without exposing draft content.

Browser coverage uses an isolated temporary vault and exercises real
`useDocumentLifecycle` rename/delete calls, the server-returned archive suffix,
Document tab path migration, and IndexedDB conditional-delete behavior. A
FileTree component test freezes confirmation-token capture before the lifecycle
call.

### Edit-09.6 — Recovery center and cleanup

- management UI, retention, protected-record cleanup, capacity reporting.

## 12. Edit-09.2 Acceptance Tests

- Stable, vault-scoped keys do not collide across documents or vaults.
- A valid draft round-trips without sharing mutable references.
- Updating a draft preserves the original `createdAt`.
- Older and conflicting equal-timestamp writes cannot overwrite newer state.
- Corrupt and future-version records occupying a key cannot be overwritten.
- Listing is vault-scoped, newest first, and deterministic.
- Delete and clear are idempotent and isolated by vault.
- Move changes identity/path and removes the old key atomically.
- Move preserves source content, baseline, and `createdAt`.
- Any different duplicate-target draft conflicts without changing either record.
- Move distinguishes moved, missing, conflict, unsupported, and backend failure.
- Invalid inputs are rejected.
- Corrupt and future-version records do not break valid reads.
- IndexedDB unavailable/open/request/transaction failures resolve as safe failures;
  they do not create unhandled promises.

## 13. Quality Gates

Each stage is an independent commit and must pass its focused tests. The completed
Edit-09.2 batch additionally runs:

```bash
npm test
npm run test:e2e:draft-store
npm run typecheck
npm run build
npm run lint:icons
```
