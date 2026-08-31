# D8.4 Migration, Legacy Cleanup & Release Closure PRD

Status: `REVIEW-READY`; D8.4 Independent Planning Review:
`CHANGES REQUIRED (0/5/3)` [historical]; D8.4 Planning Remediation:
`COMPLETE`; D8.4 Independent Planning Re-review: `PENDING`; implementation:
`NOT STARTED`. This is an authoritative planning document, not an
implementation or approval record. It is intentionally docs-only.

## 1. Status

The D8.3 closure is authoritative at
`c88e99554c291181c6e3f17e695aa228f34d40b2`. D8.3 is `REVIEW-CLOSED` and
D8.4 has not started. D8.4 becomes `APPROVED` only after a separate
Independent Planning Review. This document never self-declares approval.

The D8.4 planning state is:

```text
D8.4 Planning = REVIEW-READY / NOT APPROVED
D8.4 Independent Planning Review = CHANGES REQUIRED (0/5/3) [historical]
D8.4 Planning Remediation = COMPLETE
D8.4 Independent Planning Re-review = PENDING
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
| Legacy primary `diary/YYYY-MM-DD.md` | `server/routes/diary.ts`, `server/routes/posts.ts`, filesystem under `CONTENT_DIR` | Whole plaintext body | Structural type/mtime/device identity scan is allowed locked; a transient bounded byte count may be used only in process memory for I/O limits and is never persisted, returned or displayed; body read requires a current Diary lease | Path/date plus `documents.id`; missing ID is unresolved | Classify, then migrate with the custom no-copy protocol; remove the moved pre-existing source only after encrypted verification and explicit confirmation | Unlock required for body; `MIGRATE_PRIMARY` and `REMOVE_VERIFIED_LEGACY_PRIMARY` consents bind to one reviewed inventory revision/generation | New `DiaryMigrationService` plus startup recovery hook | Existing copies outside Docus remain |
| Valid V1 primary | `server/diaryAccess/body.ts` through Diary routes | Ciphertext at rest; plaintext only in lease/UI memory | Verify envelope only when unlocked; structural scan can identify magic/version without exposing body | AAD proves vault/id/path | Strict byte-for-byte no-op; no rekey | No migration confirmation for no-op | `DiaryMigrationService` verifies and records no-op | Valid encrypted body in authorized memory remains in scope of D8 threat model |
| Malformed/unknown/AAD-invalid primary | Same as above | Bytes may be private or corrupted | Never parsed as Markdown or plaintext | Identity cannot be trusted until verification | `NEEDS_ATTENTION`; preserve bytes; no overwrite | Unlock only for authenticated repair attempt; no automatic repair | Migration journal/ledger records code only | User must repair/export through a separately authorized path |
| Atomic temps/staging/journals | `server/atomicTextWrite.ts`, `server/crashRecovery.ts` (`.docus-save-*`, `.docus-staged-*`, `.docus-remove-*`, journals) | Ordinary protocols can contain plaintext while serving Notes | Existing recovery runs before HTTP; D8.4 migration must not route plaintext through them | Ownership hashes are generic; not sufficient for migration | Migration uses reserved ciphertext-only temp and structural migration journal; existing Note artifacts remain under current recovery | No body exposed locked | Existing `recoverInterruptedOperations` plus `DiaryMigrationService.recover` | Pre-D8 orphan artifacts may require attention |
| Legacy IDB `drafts` | `src/composables/vault/draft-recovery/draftStore.ts`, DB `docus-draft-recovery`, version 2 | `UnsavedDraft.content`, baseline/body timestamps | Locked inventory uses raw structural fields only; `readDisk` refuses managed paths | `(vaultId, documentId)` key; path in record | Retain until explicit `import-to-primary` or typed `discard-draft`; no automatic deletion | Unlock for import; typed confirmation for discard | Existing DraftStore conditional operations, orchestrated by migration service/UI | Browser profiles/backups outside Docus remain |
| Legacy IDB `draftConflicts` | Same DraftStore, key `(vaultId, documentId, conflictId)` | `DraftConflictRecord.content` and conflict context | Same locked restriction | Vault/document/conflict key | Same two explicit actions; ambiguous family is `NEEDS_ATTENTION` | Unlock/import or typed discard | DraftStore transaction across both stores | Browser storage may be copied by user |
| `documents` | `server/documentMetadata.ts`, SQLite `data/docus.db` | `title`, `summary`; timestamps and `mood` are allowed structural/UX fields only by policy | Read through structural projection; no new body parse | `id` and canonical `path` | Preserve id/path/created/updated/mood; set title to canonical date; clear summary after primary publication and confirmation | Cleanup confirmation | SQLite transaction under vault mutation + document lock | SQLite file backups may predate cleanup |
| `document_tags` / `tags` | `server/tagManagement.ts`, SQLite | Tag names/associations can derive from private frontmatter | Managed associations excluded from D8.3 public projection | `document_id` and FK | Delete managed associations; delete a tag row only when no Note association remains | Cleanup confirmation | Same SQLite transaction; mixed records are never split by guess | Shared tag row retained for Notes may reveal a tag name |
| `document_embeddings` | `server/documentMetadata.ts`, SQLite | Embeddings/content hashes are body-derived | Not exposed to locked managed projection | `document_id` | Delete managed rows after encrypted publication | Cleanup confirmation | SQLite transaction | Copies in DB backups are out of control |
| `metadata_migrations` | `server/metadataMigration.ts`, `server/frontmatterArchive.ts` | `frontmatter_backup`, `source_hash`, `cleaned_hash`, error text | Generic startup skips managed paths; D8.4 reads only structurally and under its owner | `path` plus a proven non-null `document_id`; `NULL` identity is unresolved | A `NULL`-identity row is `FRONTMATTER_IDENTITY_UNRESOLVED` and retained; only a separately proven identity binding may precede cleanup; Notes untouched | `CLEAN_PRIVATE_SQLITE` plus, when needed, `BIND_FRONTMATTER_IDENTITY` consent bound to the reviewed row/generation | SQLite transaction plus ledger `CLEANUP_PENDING` | Historic DB backups may retain old fields |
| AI `sessions` / `messages` | `server/migrations/0001_ai_history.sql`, `server/ai/messages.ts`, `server/ai/chat.ts`, `server/ai/tools.ts` | `messages.content` can contain a structured `read_file` tool result with legacy Diary plaintext | Locked inventory may expose only bounded counts and opaque session/message IDs; message-content classification requires an unlocked Diary body operation and is never rendered | Session/message IDs plus structured tool identity and canonical managed path; free-text resemblance is not identity proof | A provable managed-Diary tool-result exposure is `LEGACY_DIARY_AI_HISTORY`; default `NEEDS_ATTENTION`; explicit whole-session `discard-ai-session` or `retain-ai-history` only; ordinary/mixed text is never substring-redacted | `DISCARD_AI_SESSION` or `RETAIN_AI_HISTORY`, each bound to the reviewed session snapshot; unlock required for classification and discard | Existing AI session/message owner in one identity-bound SQLite transaction | Policy-retained AI history remains a Docus-controlled private residual and is disclosed |
| History metadata tables | `server/history/metadataRevisions.ts`, migrations 0009 | `history_metadata_restore_journal.before_raw/target_raw`, payload JSON, body SHA, expected hashes | D8.3 rejects new managed History; legacy rows can exist | `vault_id`, document/path, operation IDs | Delete rows proven to reference managed IDs/paths; retain identity-only tombstones; mixed operation is `NEEDS_ATTENTION` rather than split | Cleanup confirmation | SQLite transaction and forward retry | Git itself is handled separately |
| Tag Undo foundation | `tag_undo_records`, `tag_undo_association_deltas`, `tag_undo_state` | `operation_json`, tag names, managed association deltas | Not a Diary body reader in D8.3; inventory is bounded structural JSON inspection | `record_id`, delta document_id | Delete records/deltas proven managed-only; mixed/invalid JSON stays `NEEDS_ATTENTION`; Note-only records untouched | Cleanup confirmation for managed-only records | SQLite transaction | A mixed audit row can retain private names |
| Local Git working tree/refs/objects | `server/history/git.ts`, `server/history/routes.ts`, vault `.git` | Legacy plaintext commits, blobs, reflogs and unreachable objects | Read-only inventory; D8.3 blocks new managed commits | Commit/ref/path | Disclose and retain; no history rewrite in D8.4 | User must acknowledge retention before completion | `DiaryMigrationService` read-only Git inventory | Remote refs, clones and backups are not controlled |
| LinkIndex/search caches | `server/linkIndex.ts`, `src/lib/search.ts`, `src/lib/searchResults.ts` | Volatile body-derived links/snippets/cache entries | D8.3 filters; lock epoch clears managed residue | Path only | Verify empty managed body-derived state; no migration copy | No unlock needed for structural verification | Existing epoch/invalidation seams | Process/browser memory can exist while unlocked |
| Logs and test artifacts | `server/prod.ts`, `server/vite-plugin.ts`, sanitizer/e2e fixtures | Potential accidental body/error serialization | Must be redacted and canary-scanned | Structural path/code only | Add D8.4 canary checks; no raw body | No | Existing logger/test artifact owners | OS/provider logs outside Docus scope |

The inventory intentionally distinguishes Docus-controlled current stores from
external copies. A count is safe only when it is structural; no inventory API
returns a body excerpt. `sessions`, `messages` and structured managed-Diary
AI tool-result envelopes are Docus-controlled current stores, not external
residuals. Their message content is never copied into the migration ledger or
logs. A legacy file's exact byte length is treated as private body metadata:
it may exist transiently in an authorized process for bounded I/O, but never
in durable migration state, locked status, UI, logs or evidence.

## 7. User migration experience

### 7.1 Trigger and consent

The only trigger is an explicit **Diary Migration & Legacy Cleanup** workflow
opened from Settings or a user-visible post-upgrade banner. Opening, reading,
saving, searching, creating a new Diary date, or starting the server never
silently migrates a legacy file.

1. The user selects **Scan legacy Diary state**. Scan may run locked and creates
   an immutable `inventoryRevision` containing only counts, canonical
   dates/paths, stable IDs when already known, safe classifications and
   non-secret generation/provenance. A rescan never edits the reviewed
   snapshot: it creates the next revision and marks new or changed rows
   `CONSENT_REQUIRED`.
2. The user reviews one revision and grants independent action scopes. The
   exact scopes are `MIGRATE_PRIMARY`,
   `REMOVE_VERIFIED_LEGACY_PRIMARY`, `CLEAN_PRIVATE_SQLITE`,
   `IMPORT_DRAFT`, `DISCARD_DRAFT`, `DISCARD_AI_SESSION`,
   `RETAIN_AI_HISTORY`, `BIND_FRONTMATTER_IDENTITY` and
   `ACKNOWLEDGE_GIT_RETENTION`. Each destructive
   scope is bound to the vault, run, reviewed `inventoryRevision`, exact item
   identity and reviewed generation; no run-level boolean authorizes a later
   row or generation. Git retention and policy-retained AI history are
   explicit acknowledgements, not cleanup permission.
3. The workflow requests Diary unlock immediately before body migration or
   AI-content classification. Locked users can leave the workflow, rescan, or
   review safe Git/IDB/SQLite/AI counts and opaque IDs; they never see body or
   message text.
4. Progress is per item and per auxiliary store. No title, summary, tag,
   frontmatter, body length, body hash, snippet, message content or raw error
   is displayed. A generation or row change invalidates only the affected
   action consent and requires review in the new revision.
5. Rows needing identity adoption, draft/AI disposition, deferred
   authentication or external repair show `NEEDS_ATTENTION` (or the exact
   pending state below). They remain retained until an explicit action; the
   run cannot silently mark them complete.

### 7.2 Explicit item actions

The only body-bearing legacy Draft/Recovery actions are:

- `import-to-primary`: after unlock, check current encrypted primary identity
  and CAS baseline, then save through the normal D8.2 encrypted owner. Delete
  the exact IDB family only after verified save.
- `discard-draft`: requires the exact typed confirmation
  `DISCARD LEGACY DIARY RECOVERY`. It conditionally deletes the exact primary
  and conflict rows in one IndexedDB transaction. A missing or changed row is
  not deleted.

For a `LEGACY_DIARY_AI_HISTORY` item, the only destructive action is the
separately confirmed `discard-ai-session`. It deletes the whole affected AI
session through the existing session/message owner in one identity-bound
SQLite transaction; it never edits selected substrings. The alternative
`retain-ai-history` records an explicit policy-retained private residual and
leaves the whole session unchanged. Ordinary AI sessions and mixed sessions
without a provable structured managed-Diary tool result are not guessed at or
partially redacted.

For `METADATA_MISSING`, the only action is `adopt-metadata`, which creates the
minimal structural identity described in §11 after canonical date validation.
Adoption does not bind an existing `metadata_migrations` row whose
`document_id` is `NULL`. Such a row is
`FRONTMATTER_IDENTITY_UNRESOLVED` until a separately consented, non-destructive
identity-binding transaction proves the exact legacy generation and row CAS;
binding never clears the backup. For malformed, unknown, external,
missing-primary, deferred-auth or null-identity items, the action is
`acknowledge-attention` or `retry-item` after the user has repaired the
external condition; acknowledgement does not make the item `COMPLETE`.

There is no automatic external export flow in D8.4. A user may use the normal
explicit PDF/clipboard export surface while unlocked, but that copy is outside
the migration guarantee and is not used as a cleanup proof.

### 7.3 Completion screen

Completion reports separate counts for `COMPLETE` (resolved/cleaned),
`ALREADY_ENCRYPTED_VALID` (valid encrypted no-op), policy-retained private
state (including acknowledged AI history), and `NEEDS_ATTENTION` (unresolved
current Docus-controlled state). It separately lists policy-retained local
Git history and external/uncontrolled copies. It states exactly which current
Docus-controlled stores were cleaned; it never says “all plaintext removed”
when any retained or unresolved category remains.

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
RECOVERY_AUTH_REQUIRED
DURABILITY_PENDING
CONSENT_REQUIRED
LEGACY_DIARY_AI_HISTORY
FRONTMATTER_IDENTITY_UNRESOLVED
NEEDS_ATTENTION
```

Rules:

1. A file with the V1 magic is never treated as plaintext. An unlocked body
   operation verifies version, bounded envelope fields, tag and AAD using the
   current identity. A locked startup may inspect only non-secret structure;
   it must not call a syntactic envelope `valid` or advance to `PUBLISHED`.
   Valid V1 is a strict no-op only after authenticated verification; any
   failure maps to the corresponding encrypted/attention class.
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
   `MIGRATION_IN_PROGRESS`; a target that may have been published but cannot
   yet be authenticated after a locked restart is
   `RECOVERY_AUTH_REQUIRED`; a required filesystem durability boundary that
   has not been proven is `DURABILITY_PENDING`; a new or changed row after a
   reviewed snapshot is `CONSENT_REQUIRED`; a previously published item whose
   cleanup did not finish is `CLEANUP_PENDING`.
6. A structured legacy AI `read_file` tool-result envelope naming an exact
   managed path is `LEGACY_DIARY_AI_HISTORY`. Free-text resemblance is not
   sufficient. A `metadata_migrations` row with `document_id IS NULL` is
   `FRONTMATTER_IDENTITY_UNRESOLVED` and cannot be cleaned by path equality.

Classification uses bounded reads and may use byte length transiently for an
I/O limit, but byte length is private body metadata and is not persisted,
returned in locked status, logged or displayed. It does not store a persistent
body hash. Plaintext equivalence hashes, when needed, are transient memory
values; a ciphertext fingerprint used for transaction provenance is internal
and non-secret and is never returned as a locked projection.

## 9. Primary plaintext migration contract

### 9.1 One-document protocol

`DiaryMigrationService` uses a narrowly scoped protocol because the generic
`prepareAtomicTextWrite` path stages the old generation under a durable
`.docus-staged-*` name. Reusing it for a plaintext Diary would create a new
plaintext artifact. Every security-critical filesystem operation is owned by
one exact abstraction, `DiaryMigrationFs`; the service never calls a generic
pathname `rename`, copy, delete or alternate path directly. The migration protocol
is:

1. Canonicalize and validate the managed path, reject symlinks/reparse points
   and capture the vault directory identity through `DiaryMigrationFs`.
2. Resolve one stable `documentId`. For a missing row, stop at
   `METADATA_MISSING` until the user performs `adopt-metadata`; do not encrypt
   first. Validate the current immutable inventory revision and the action
   scopes `MIGRATE_PRIMARY` and `REMOVE_VERIFIED_LEGACY_PRIMARY`.
3. Acquire the existing `withVaultMutation` ownership, vault structure lock,
   sorted `withDocumentWriteLock`, and a `withDiaryBodyOperation` lease. The
   order is vault mutation -> structure lock -> document lock -> body lease;
   no second global lock is introduced.
4. Ask `DiaryMigrationFs.captureSourceGeneration()` for an owned source handle
   and generation token. A transient byte count may enforce a bounded read but
   is never durable or visible. Read plaintext only into the authorized
   operation's memory.
5. Encrypt with the existing lease-local `operation.encrypt` and the exact
   `BodyContext` (`vaultId`, `documentId`, canonical path). The service never
   receives or persists a raw DEK.
6. Authenticate the ciphertext immediately with `operation.decrypt`, verify
   exact plaintext equivalence in memory, and verify documentId, vaultId,
   canonical path and V1 envelope version.
7. Write only ciphertext to the same-directory reserved temporary file through
   `DiaryMigrationFs.writeCiphertextTemp()`. The file and required directory
   durability result are recorded. The journal contains only structural names,
   generation/provenance (never size), phase and codes.
8. Revalidate the source handle token and directory identity through the same
   owner. If the helper cannot bind the next operation to that exact
   generation, it fails closed with `SOURCE_GENERATION_CHANGED` or
   `diary-migration-filesystem-unsupported`; the external generation remains
   authoritative.
9. `DiaryMigrationFs.transitionSourceToQuarantine()` performs one native,
   handle-/directory-relative, no-copy transition of that exact pre-existing
   source generation to `.docus-diary-migration-source-*`. A pathname lstat
   followed by a pathname rename is not an ownership proof. The alternate
   name refers to the same pre-existing inode only and is deleted later by an
   ownership token, never by pathname alone.
10. `DiaryMigrationFs.publishCiphertextCreateOnly()` publishes the exact
    ciphertext artifact only when the canonical target is absent. Its
    no-replace result is atomic: an occupied target wins and is preserved; an
    unsupported, cross-device, open-handle or durability result is returned as
    a stable failure and no weaker rename or copy/delete path is attempted.
11. The helper authenticates-readback the exact target and compares its
    internal ciphertext fingerprint and target generation. Only after the
    required file and directory durability result is `DURABLE` may the service
    write the durable journal phase `PUBLISHED`. A durability result of
    `UNKNOWN` leaves `DURABILITY_PENDING`; it never advances to `PUBLISHED`.
12. If the process restarts locked after target publication but before the
    durable `PUBLISHED` write, recovery records `RECOVERY_AUTH_REQUIRED` (or
    `NEEDS_ATTENTION` on provenance mismatch), never treats envelope structure
    as authentication, never restores plaintext and never cleans. After
    unlock, the exact target fingerprint/generation is revalidated and the
    existing body lease performs AES-GCM/AAD authentication. Only success may
    advance to `PUBLISHED`/`CLEANUP_PENDING`.
13. After `PUBLISHED` and the user-confirmed, revision-bound SQLite,
    Draft/Recovery and AI dispositions, delete the moved source inode only
    through its ownership token. If any cleanup fails, retain it and mark
    `CLEANUP_PENDING`; never restore it as the primary. Mark the item and
    aggregate run `COMPLETE` only after all required cleanup gates, consent
    checks and no-new-plaintext checks succeed.

The migration service must not call generic plaintext `atomicReplaceTextIfUnchanged`,
`atomicRemoveTextIfUnchanged`, recovery payload writers, rename-reference
journals or generic delete staging for this protocol.

### 9.1a Authoritative filesystem safety contract

`DiaryMigrationFs` is the one migration filesystem owner. It exposes only
these semantic operations: `captureSourceGeneration`,
`transitionSourceToQuarantine`, `writeCiphertextTemp`,
`publishCiphertextCreateOnly`, `verifyCiphertextArtifact`,
`removeOwnedQuarantineGeneration` and `syncDurability`. Each operation is
directory-handle-/file-handle-relative and receives the opaque generation
token returned by the previous operation. A path-only lstat followed by a
pathname rename, a copy+delete, and an overwrite-capable rename are not valid
implementations of this contract.

The implementation must use one narrowly scoped native helper with adapters
that provide identical semantics on all release platforms:

| Platform | Required adapter semantics | Refusal/result |
| --- | --- | --- |
| Linux | `openat2`/directory-handle resolution with no symlink traversal; handle-bound source transition through the native helper; `renameat2(RENAME_NOREPLACE)` for ciphertext publication; file and directory `fsync` | Missing kernel/filesystem guarantee, cross-device or identity loss is `diary-migration-filesystem-unsupported` / `NEEDS_ATTENTION`; no pathname alternate |
| macOS | `openat`/directory-handle resolution with `O_NOFOLLOW`; handle-bound source transition through the native helper; `renameatx_np(RENAME_EXCL)` or an equivalent helper with atomic no-replace semantics; file and directory `fsync` | Same stable unsupported/attention result; no ordinary overwrite rename or copy operation |
| Windows | `CreateFileW` with reparse-point rejection and handle identity; `SetFileInformationByHandle(FileRenameInfoEx)` with fail-if-exists semantics for publication; handle-bound source transition; `FlushFileBuffers` on file and directory handles where required | Junction/reparse race, missing `O_NOFOLLOW` equivalent, sharing/antivirus handle, case-folded identity ambiguity, unsupported hard-link/no-replace or unavailable flush semantics is `diary-migration-filesystem-unsupported` (HTTP 503); no weak pathname operation |

The helper returns exact outcomes: `SOURCE_GENERATION_CHANGED`,
`TARGET_OCCUPIED` (the occupant wins and is preserved),
`FILESYSTEM_UNSUPPORTED`, `CROSS_DEVICE`, `SOURCE_BUSY`, `DURABLE`,
`DURABILITY_UNKNOWN` or `DURABILITY_FAILED`. `FILESYSTEM_UNSUPPORTED`,
`CROSS_DEVICE` and `SOURCE_BUSY` retain all unproven generations and map to
stable migration attention/errors. `DURABILITY_UNKNOWN` or
`DURABILITY_FAILED` retains the journal and ciphertext artifact, sets
`DURABILITY_PENDING` or `NEEDS_ATTENTION`, and never writes `PUBLISHED`.
No operation silently weakens its primitive.

The pre-existing plaintext is transitioned as the same generation (one inode,
never a second plaintext data copy) to the reserved quarantine name. The
quarantine pathname is not ownership: only its opaque token plus a fresh
handle identity check can authorize removal. A reused name, an external
replacement, a junction/reparse point, an open-handle error, or a target race
preserves the external generation and yields attention. The security invariant
is that D8.4 never allocates a second plaintext body artifact.

### 9.2 Commit point and monotonicity

The security linearization rule is exact: once the create-only ciphertext
publication syscall may have succeeded, plaintext restoration to the canonical
path is permanently forbidden, even if target durability or authenticated
readback has not yet been confirmed. `PUBLISHED` is a later, stronger state:
the exact target fingerprint/generation has been read back and authenticated
with the current Diary DEK/AAD, and the required file and directory durability
has been established before the durable journal write. Before the publication
syscall, failure may restore the same pre-existing inode only through its
`DiaryMigrationFs` ownership token. After the syscall may have succeeded:

```text
target is never overwritten or replaced by plaintext
plaintext is never restored to the canonical path
locked recovery = RECOVERY_AUTH_REQUIRED when provenance matches but crypto is
  not yet available; NEEDS_ATTENTION when provenance is absent/mismatched
cleanup is forbidden until post-unlock authentication and PUBLISHED
state = CLEANUP_PENDING only after PUBLISHED when a required cleanup is incomplete
```

The migration journal stores a transaction ID, canonical target, vault/document
identity, non-secret ciphertext/envelope SHA-256 fingerprint, target generation
identity (never byte size), phase and codes. A crash between publication and
journal update is therefore recoverable structurally without declaring the
envelope authenticated. After unlock, the body lease must compare the exact
fingerprint/generation and perform AES-GCM/AAD authentication before the item
can advance to `PUBLISHED`; a forged syntactic V1 or wrong transaction yields
`NEEDS_ATTENTION` with target and quarantine preserved. No plaintext rollback
payload is stored.

### 9.3 External-writer contract

At every phase, an external generation wins unless exact ownership is proven:

| Race | Required result |
| --- | --- |
| Edit before classification/read | Reclassify the new generation; do not use stale bytes. |
| Edit after read/encryption | Source generation mismatch; discard ciphertext temp, restore the moved original only if the exact `DiaryMigrationFs` token proves pre-publication ownership, and mark `EXTERNAL_PATH_CONFLICT`/`NEEDS_ATTENTION`. |
| Replace/delete before source move | Create-only/generation check fails; never overwrite or delete external bytes. |
| Target occupied during publish | Preserve the occupant, quarantine ciphertext and any moved source, mark `EXTERNAL_PATH_CONFLICT`. |
| Crash after source move before target publish | Startup restores the same source inode only through the native ownership primitive when the target is empty and directory identity matches; unsupported proof yields attention. |
| External replace after encrypted publish | Preserve external target. Retain verified encrypted generation/quarantine and mark `NEEDS_ATTENTION`; never delete the external file. |
| Path reused by another document ID | `METADATA_AMBIGUOUS`/`EXTERNAL_PATH_CONFLICT`; no destructive cleanup. |

Normal managed-Diary save/create uses the existing FIFO document lock and
serializes behind migration; the plan does not promise a migration-specific
409 merely because that lock is held. Once the ordinary save acquires the
lock, it revalidates session/CAS/primary state and either proceeds or returns
the existing semantic conflict. If the item is `RECOVERY_AUTH_REQUIRED`, body
read/write and same-date creation return `423 diary-migration-auth-required`.
Only competing migration-control requests may return
`409 diary-migration-in-progress`. New Diary creation at a different date may
continue and is immediately classified as `ALREADY_ENCRYPTED_VALID` by the
normal D8.2 create path.

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

Every import or discard is authorized by an `inventoryRevision`-bound
`IMPORT_DRAFT` or `DISCARD_DRAFT` consent for the exact `(vaultId, documentId,
canonicalPath, draftFamilyGeneration)` snapshot. A rescan or changed family
creates `CONSENT_REQUIRED`; an earlier run or typed phrase cannot authorize the
new row. `RECOVERY_AUTH_REQUIRED` also blocks import until cryptographic
reconciliation completes. The server reconstructs the current family and
conditional CAS; client-provided item keys or tokens are not authorization.

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

### 10.1 Durable AI history disposition

The SQLite `sessions` and `messages` stores from migration `0001_ai_history`
are first-class D8.4 inventory entries. The service parses only the persisted
structured message/tool envelope under the existing AI message owner. A
`read_file` tool identity, an exact canonical managed path and a structured
result are required to classify a message as `LEGACY_DIARY_AI_HISTORY`;
arbitrary user/assistant text that merely resembles a Diary entry is not
evidence. Classification that inspects message content requires an unlocked
Diary body operation, is never rendered to the user and never copies content
to the ledger, logs or status.

An affected session is hidden from ordinary AI history while locked; locked
status may show only bounded counts and opaque session/message IDs. After
unlock, the user chooses one independent action bound to the reviewed session
snapshot: `discard-ai-session` (explicit confirmation, whole-session delete
through `server/ai/messages.ts` in one identity-bound SQLite transaction) or
`retain-ai-history` (whole session remains as a Docus-controlled
policy-retained private residual). Mixed sessions are never substring-edited.
The default without a choice is `NEEDS_ATTENTION`; no silent redaction or
whole-session deletion occurs. Ordinary AI history without provable managed
Diary evidence is unchanged.

## 11. SQLite/private metadata contract

SQLite cleanup occurs only after encrypted primary publication, under
`withVaultMutation`, the relevant document locks, and one `BEGIN IMMEDIATE`
transaction. The stable document ID is preserved. The exact field policy is:

| Field/table | D8.4 action for managed Diary | Note behavior |
| --- | --- | --- |
| `documents.id`, `path`, `created_at`, `updated_at`, `mood` | Preserve; normalize path to the canonical date. Mood remains the structural Calendar value. | Unchanged. |
| `documents.title` | Set to canonical `YYYY-MM-DD`; never rederive from body. | Unchanged. |
| `documents.summary` | Clear to `''`; never copy into the encrypted body automatically. | Unchanged. |
| `sessions`, `messages.content` | Classify only structured managed-Diary `read_file` tool-result exposures. Apply explicit whole-session `discard-ai-session` or `retain-ai-history`; no substring rewrite and no deletion based on free text. | Ordinary sessions without provable managed-Diary evidence unchanged. |
| `document_tags` | Delete associations whose `document_id` is managed. | Associations and shared tag rows remain. |
| `tags` | Delete only rows with no remaining Note or other association. | Shared rows retained. |
| `document_embeddings` | Delete managed rows. | Unchanged. |
| `metadata_migrations` | A `NULL document_id` row is retained as `FRONTMATTER_IDENTITY_UNRESOLVED`; after separately verified identity binding, exact non-null ID/path/CAS plus `PUBLISHED` and no rollback dependency are required before clearing backup/hashes/error and setting `status='cleaned'`. | Unchanged. |
| `history_metadata_revisions` and restore journal | Delete rows proven to reference the managed ID/path, including `before_raw`, `target_raw`, payload and body SHA. | Unchanged. |
| `history_metadata_operations` | Delete a managed-only operation after its child rows are removed. A mixed operation that cannot be separated is retained and marked `NEEDS_ATTENTION`. | Unchanged. |
| `history_metadata_document_tombstones` | Retain identity/path-only tombstones. | Unchanged. |
| `tag_undo_association_deltas` | Delete deltas proven to reference managed IDs. | Unchanged. |
| `tag_undo_records` | Delete records whose deltas and bounded `operation_json` prove managed-only; mixed or invalid JSON is `NEEDS_ATTENTION`, never broad-deleted. | Unchanged. |
| `tag_undo_state` | Advance/retain state only through existing tag-undo owner; no body-derived field is added. | Unchanged. |
| migration ledger | Contains structural state only; no body, byte size, title/summary/tag value, backup, message content, plaintext hash or digest. It records inventory/consent revision, action scope, item/generation provenance and internal ciphertext fingerprint only. | No Note row is inserted. |

If SQLite cleanup fails after publication, the primary remains encrypted and
the ledger item is `CLEANUP_PENDING`. If cleanup succeeds but a later primary
step had not published, the ordering is invalid and implementation must stop;
the prescribed implementation never cleans SQLite before publication.

## 12. `frontmatter_backup` contract

`server/metadataMigration.ts` writes `metadata_migrations.frontmatter_backup`
for generic Notes; `server/frontmatterArchive.ts` reads it for preview/clean/
restore and deliberately skips managed Diary. Legacy managed rows are still a
first-class exposure. A row with `document_id IS NULL` is always
`FRONTMATTER_IDENTITY_UNRESOLVED` and `NEEDS_ATTENTION`; path equality alone
can never authorize binding or cleanup. `adopt-metadata` creates a current
DocumentMetadata identity but does not claim ownership of an old null-ID row.

If the user separately grants `BIND_FRONTMATTER_IDENTITY` for the reviewed
row/generation, D8.4 may perform a non-destructive binding transaction. It
selects the exact old row with `document_id IS NULL`, exact canonical path,
status, `source_hash`, `frontmatter_backup`, `cleaned_hash` and `updated_at`
CAS values; revalidates that the current source generation and migration item
are the legacy generation represented by that row; and sets only the stable
`document_id`. Binding never clears `frontmatter_backup`. If generation or CAS
proof is absent, the row remains retained attention.

Only after a non-null exact document ID, verified identity binding, primary
`PUBLISHED`, no rollback dependency and the same row CAS may D8.4 clear
`frontmatter_backup`, `source_hash`, `cleaned_hash` and error, set
`status='cleaned'`, and retain structural path/original-path fields in one
SQLite transaction. An already-cleaned row is a no-op. Ordinary Note rows and
the generic frontmatter archive contract are unchanged.

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
| Encrypted + malformed/unknown | Valid items no-op; invalid items remain `NEEDS_ATTENTION`; no plaintext interpretation. |
| Plaintext + missing metadata | Path/date is safe to show; item waits for explicit `adopt-metadata`. |
| Valid encrypted + stale metadata | AAD/ID mismatch is attention; metadata is not rewritten by path alone. |
| Primary missing + metadata exists | No body is created; `PRIMARY_MISSING` remains attention. |
| IDB only | Locked structural inventory; unlocked explicit import/discard; unresolved rows remain. |
| SQLite metadata only | Cleanup is independent but still requires identity and user confirmation. |
| Git history only | Disclosure/acknowledgment; no rewrite. |
| Cleanup pending/journal exists | Startup resumes forward from the durable phase; no plaintext rollback after a possible publication. If the target may be published but is not authenticated while locked, state is `RECOVERY_AUTH_REQUIRED`; no cleanup occurs. |
| New/changed row after reviewed scan | `CONSENT_REQUIRED`; the prior inventory revision/action scope cannot authorize it. |
| AI structured managed-Diary tool result | `LEGACY_DIARY_AI_HISTORY`; explicit whole-session discard or policy retention, otherwise attention. |
| Null-ID frontmatter backup | `FRONTMATTER_IDENTITY_UNRESOLVED`; retain until verified identity binding, never path-only cleanup. |
| Unsupported filesystem/durability | `DURABILITY_PENDING` or `NEEDS_ATTENTION`; retain journal/artifacts and never claim `PUBLISHED` without the required proof. |
| Orphan temp/staging artifact | Existing recovery handles generic artifacts; migration service handles only its reserved structural pattern and quarantines ambiguity. |
| External path reuse | External bytes win; migration artifacts are retained/quarantined and attention is surfaced. |
| Vault copied under a new identity | `getVaultId()` changes; all items are re-inventoried under the new vault tuple, and old ledger rows are not reused as proof. |

`NEEDS_ATTENTION` is explicit unresolved state, not success. The aggregate run
state is `ATTENTION_REQUIRED` while any item or required auxiliary decision is
unacknowledged. The user may explicitly acknowledge an attention item without
changing its item state; the item remains visible as `NEEDS_ATTENTION` and is
included in the completion summary. `COMPLETE` is permitted only when every
item is terminal (`COMPLETE`, valid-encrypted no-op, or explicitly
acknowledged `NEEDS_ATTENTION`), each policy-retained AI session is separately
acknowledged, and the Git-retention acknowledgment is recorded. The final
summary distinguishes resolved/cleaned state, valid encrypted no-op,
policy-retained private AI state, unresolved attention, policy-retained Git
history and external/uncontrolled copies.

## 15. Crash/restart semantics

The existing `recoverInterruptedOperations` and History metadata reconciliation
run before HTTP in both `server/prod.ts` and `server/vite-plugin.ts`. D8.4 adds
`DiaryMigrationService.recover` immediately after generic filesystem recovery
and before ordinary metadata scans. It never logs body bytes and never guesses
ownership.

At startup recovery may use only structural/non-secret evidence. If the target
is absent and the journal proves pre-publication, it may restore the exact
quarantined source only through the `DiaryMigrationFs` ownership token. If the
target exists and publication may have happened, recovery never restores
plaintext, never deletes quarantine and never marks `PUBLISHED` from envelope
parsing. A matching non-secret transaction fingerprint becomes
`RECOVERY_AUTH_REQUIRED`; a mismatch or missing provenance is
`NEEDS_ATTENTION`, with the external target preserved. After unlock, the
existing `DiaryBodyOperation` revalidates target identity and performs exact
AES-GCM/AAD authentication. Only success may advance to `PUBLISHED` or
`CLEANUP_PENDING`; failure is `NEEDS_ATTENTION` with no overwrite or cleanup.

The locked recovery matrix is frozen as:

| Case | Structural evidence | Locked result |
| --- | --- | --- |
| A | Target absent, journal pre-publication, exact owned source quarantine present | Restore the exact pre-existing source generation only through the frozen `DiaryMigrationFs` ownership primitive; otherwise `NEEDS_ATTENTION`. |
| B | Target exists and publication may have happened | Preserve target and quarantine; never restore plaintext, delete quarantine or mark `PUBLISHED` from syntax; matching fingerprint is `RECOVERY_AUTH_REQUIRED`, absent/mismatched provenance is `NEEDS_ATTENTION`. |
| C | Target generation/provenance does not match transaction evidence | Preserve the external target and every unproven artifact; `NEEDS_ATTENTION`; no cleanup. |

The deterministic crash oracle uses the exact hook enum below. A child Docus
server runs against an isolated temporary vault; at the selected hook it
signals the parent, the parent terminates the child without graceful cleanup,
and a fresh process restarts against the same durable state. No sleep,
waitForTimeout, timing guess or random kill is evidence.

| Hook | Filesystem state | Journal / SQLite ledger | IDB | Locked restart / authoritative generation | Allowed / forbidden action; next state |
| --- | --- | --- | --- | --- | --- |
| `AFTER_JOURNAL_PREPARED` | Source canonical; no ciphertext publication | PREPARING journal/item | unchanged | locked; source authoritative | Retry after consent/unlock; no cleanup; `PREPARING` |
| `AFTER_CIPHERTEXT_TEMP_FSYNC` | Source canonical; ciphertext temp durable | ENCRYPTED_VERIFIED journal | unchanged | locked; source authoritative | Re-probe source; temp may be removed only by token; `ENCRYPTED_VERIFIED` |
| `BEFORE_SOURCE_TRANSITION` | Source canonical; target absent | pre-publication | unchanged | locked; source authoritative | Retry or attention; no move/publish; `READY`/`NEEDS_ATTENTION` |
| `AFTER_SOURCE_TRANSITION` | Exact source inode at quarantine; target absent | PUBLISHING | unchanged | locked; quarantine authoritative pre-publication | Token-bound restore only if target empty; no pathname delete; `PUBLISHING` |
| `BEFORE_CIPHERTEXT_PUBLISH` | Quarantine source; ciphertext temp durable; target absent | PUBLISHING | unchanged | locked; source quarantine authoritative until syscall | Publish create-only or fail closed; no overwrite; `PUBLISHING` |
| `AFTER_CIPHERTEXT_PUBLISH_SYSCALL` | Target may exist; quarantine may exist | PUBLISHING, fingerprint recorded | unchanged | locked; target may be authoritative | Never restore plaintext; defer auth; `RECOVERY_AUTH_REQUIRED` or `NEEDS_ATTENTION` |
| `AFTER_TARGET_DURABILITY` | Target durable; quarantine may exist | target provenance recorded, not yet PUBLISHED | unchanged | locked; target may be authoritative | Auth only after unlock; no cleanup; `RECOVERY_AUTH_REQUIRED` |
| `AFTER_AUTHENTICATED_READBACK` | Exact target authenticated; quarantine may exist | target proof recorded, journal not PUBLISHED | unchanged | locked; target authoritative but ledger pending | Resume journal only after current lease; `PUBLISHED` pending |
| `BEFORE_PUBLISHED_JOURNAL` | Authenticated target; quarantine may exist | journal write not started | unchanged | locked; target authoritative | No plaintext restore; write journal after durability; `PUBLISHED` pending |
| `AFTER_PUBLISHED_JOURNAL` | Authenticated target; quarantine may exist | durable PUBLISHED | unchanged | locked; target authoritative | Cleanup forward only; `PUBLISHED`/`CLEANUP_PENDING` |
| `BEFORE_SQLITE_CLEANUP_COMMIT` | Authenticated target; quarantine may exist | PUBLISHED; SQLite transaction open | unchanged | locked; target authoritative | Rollback transaction; no target overwrite; `CLEANUP_PENDING` |
| `AFTER_SQLITE_CLEANUP_COMMIT` | Authenticated target; quarantine may exist | SQLite cleanup committed | unchanged | locked; target authoritative | Resume remaining confirmed gates; `CLEANUP_PENDING` |
| `BEFORE_IDB_DISPOSITION_COMMIT` | Authenticated target; quarantine may exist | PUBLISHED/cleanup pending | exact rows unchanged; IDB transaction open | locked; target authoritative | Abort/rollback IDB; changed rows require consent; `CLEANUP_PENDING` |
| `AFTER_IDB_DISPOSITION_COMMIT` | Authenticated target; quarantine may exist | ledger pending auxiliary completion | exact confirmed rows deleted or retained | locked; target authoritative | Re-read idempotently; no second destructive action; `CLEANUP_PENDING` |
| `BEFORE_SOURCE_QUARANTINE_REMOVE` | Authenticated target; exact source quarantine | cleanup pending | confirmed dispositions durable | locked; target authoritative | Remove only by token; otherwise attention; `CLEANUP_PENDING` |
| `AFTER_SOURCE_QUARANTINE_REMOVE` | Authenticated target; owned quarantine absent | cleanup pending | confirmed dispositions durable | locked; target authoritative | Verify no new plaintext; `CLEANUP_PENDING`/`COMPLETE` |
| `BEFORE_ITEM_COMPLETE` | Authenticated target; no owned plaintext quarantine | all required cleanup durable | dispositions durable | locked; target authoritative | Revalidate consent/provenance; no cleanup guess; `CLEANUP_PENDING` |
| `AFTER_ITEM_COMPLETE` | Authenticated target; no owned plaintext artifact | item COMPLETE durable | dispositions durable | locked; target authoritative | Idempotent no-op; aggregate may complete only with all consents/residuals |

Lock/logout/expiry/capability replacement aborts pre-publication operations and
fences late results. Once the publication syscall may have passed,
authorization loss does not undo ciphertext; a new unlocked run performs
deferred authentication and then completes cleanup. The same hook names and
oracle table are normative for the future test plan and implementation
evidence.

## 16. Privacy/logging requirements

Migration logs and API responses may contain only bounded canonical path,
stable ID when appropriate, opaque session/message IDs, phase, classification,
stable error code and counts. They must not contain body, message content,
frontmatter, title derived from body, summary, tags, body length/byte size,
body hash, plaintext digest, password, KEK, DEK, capability, provider payload
or raw exception serialization. Internal ciphertext fingerprint and generation
provenance are non-secret authorization evidence only; they are not returned
in a locked projection and cannot authorize mutation by themselves.

The implementation adds canaries such as `D8_4_PRIMARY_<random>`,
`D8_4_DRAFT_<random>`, `D8_4_FRONTMATTER_<random>` and
`D8_4_METADATA_<random>`. After each migration phase, tests search migration
temps/staging/journals, SQLite (including `sessions/messages`), IndexedDB, Git
new commits, logs and test/Playwright artifacts. The pre-existing legacy source
is classified separately; any newly created plaintext canary is an immediate
STOP condition. AI message content is never copied to any migration artifact.

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
(including SQLite `sessions/messages` and structured managed-Diary AI
tool-result envelopes) is in one explicitly reported category: resolved and
cleaned, valid encrypted no-op, policy-retained private state, or unresolved
`NEEDS_ATTENTION`. A provable AI exposure is never omitted from inventory or
closure; retention is Docus-controlled policy state, not an external residual.
No D8.4 migration transaction creates a new durable plaintext Diary-body copy.
Valid V1 encrypted files remain unchanged, new D8.2/D8.3 boundaries remain
active, and ordinary Note behavior is regression-tested.

Completion does not guarantee cryptographic erasure from remote clones,
third-party backups, external editor copies, downloaded PDFs, OS clipboard
history, CI artifacts already exported, or arbitrary storage media. It does not
claim that legacy Git plaintext was purged; the chosen Git policy retains it as
an explicitly acknowledged policy-retained local exposure. The completion
screen and evidence must separately disclose policy-retained AI history,
unresolved Docus-controlled attention and external/uncontrolled copies.

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
- Locked restart never treats a syntactic V1 envelope as authenticated:
  possible publication enters `RECOVERY_AUTH_REQUIRED`, unlock performs exact
  ciphertext-fingerprint/generation/AES-GCM/AAD reconciliation, and failed
  authentication preserves target/quarantine with `NEEDS_ATTENTION`.
- Plaintext happy path, valid encrypted no-op, repeat/idempotency, malformed,
  unknown, auth/AAD/vault mismatch, missing/stale/ambiguous metadata,
  external races, lock/logout/expiry and restart tests pass.
- Filesystem inspection proves no new plaintext body in temp, staging, journal,
  rollback, recovery, quarantine, SQLite ledger, new Git commit, log or test
  artifact at every phase.
- `DiaryMigrationFs` is the sole native ownership/publication owner on Linux,
  macOS and Windows; no unsupported operation falls back to copy/delete or
  overwrite rename, and unknown directory durability never becomes `PUBLISHED`.
- Every destructive action is bound to an immutable `inventoryRevision`, exact
  item/generation and action scope; a new/changed row requires new consent.
- Legacy Draft/Recovery rows are never silently deleted; valid rows are
  imported or typed-discarded, ambiguous rows remain attention, and no new
  managed persistent draft is written.
- SQLite and `frontmatter_backup` cleanup preserves identity/Mood, clears only
  proven managed private state, retains null-ID rows as
  `FRONTMATTER_IDENTITY_UNRESOLVED` until a verified non-destructive binding,
  is transactional/restartable and leaves Notes untouched.
- SQLite AI `sessions/messages` are inventoried; provable structured
  managed-Diary tool-result exposure receives explicit whole-session discard or
  policy-retention/attention, while ordinary and mixed text is not guessed at.
- Git inventory covers all required ref/object classes, no rewrite/force-push
  occurs, and retained exposure is explicitly acknowledged.
- Crash/restart recovery, rerun convergence and cross-platform filesystem
  behavior pass on Linux, macOS and Windows using the exact deterministic hook
  enum/oracle in §15; no timing sleeps are accepted.
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

The next authorized phase is **D8.4 Independent Planning Re-review**. It must
revisit the historical `CHANGES REQUIRED (0/5/3)` findings against this PRD,
the companion Implementation Plan and the immutable review evidence before
any production change begins.
