# D8.4 Migration, Legacy Cleanup & Release Closure PRD

Status: `REVIEW-READY`; D8.4 Planning Independent Review: `PENDING`;
implementation: `NOT STARTED`. This is an authoritative planning document,
not an implementation or approval record. It is intentionally docs-only.

## 1. Status

The D8.3 closure is authoritative at
`c88e99554c291181c6e3f17e695aa228f34d40b2`. D8.3 is `REVIEW-CLOSED` and
D8.4 has not started. D8.4 becomes `APPROVED` only after a separate
Independent Planning Review. This document never self-declares approval.

The D8.4 planning state is:

```text
D8.4 Planning = REVIEW-READY
D8.4 Planning Independent Review = PENDING
D8.4 implementation = NOT STARTED
D8.4 = NOT REVIEW-CLOSED
```

## 2. Background

D8.1 established the secondary-password Diary session and the single
server-side `DiaryAccessService`. D8.2 established the V1 AES-256-GCM body
envelope and its path/document/vault AAD binding. D8.3 enforced that boundary
across History/Git, Draft/Recovery, search, LinkIndex, tree/list, rename/move,
delete, export, diagnostics and teardown.

D8.3 deliberately did not mutate legacy data. A vault can therefore contain a
mixture of:

- a pre-D8 plaintext `diary/YYYY-MM-DD.md` primary;
- a valid D8.2 envelope;
- malformed or unknown encrypted bytes;
- missing, stale or mismatched `DocumentMetadata`;
- legacy browser Draft/Recovery records;
- SQLite metadata/frontmatter/history/tag-undo material; and
- plaintext in the vault's local Git history or external copies.

D8.4 is the final currently planned Diary Encryption phase. Its job is to
converge Docus-controlled current state toward the reviewed boundary, disclose
what Docus cannot control, and provide a release gate. It does not redesign
D8.1-D8.3, create a second key/session owner, or promise forensic erasure.

## 3. Goals

1. Provide an explicit, resumable, per-document migration from legacy
   plaintext primaries to the existing D8.2 envelope.
2. Ensure migration never creates a second durable plaintext body copy.
3. Preserve the one pre-existing legacy plaintext generation until a verified
   encrypted publication exists, then move only forward toward cleanup.
4. Make identity, generation ownership, path reuse, crash recovery and
   idempotency deterministic.
5. Dispose of legacy managed-Diary Draft/Recovery and private SQLite state by
   explicit, user-visible, user-preserving rules.
6. Inventory Git/history and disclose retained legacy exposure without a
   silent rewrite or remote force-push.
7. Keep ordinary Note behavior and all D8.3 fail-closed invariants unchanged.
8. Define test, CI, evidence and closure criteria for the future implementation.

## 4. Non-goals

- No production code, test, dependency, schema, IndexedDB data, SQLite data,
  vault file, Git ref or Git object is changed by this planning commit.
- No password change rekey, DEK rotation, cipher-suite migration or envelope
  V2 is included. Valid V1 ciphertext is not re-encrypted.
- No encrypted persistent Draft Store V2 is introduced. New managed-Diary
  persistent Draft/Recovery remains disabled as required by D8.3.
- No automatic startup/open/read/save/search migration is performed.
- No automatic history rewrite, reflog expiry, object pruning or force-push is
  performed.
- No attempt is made to purge remote clones, third-party backups, downloaded
  exports, OS clipboard history or user-created copies.
- No generic Note metadata, body, Draft Store row or Git history is touched by
  proximity to a Diary path.

## 5. Frozen D8.1-D8.3 invariants

The following are carried forward without redesign:

| Invariant | D8.4 contract |
| --- | --- |
| Identity | `diary/YYYY-MM-DD.md` is the canonical physical name and `diary/YYYY-MM-DD` is the canonical logical path. One valid local civil date is one managed document. |
| Path authority | `shared/diaryProtocol.ts` (`parseDiaryDate`, `diaryDateFromPath`, `isManagedDiaryPath`, `classifyDiaryPath`) is the sole classifier. Inputs are canonicalized before any read or mutation. |
| Crypto owner | `server/diaryAccess/service.ts` is the sole live/unwrapped DEK owner. The client never owns a DEK; it holds only existing session/capability state and transient input. |
| Body adapter | `server/diaryAccess/body.ts` owns the V1 envelope, AES-256-GCM, 12-byte nonce, 16-byte tag, size bounds and AAD (`vaultId`, `documentId`, canonical logical path, envelope version). Invalid authentication, AAD or version fails closed. |
| Access lifecycle | `withDiaryBodyOperation` leases are subordinate to the existing epoch/quiescence state. Lock, logout, expiry and capability replacement fence late work before it publishes. |
| Metadata | SQLite `documents` remains the live stable identity/Mood owner. D8.4 does not move Mood into the body or into a new ledger. |
| Current projection | Locked Calendar/tree/list expose only canonical path/date, existence, stable documentId and Mood. Title, summary, tags, frontmatter, body length, links and snippets are private. |
| Durable writes | Only ciphertext may cross a durable Diary writer after migration. Generic Note atomic writers keep their existing semantics. |
| Git | `server/history/git.ts:addAndCommit` rejects managed paths before any Git/temp mutation; D8.3 managed History remains unavailable. |
| Draft/Recovery | New managed-Diary persistent Draft/Recovery is disabled. Existing legacy rows are retained for this explicit D8.4 disposition workflow. |
| Search/links | Managed Diary contributes structural path/date only. Body search and body-derived LinkIndex state remain disabled/suppressed. Note-to-Note links remain unchanged; the intentional D8.3 exception is suppression of `Note -> managed Diary` edges. |
| Rename/move/delete | Generic managed-Diary rename/move/reference/delete remains fail-closed until a separately reviewed AAD-aware transaction exists. D8.4 migration does not broaden those operations. |
| Export | PDF/clipboard are explicit external copies, permitted only for the current unlocked epoch and outside automatic wipe guarantees. |

## 6. Legacy-store inventory

The following inventory is the source-backed starting point for implementation.
"Private" means body-derived or capable of retaining private user text; it
does not mean that every row is populated in every vault.

| Store/artifact | Current owner and location | Private content | Locked behavior / discovery | Stable identity | D8.4 disposition | Unlock / confirmation | Recovery owner | Residual risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Legacy primary `diary/YYYY-MM-DD.md` | `server/routes/diary.ts`, `server/routes/posts.ts`, filesystem under `CONTENT_DIR` | Whole plaintext body | Structural `lstat`/size/mtime scan is allowed locked; body read requires a current Diary lease | Path/date plus `documents.id`; missing ID is unresolved | Classify, then migrate with the custom no-copy protocol; remove the moved pre-existing source only after encrypted verification and explicit confirmation | Unlock required for body; start confirmation includes legacy-primary removal | New `DiaryMigrationService` plus startup recovery hook | Existing copies outside Docus remain |
| Valid V1 primary | `server/diaryAccess/body.ts` through Diary routes | Ciphertext at rest; plaintext only in lease/UI memory | Verify envelope only when unlocked; structural scan can identify magic/version without exposing body | AAD proves vault/id/path | Strict byte-for-byte no-op; no rekey | No migration confirmation for no-op | `DiaryMigrationService` verifies and records no-op | Valid encrypted body in authorized memory remains in scope of D8 threat model |
| Malformed/unknown/AAD-invalid primary | Same as above | Bytes may be private or corrupted | Never parsed as Markdown or fallback plaintext | Identity cannot be trusted until verification | `NEEDS_ATTENTION`; preserve bytes; no overwrite | Unlock only for authenticated repair attempt; no automatic repair | Migration journal/ledger records code only | User must repair/export through a separately authorized path |
| Atomic temps/staging/journals | `server/atomicTextWrite.ts`, `server/crashRecovery.ts` (`.docus-save-*`, `.docus-staged-*`, `.docus-remove-*`, journals) | Ordinary protocols can contain plaintext while serving Notes | Existing recovery runs before HTTP; D8.4 migration must not route plaintext through them | Ownership hashes are generic; not sufficient for migration | Migration uses reserved ciphertext-only temp and structural migration journal; existing Note artifacts remain under current recovery | No body exposed locked | Existing `recoverInterruptedOperations` plus `DiaryMigrationService.recover` | Pre-D8 orphan artifacts may require attention |
| Legacy IDB `drafts` | `src/composables/vault/draft-recovery/draftStore.ts`, DB `docus-draft-recovery`, version 2 | `UnsavedDraft.content`, baseline/body timestamps | Locked inventory uses raw structural fields only; `readDisk` refuses managed paths | `(vaultId, documentId)` key; path in record | Retain until explicit `import-to-primary` or typed `discard-draft`; no automatic deletion | Unlock for import; typed confirmation for discard | Existing DraftStore conditional operations, orchestrated by migration service/UI | Browser profiles/backups outside Docus remain |
| Legacy IDB `draftConflicts` | Same DraftStore, key `(vaultId, documentId, conflictId)` | `DraftConflictRecord.content` and conflict context | Same locked restriction | Vault/document/conflict key | Same two explicit actions; ambiguous family is `NEEDS_ATTENTION` | Unlock/import or typed discard | DraftStore transaction across both stores | Browser storage may be copied by user |
| `documents` | `server/documentMetadata.ts`, SQLite `data/docus.db` | `title`, `summary`; timestamps and `mood` are allowed structural/UX fields only by policy | Read through structural projection; no new body parse | `id` and canonical `path` | Preserve id/path/created/updated/mood; set title to canonical date; clear summary after primary publication and confirmation | Cleanup confirmation | SQLite transaction under vault mutation + document lock | SQLite file backups may predate cleanup |
| `document_tags` / `tags` | `server/tagManagement.ts`, SQLite | Tag names/associations can derive from private frontmatter | Managed associations excluded from D8.3 public projection | `document_id` and FK | Delete managed associations; delete a tag row only when no Note association remains | Cleanup confirmation | Same SQLite transaction; mixed records are never split by guess | Shared tag row retained for Notes may reveal a tag name |
| `document_embeddings` | `server/documentMetadata.ts`, SQLite | Embeddings/content hashes are body-derived | Not exposed to locked managed projection | `document_id` | Delete managed rows after encrypted publication | Cleanup confirmation | SQLite transaction | Copies in DB backups are out of control |
| `metadata_migrations` | `server/metadataMigration.ts`, `server/frontmatterArchive.ts` | `frontmatter_backup`, `source_hash`, `cleaned_hash`, error text | Generic startup skips managed paths; D8.4 reads only structurally and under its owner | `path`, optional `document_id` | Managed rows retain identity/path; clear backup and both body-derived hashes, set `status='cleaned'`, clear error; Notes untouched | Cleanup confirmation | SQLite transaction plus ledger `CLEANUP_PENDING` | Historic DB backups may retain old fields |
| History metadata tables | `server/history/metadataRevisions.ts`, migrations 0009 | `history_metadata_restore_journal.before_raw/target_raw`, payload JSON, body SHA, expected hashes | D8.3 rejects new managed History; legacy rows can exist | `vault_id`, document/path, operation IDs | Delete rows proven to reference managed IDs/paths; retain identity-only tombstones; mixed operation is `NEEDS_ATTENTION` rather than split | Cleanup confirmation | SQLite transaction and forward retry | Git itself is handled separately |
| Tag Undo foundation | `tag_undo_records`, `tag_undo_association_deltas`, `tag_undo_state` | `operation_json`, tag names, managed association deltas | Not a Diary body reader in D8.3; inventory is bounded structural JSON inspection | `record_id`, delta document_id | Delete records/deltas proven managed-only; mixed/invalid JSON stays `NEEDS_ATTENTION`; Note-only records untouched | Cleanup confirmation for managed-only records | SQLite transaction | A mixed audit row can retain private names |
| Local Git working tree/refs/objects | `server/history/git.ts`, `server/history/routes.ts`, vault `.git` | Legacy plaintext commits, blobs, reflogs and unreachable objects | Read-only inventory; D8.3 blocks new managed commits | Commit/ref/path | Disclose and retain; no history rewrite in D8.4 | User must acknowledge retention before completion | `DiaryMigrationService` read-only Git inventory | Remote refs, clones and backups are not controlled |
| LinkIndex/search caches | `server/linkIndex.ts`, `src/lib/search.ts`, `src/lib/searchResults.ts` | Volatile body-derived links/snippets/cache entries | D8.3 filters; lock epoch clears managed residue | Path only | Verify empty managed body-derived state; no migration copy | No unlock needed for structural verification | Existing epoch/invalidation seams | Process/browser memory can exist while unlocked |
| Logs and test artifacts | `server/prod.ts`, `server/vite-plugin.ts`, sanitizer/e2e fixtures | Potential accidental body/error serialization | Must be redacted and canary-scanned | Structural path/code only | Add D8.4 canary checks; no raw body | No | Existing logger/test artifact owners | OS/provider logs outside Docus scope |

The inventory intentionally distinguishes Docus-controlled current stores from
external copies. A count is safe only when it is structural; no inventory API
returns a body excerpt.

## 7. User migration experience

### 7.1 Trigger and consent

The only trigger is an explicit **Diary Migration & Legacy Cleanup** workflow
opened from Settings or a user-visible post-upgrade banner. Opening, reading,
saving, searching, creating a new Diary date, or starting the server never
silently migrates a legacy file.

1. The user selects **Scan legacy Diary state**. Scan may run locked and shows
   only counts, canonical dates/paths, stable IDs when already known, and safe
   classifications.
2. The user reviews the counts and starts the run with all three confirmations:
   `confirmMigration=true`, `confirmLegacyPrimaryRemoval=true`, and
   `acknowledgeGitRetention=true`. The second confirmation means the one
   pre-existing plaintext primary is removed only after verified encrypted
   publication; it is not a permission to delete an unproven generation.
3. The workflow requests Diary unlock immediately before any body migration.
   Locked users can leave the workflow, rescan, or review the safe Git/IDB/
   SQLite counts; they never see body text.
4. Progress is per item and per auxiliary store. No title, summary, tag,
   frontmatter, body length, body hash, snippet or raw error is displayed.
5. Rows needing identity adoption, draft disposition or external repair show
   `NEEDS_ATTENTION`. They remain retained until an explicit action; the run
   cannot silently mark them complete.

### 7.2 Explicit item actions

The only body-bearing legacy Draft/Recovery actions are:

- `import-to-primary`: after unlock, check current encrypted primary identity
  and CAS baseline, then save through the normal D8.2 encrypted owner. Delete
  the exact IDB family only after verified save.
- `discard-draft`: requires the exact typed confirmation
  `DISCARD LEGACY DIARY RECOVERY`. It conditionally deletes the exact primary
  and conflict rows in one IndexedDB transaction. A missing or changed row is
  not deleted.

For `METADATA_MISSING`, the only action is `adopt-metadata`, which creates the
minimal structural identity described in §11 after canonical date validation.
For malformed, unknown, external or missing-primary items, the action is
`acknowledge-attention` or `retry-item` after the user has repaired the
external condition; acknowledgement does not make the item `COMPLETE`.

There is no automatic external export flow in D8.4. A user may use the normal
explicit PDF/clipboard export surface while unlocked, but that copy is outside
the migration guarantee and is not used as a cleanup proof.

### 7.3 Completion screen

Completion reports counts for `COMPLETE`, `ALREADY_ENCRYPTED_VALID`,
`NEEDS_ATTENTION`, retained Git exposure classes, and retained external-copy
risks. It states exactly which current Docus-controlled stores were cleaned
and that Git history, remote copies and user exports were not purged.

## 8. Managed-file classification

Classification runs before generic Markdown/frontmatter/link parsing. It uses
the canonical extensionless logical path and a symlink-safe structural read.
The exact item classifications are:

```text
ALREADY_ENCRYPTED_VALID
LEGACY_PLAINTEXT
ENCRYPTED_MALFORMED
ENCRYPTED_UNKNOWN_VERSION
ENCRYPTED_IDENTITY_MISMATCH
METADATA_MISSING
METADATA_AMBIGUOUS
PRIMARY_MISSING
EXTERNAL_PATH_CONFLICT
MIGRATION_IN_PROGRESS
CLEANUP_PENDING
NEEDS_ATTENTION
```

Rules:

1. A file with the V1 magic is never treated as plaintext. The service verifies
   version, size, tag and AAD using the current identity. Valid V1 is a strict
   no-op; any failure maps to the corresponding encrypted/attention class.
2. A regular file with no envelope magic is `LEGACY_PLAINTEXT`, but only after
   the path is exactly a valid Diary date and the file is not a symlink.
3. Missing `DocumentMetadata` is `METADATA_MISSING`, not permission to guess an
   ID. A row at the same path with a different ID, two rows claiming the same
   physical generation, or a row whose ID is used at another path is
   `METADATA_AMBIGUOUS`.
4. A metadata row without its primary is `PRIMARY_MISSING`; D8.4 does not
   synthesize a body. An occupied path whose generation is not the classified
   generation is `EXTERNAL_PATH_CONFLICT`.
5. An active journal/ledger item for the same stable tuple is
   `MIGRATION_IN_PROGRESS`; a previously published item whose cleanup did not
   finish is `CLEANUP_PENDING`.

Classification is bounded by file size and does not store a persistent body
hash. Plaintext equivalence hashes, when needed, are transient memory values.

## 9. Primary plaintext migration contract

### 9.1 One-document protocol

`DiaryMigrationService` uses a narrowly scoped protocol because the generic
`prepareAtomicTextWrite` path stages the old generation under a durable
`.docus-staged-*` name. Reusing it for a plaintext Diary would create a new
plaintext artifact. The migration protocol is:

1. Canonicalize and validate the managed path, reject symlinks and verify the
   vault directory identity with `resolveSafeRelativePathDetailed`/
   `verifySafePathResolution`.
2. Resolve a single stable `documentId`. For a missing row, stop at
   `METADATA_MISSING` until the user performs `adopt-metadata`; do not encrypt
   first.
3. Acquire the existing `withVaultMutation` ownership, vault structure lock,
   sorted `withDocumentWriteLock`, and a `withDiaryBodyOperation` lease. The
   order is vault mutation -> structure lock -> document lock -> body lease;
   no second global lock is introduced.
4. Capture the source generation (`dev`, `ino`, byte size, `mtimeNs` where
   available, regular-file type) and open it with the existing no-follow safe
   path primitive. Read plaintext only into the authorized operation's memory.
5. Encrypt with the existing lease-local `operation.encrypt` and the exact
   `BodyContext` (`vaultId`, `documentId`, canonical path). The service never
   receives or persists a raw DEK.
6. Authenticate the ciphertext immediately with `operation.decrypt`, verify
   exact plaintext equivalence in memory, and verify documentId, vaultId,
   canonical path and V1 envelope version.
7. Write only ciphertext to a same-directory, migration-reserved temporary
   file. Fsync the file and parent directory. The journal contains only
   structural names, generations, phase and codes.
8. Revalidate the original source generation and safe directory resolution.
   Any mismatch aborts before publication and leaves the external generation
   authoritative.
9. Re-open/re-`lstat` the source immediately before the rename and compare the
   captured device/inode/size/mtime and directory identity. Rename the one
   pre-existing plaintext source inode to a reserved
   `.docus-diary-migration-source-*` name. This is a move, never a copy; it is
   the only plaintext generation the protocol may temporarily preserve.
10. Publish ciphertext into the now-empty canonical target with a create-only
    link/rename on the same filesystem, fsync the target and parent, and
    authenticate-read the published bytes. A target occupied by another
    generation is never overwritten.
11. Durably write the migration journal/ledger phase `PUBLISHED`, then run the
    user-confirmed SQLite, Draft/Recovery and source-inode cleanup gates.
12. Delete the moved pre-existing plaintext inode only after the target is
    verified and the ledger records `PUBLISHED`. If cleanup fails, retain it as
    a pre-existing generation and mark `CLEANUP_PENDING`; never restore it as
    the primary.
13. Mark the item and aggregate run `COMPLETE` only after all required cleanup
    gates and final no-new-plaintext checks succeed.

The migration service must not call generic plaintext `atomicReplaceTextIfUnchanged`,
`atomicRemoveTextIfUnchanged`, recovery payload writers, rename-reference
journals or generic delete staging for this protocol.

### 9.2 Commit point and monotonicity

The irreversible security commit point is the successful fsynced publication
of a V1 ciphertext target after source-generation revalidation and authenticated
readback. Before that point, failure leaves the original plaintext at its
original target or restores the same moved inode create-only. After that point:

```text
encrypted target remains authoritative
plaintext is never restored to the canonical path
cleanup resumes forward
state = CLEANUP_PENDING when a required cleanup is incomplete
```

The migration journal makes a crash between publication and ledger update
recoverable by inspecting only structural ownership plus the V1 envelope. It
never stores a plaintext rollback payload.

### 9.3 External-writer contract

At every phase, an external generation wins unless exact ownership is proven:

| Race | Required result |
| --- | --- |
| Edit before classification/read | Reclassify the new generation; do not use stale bytes. |
| Edit after read/encryption | Source generation mismatch; discard ciphertext temp, restore the moved original only if exact ownership is proven, and mark `EXTERNAL_PATH_CONFLICT`/`NEEDS_ATTENTION`. |
| Replace/delete before source move | Create-only/generation check fails; never overwrite or delete external bytes. |
| Target occupied during publish | Preserve the occupant, quarantine ciphertext and any moved source, mark `EXTERNAL_PATH_CONFLICT`. |
| Crash after source move before target publish | Startup restores the same source inode create-only only when the target is empty and directory identity matches. |
| External replace after encrypted publish | Preserve external target. Retain verified encrypted generation/quarantine and mark `NEEDS_ATTENTION`; never delete the external file. |
| Path reused by another document ID | `METADATA_AMBIGUOUS`/`EXTERNAL_PATH_CONFLICT`; no destructive cleanup. |

Normal Diary save/create is rejected with `diary-migration-in-progress` while
the document lock is held, rather than racing last-writer-wins. New Diary
creation at a different date may continue and is immediately classified as
`ALREADY_ENCRYPTED_VALID` by the normal D8.2 create path.

## 10. Legacy Draft/Recovery contract

The actual legacy store is IndexedDB database `docus-draft-recovery`, version
2, with object stores `drafts` (key `[vaultId, documentId]`, index
`vaultUpdatedAt`) and `draftConflicts` (key `[vaultId, documentId, conflictId]`,
index `vaultId`). `UnsavedDraft` and `DraftConflictRecord` both contain a
`content` field. `useUnsavedDraftPersistence` already blocks new managed-path
writes and deliberately leaves old managed rows for D8.4; `useUnsavedDraftRecovery`
filters managed rows from ordinary recovery and `clearSensitiveState` fences
their in-memory classifiers; `useDraftRecoveryManagement` excludes them from
automatic cleanup.

D8.4 does not add a new encrypted store. The migration service asks the client
owner for a structural inventory while locked, and a body-bearing decision
only after unlock. A valid row must match one stable `(vaultId, documentId,
canonicalPath)` and a current server identity before it can be imported. The
import path writes through the ordinary D8.2 encrypted save/CAS owner; it never
serializes the row into SQLite or a migration ledger. On verified success, a
single IndexedDB read/write transaction conditionally removes the exact primary
and all selected conflict rows. A crash before that transaction leaves the row
for a safe idempotent rerun.

Ambiguous identity, split family paths, malformed/future-version rows, missing
primary, changed baseline or an unavailable IndexedDB transaction is
`NEEDS_ATTENTION`; it is never guessed or silently deleted. Typed discard uses
conditional deletion and preserves any row changed by another context.

While locked, UI may show only count, canonical path/date, documentId when
already present, record kind and status. Body, original content, conflict
content, recovery tabs, search, AI, clipboard and PDF are prohibited. Lock,
logout, expiry and capability replacement synchronously fence managed recovery
classification and clear managed in-memory buffers; Note recovery remains
unchanged.

## 11. SQLite/private metadata contract

SQLite cleanup occurs only after encrypted primary publication, under
`withVaultMutation`, the relevant document locks, and one `BEGIN IMMEDIATE`
transaction. The stable document ID is preserved. The exact field policy is:

| Field/table | D8.4 action for managed Diary | Note behavior |
| --- | --- | --- |
| `documents.id`, `path`, `created_at`, `updated_at`, `mood` | Preserve; normalize path to the canonical date. Mood remains the structural Calendar value. | Unchanged. |
| `documents.title` | Set to canonical `YYYY-MM-DD`; never rederive from body. | Unchanged. |
| `documents.summary` | Clear to `''`; never copy into the encrypted body automatically. | Unchanged. |
| `document_tags` | Delete associations whose `document_id` is managed. | Associations and shared tag rows remain. |
| `tags` | Delete only rows with no remaining Note or other association. | Shared rows retained. |
| `document_embeddings` | Delete managed rows. | Unchanged. |
| `metadata_migrations` | For the matching managed row, retain path/document_id/original_path, set `status='cleaned'`, clear `frontmatter_backup`, `source_hash`, `cleaned_hash` and `error`. | Unchanged. |
| `history_metadata_revisions` and restore journal | Delete rows proven to reference the managed ID/path, including `before_raw`, `target_raw`, payload and body SHA. | Unchanged. |
| `history_metadata_operations` | Delete a managed-only operation after its child rows are removed. A mixed operation that cannot be separated is retained and marked `NEEDS_ATTENTION`. | Unchanged. |
| `history_metadata_document_tombstones` | Retain identity/path-only tombstones. | Unchanged. |
| `tag_undo_association_deltas` | Delete deltas proven to reference managed IDs. | Unchanged. |
| `tag_undo_records` | Delete records whose deltas and bounded `operation_json` prove managed-only; mixed or invalid JSON is `NEEDS_ATTENTION`, never broad-deleted. | Unchanged. |
| `tag_undo_state` | Advance/retain state only through existing tag-undo owner; no body-derived field is added. | Unchanged. |
| migration ledger | Contains structural state only; no body, title/summary/tag value, backup or digest. | No Note row is inserted. |

If SQLite cleanup fails after publication, the primary remains encrypted and
the ledger item is `CLEANUP_PENDING`. If cleanup succeeds but a later primary
step had not published, the ordering is invalid and implementation must stop;
the prescribed implementation never cleans SQLite before publication.

## 12. `frontmatter_backup` contract

`server/metadataMigration.ts` writes `metadata_migrations.frontmatter_backup`
for generic Notes; `server/frontmatterArchive.ts` reads it for preview/clean/
restore and deliberately skips managed Diary. Legacy managed rows are still a
first-class exposure. D8.4 identifies a row only when its canonical path and
optional `document_id` match the migration item, and verifies that no pending
rollback or unresolved migration phase needs the backup. It then clears
`frontmatter_backup`, `source_hash`, `cleaned_hash` and error, sets
`status='cleaned'`, and retains the row's structural identity/original path in
one SQLite transaction.

The cleanup is idempotent: an already empty backup with `cleaned` status is a
no-op. A row with a mismatched ID/path, an active journal, or a shared/mixed
operation is `NEEDS_ATTENTION`; the service never clears it by path-only
equality. Ordinary Note rows and the generic frontmatter archive contract are
not changed.

## 13. Git/history contract

D8.4 chooses the exact policy **disclose and retain; do not rewrite**. The
service performs a read-only inventory of:

1. current `HEAD` tree and index;
2. local branches and tags;
3. remote-tracking refs;
4. stash refs when present;
5. reachable commits/blobs;
6. reflogs; and
7. unreachable loose/packed objects discovered by `git fsck`.

The inventory reports only counts, refs, commit IDs and canonical managed
paths. It does not return blob text. D8.4 can control the current worktree and
the local repository's read-only report. It cannot control remote repositories,
other clones, filesystem backups, CI artifacts or a user's exported bundle.

No `filter-repo`, branch/tag rewrite, reflog expiry, object prune, destructive
backup or automatic `git push --force` is part of migration. Completion requires
the user acknowledgment of this retained legacy exposure. A future, separately
approved history-remediation feature would need its own scope, backup and
remote policy; it is not hidden inside D8.4.

## 14. Mixed-state and `NEEDS_ATTENTION`

Migration is per-document transactional with a vault-level aggregate. The
classifier converges the following states deterministically:

| State | Result |
| --- | --- |
| Fresh vault/no Diary | Run completes with zero items after Git/auxiliary inventory. |
| All valid encrypted | Every item is `ALREADY_ENCRYPTED_VALID`; bytes remain unchanged. |
| All legacy plaintext | Each identity-resolved item follows §9; unresolved items remain attention. |
| Mixed plaintext/encrypted | Plaintext items migrate; valid encrypted items no-op; aggregate waits for attention/cleanup. |
| Encrypted + malformed/unknown | Valid items no-op; invalid items remain `NEEDS_ATTENTION`; no fallback. |
| Plaintext + missing metadata | Path/date is safe to show; item waits for explicit `adopt-metadata`. |
| Valid encrypted + stale metadata | AAD/ID mismatch is attention; metadata is not rewritten by path alone. |
| Primary missing + metadata exists | No body is created; `PRIMARY_MISSING` remains attention. |
| IDB only | Locked structural inventory; unlocked explicit import/discard; unresolved rows remain. |
| SQLite metadata only | Cleanup is independent but still requires identity and user confirmation. |
| Git history only | Disclosure/acknowledgment; no rewrite. |
| Cleanup pending/journal exists | Startup resumes forward from the durable phase; no plaintext rollback after publication. |
| Orphan temp/staging artifact | Existing recovery handles generic artifacts; migration service handles only its reserved structural pattern and quarantines ambiguity. |
| External path reuse | External bytes win; migration artifacts are retained/quarantined and attention is surfaced. |
| Vault copied under a new identity | `getVaultId()` changes; all items are re-inventoried under the new vault tuple, and old ledger rows are not reused as proof. |

`NEEDS_ATTENTION` is explicit unresolved state, not success. The aggregate run
state is `ATTENTION_REQUIRED` while any item or required auxiliary decision is
unacknowledged. The user may explicitly acknowledge an attention item without
changing its item state; the item remains visible as `NEEDS_ATTENTION` and is
included in the completion summary. `COMPLETE` is permitted only when every
item is terminal (`COMPLETE`, valid-encrypted no-op, or explicitly
acknowledged `NEEDS_ATTENTION`) and the Git-retention acknowledgment is
recorded.

## 15. Crash/restart semantics

The existing `recoverInterruptedOperations` and History metadata reconciliation
run before HTTP in both `server/prod.ts` and `server/vite-plugin.ts`. D8.4 adds
`DiaryMigrationService.recover` immediately after generic filesystem recovery
and before ordinary metadata scans. It never logs body bytes and never guesses
ownership.

| Crash point | Durable observation | Restart action |
| --- | --- | --- |
| Before plaintext read | Source primary unchanged; no migration temp | Reclassify. |
| After plaintext read | Source unchanged; ciphertext is memory-only | Remove any owned ciphertext temp; retry after unlock. |
| After encryption/verification | Ciphertext-only temp and structural journal may exist | Verify source generation; discard/retry without reading body while locked. |
| Before source move | Source remains canonical | Remove owned temp/journal; retry. |
| After source move, before publish | Same pre-existing plaintext inode at quarantine; target empty | Restore it create-only if directory/path ownership matches; otherwise quarantine and attention. |
| During publish | Target is either absent or ciphertext; no plaintext copy was made | Inspect target magic/identity and quarantine inode. Never overwrite an external target. |
| Immediately after encrypted publication | Encrypted target plus source quarantine may exist | Treat target as authoritative; continue cleanup, never restore source. |
| Before ledger update | Journal and target prove phase | Reconcile to `PUBLISHED`/`CLEANUP_PENDING` from structural state. |
| During SQLite cleanup | SQLite transaction commits or rolls back atomically | Keep encrypted target; retry cleanup forward. |
| During IndexedDB disposition | Exact rows are present or conditionally deleted | Re-read and repeat only the user-confirmed action; changed rows remain. |
| During Git inventory | Git itself is untouched | Re-run read-only inventory. |
| Before final COMPLETE | Ledger/auxiliary state may still be pending | Resume verification and cleanup; never claim complete from a missing marker. |

Lock/logout/expiry/capability replacement aborts pre-publication operations and
fences late results. Once the publication point has passed, authorization loss
does not undo ciphertext; a new unlocked run completes cleanup.

## 16. Privacy/logging requirements

Migration logs and API responses may contain only bounded canonical path,
stable ID when appropriate, phase, classification, stable error code and
counts. They must not contain body, frontmatter, title derived from body,
summary, tags, body hash, password, KEK, DEK, capability, provider payload or
raw exception serialization.

The implementation adds canaries such as `D8_4_PRIMARY_<random>`,
`D8_4_DRAFT_<random>`, `D8_4_FRONTMATTER_<random>` and
`D8_4_METADATA_<random>`. After each migration phase, tests search migration
temps/staging/journals, SQLite, IndexedDB, Git new commits, logs and test/
Playwright artifacts. The pre-existing legacy source is classified separately;
any newly created plaintext canary is an immediate STOP condition.

## 17. Compatibility

- An old vault opened by a D8.4 build remains unchanged until the explicit
  workflow starts. Opening without unlock never fetches or renders Diary body.
- A valid encrypted vault reopens locked; valid bytes are preserved and no
  migration is required.
- An interrupted migration resumes from its ledger/journal with the crash
  rules in §15.
- A user may upgrade without unlocking Diary; safe structural inventory is
  deferred or available without body access, and no body is migrated.
- A pre-D8.4 client cannot read V1 encrypted Diary bytes as Markdown. Downgrade
  compatibility for encrypted Diary is explicitly not promised; the user must
  return to a D8.4-capable build or use an authorized export made before
  downgrade.
- Ordinary Notes retain existing read/write/history/draft/search behavior.

## 18. Release guarantee

D8.4 completion guarantees that, for Docus-controlled current managed-Diary
surfaces, every supported legacy plaintext primary and auxiliary private store
has either been migrated/cleaned according to this policy or is surfaced as
explicit `NEEDS_ATTENTION`. No D8.4 migration transaction creates a new
durable plaintext Diary-body copy. Valid V1 encrypted files remain unchanged,
new D8.2/D8.3 boundaries remain active, and ordinary Note behavior is
regression-tested.

Completion does not guarantee cryptographic erasure from remote clones,
third-party backups, external editor copies, downloaded PDFs, OS clipboard
history, CI artifacts already exported, or arbitrary storage media. It does not
claim that legacy Git plaintext was purged; the chosen Git policy retains it.

## 19. Explicit residual risks

1. Legacy Git objects and all remote/external copies can retain plaintext.
2. A user-controlled process, an already-unlocked browser or the Docus server
   process can observe plaintext in memory during authorized work.
3. A mixed/invalid SQLite audit row may remain `NEEDS_ATTENTION` when ownership
   cannot be proven without a destructive guess.
4. Browser profiles can be copied outside the conditional IDB deletion owner.
5. Filesystem crash recovery cannot provide secure erase of an inode already
   written by a prior release.

These are disclosed residuals, not hidden completion claims.

## 20. Acceptance criteria

The future implementation is acceptable only when all are true:

- Every managed file is classified before generic parsing; all 23 planning
  decisions are implemented without a second key/session owner.
- Plaintext happy path, valid encrypted no-op, repeat/idempotency, malformed,
  unknown, auth/AAD/vault mismatch, missing/stale/ambiguous metadata,
  external races, lock/logout/expiry and restart tests pass.
- Filesystem inspection proves no new plaintext body in temp, staging, journal,
  rollback, recovery, quarantine, SQLite ledger, new Git commit, log or test
  artifact at every phase.
- Legacy Draft/Recovery rows are never silently deleted; valid rows are
  imported or typed-discarded, ambiguous rows remain attention, and no new
  managed persistent draft is written.
- SQLite and `frontmatter_backup` cleanup preserves identity/Mood, clears only
  proven managed private state, is transactional, restartable and leaves Notes
  untouched.
- Git inventory covers all required ref/object classes, no rewrite/force-push
  occurs, and retained exposure is explicitly acknowledged.
- Crash/restart recovery, rerun convergence and cross-platform filesystem
  behavior pass on Linux, macOS and Windows.
- Typecheck, build, full unit/integration, History, Recovery, browser E2E,
  Draft Store, auth, tags-scale, visual and Docker smoke suites are green.
- Implementation evidence, exact-head CI, residual-risk statement,
  Independent Review verdict and final docs-only closure lineage are recorded.

## 21. Out of scope

Encrypted Draft Store V2; encrypted Git history; history rewrite/purge; remote
force-push; password/DEK rekey; envelope migration; generic managed rename,
move, delete or reference rewriting; broad SQLite schema redesign; automatic
external-copy deletion; secure media erase; unrelated D7/D8.0-D8.3 reopening;
and any implementation work before Independent Planning Review approval.

The next authorized phase is **D8.4 Independent Planning Review**. It must
review this PRD and the companion Implementation Plan independently before any
production change begins.
