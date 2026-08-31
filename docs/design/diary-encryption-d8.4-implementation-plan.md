# D8.4 Migration, Legacy Cleanup & Release Closure — Implementation Plan

Status: `REVIEW-READY`; D8.4 Planning Independent Review: `PENDING`;
implementation: `NOT STARTED`. This plan is the implementation authority
after Planning Review approval. It contains no production implementation.

## 1. Status / lifecycle

```text
D8.0 = REVIEW-CLOSED
D8.1 = REVIEW-CLOSED
D8.2 = REVIEW-CLOSED
D8.3 = REVIEW-CLOSED
D8.4 Planning = REVIEW-READY
D8.4 Planning Independent Review = PENDING
D8.4 implementation = NOT STARTED
D8.4 = NOT REVIEW-CLOSED
```

The future sequence is Planning Independent Review -> `APPROVED` ->
implementation -> self-review -> implementation Independent Review -> any
remediation/re-review -> docs-only closure -> `D8.4 REVIEW-CLOSED`. Planning
approval and implementation are separate events.

## 2. Baseline / provenance

Gate 0 was verified before drafting:

```text
HEAD:        c88e99554c291181c6e3f17e695aa228f34d40b2
branch:      main
github/main: c88e99554c291181c6e3f17e695aa228f34d40b2
status:      clean
closure CI:  #597 / run 33391810588 / attempt 1 / 8 of 8 PASS
```

The closure run's exact head is `c88e99554c291181c6e3f17e695aa228f34d40b2`.
The D8.3 lineage remains in the canonical lifecycle document: planning
`99f693b02080127c16911869c17edcb2fa38fe3c`, implementation
`584cf770111bc2f5ee86be08ecda7ea50586bc87`, final implementation checkpoint
`6308947cd6fd758cd6055a687a1d4e49891a5e2c`, remediation
`b49b51d5a56608479f0b46086eef739d77308d20`, re-review
`1a8ef24ce32a7f7185ef8de25897680ca6b17c20`, and closure `c88e995...`.

This plan was written after reading the D8.0-D8.3 authority chain and source
owners in the actual checkout. No reset, checkout, schema/data mutation or
production change is part of Planning.

## 3. Current owner inventory

| Concern | Current owner / evidence | D8.4 implementation boundary |
| --- | --- | --- |
| Diary path identity | `shared/diaryProtocol.ts`: `parseDiaryDate`, `diaryDateFromPath`, `isManagedDiaryPath`, `classifyDiaryPath` | Normalize extensionless logical path first; reject invalid, absolute, dot-segment, case-variant, symlink and nested look-alikes. |
| Primary read/create/save | `server/routes/diary.ts`, `server/routes/posts.ts` (`saveManagedDiary`), `server/diaryAccess/guard.ts` | Migration service is the only legacy body reader; normal D8.2 routes keep their owner and are blocked per document while migration runs. |
| Diary access/encryption | `server/diaryAccess/service.ts` (`DiaryAccessService`, `withBodyOperation`), `server/diaryAccess/body.ts` | Reuse the existing lease-local `encrypt`/`decrypt`; no raw DEK or new capability owner. |
| Vault identity | `server/vaultIdentity.ts:getVaultId()` | Stable vault tuple component; copying a vault changes identity and invalidates old ledger proof. |
| Atomic durability | `server/atomicTextWrite.ts` (`prepareAtomicTextWrite`, `prepareAtomicTextCreate`) | Do not use the generic plaintext replace path for migration; add a ciphertext-only migration protocol beside it. |
| Crash recovery | `server/crashRecovery.ts:recoverInterruptedOperations`, called by `server/prod.ts` and `server/vite-plugin.ts` before HTTP | Extend startup with `DiaryMigrationService.recover`; generic Note recovery remains unchanged. |
| Document metadata | `server/documentMetadata.ts` (`createDocumentMetadata`, `getDocumentMetadata`, snapshots/restore) | Preserve stable id/path/timestamps/Mood; minimal adoption row is created only by explicit action. |
| SQLite connection/migrations | `server/db.ts`, migrations 0002-0011 | Future migration 0012 adds only the structural D8.4 ledger; cleanup is one `BEGIN IMMEDIATE` transaction. |
| Frontmatter archive | `server/metadataMigration.ts`, `server/frontmatterArchive.ts` | Managed rows are skipped by generic owner and cleaned only by D8.4 identity-checked transaction. |
| IndexedDB Draft/Recovery | `draftStore.ts` (DB `docus-draft-recovery`, v2), `useUnsavedDraftPersistence.ts`, `useUnsavedDraftRecovery.ts`, `useDraftRecoveryManagement.ts` | Inventory legacy rows; import through encrypted primary or typed-discard; no encrypted Draft Store V2. |
| Search | `src/lib/search.ts` (`bodyCache`, `primeBody`, epoch), `src/lib/searchResults.ts` | Verify no managed body cache; keep D8.3 structural-only behavior. |
| LinkIndex | `server/linkIndex.ts`, client `useLinkIndex` | Structural path/existence only; no migration body parsing or new managed links. |
| History/Git | `server/history/git.ts:addAndCommit`, `server/history/routes.ts`, `server/history/restore.ts` | Read-only legacy inventory; no rewrite, prune, ref mutation or force-push. |
| UI/session teardown | `useDiaryAccessSession`, `createVaultContext`, VaultView and epoch seams | Fence migration callbacks and clear managed memory on lock; no second epoch/session authority. |

## 4. Architectural decisions

The following 23 decisions are frozen. “Rejected alternative” is historical
context, not an implementation choice left open.

| # | Decision | Chosen contract and owner |
| ---: | --- | --- |
| 1 | Migration trigger / UX | Explicit Settings/post-upgrade **Diary Migration & Legacy Cleanup** workflow. Scan is explicit and structural; migration never runs on open/read/save/search/startup. User confirms migration, removal of the pre-existing source after verification, and Git retention. |
| 2 | Orchestrator owner | New server-side `DiaryMigrationService` under `server/diaryMigration/`, called by dedicated routes and startup recovery; it composes existing owners and makes all migration decisions. |
| 3 | State machine | Item states are `DISCOVERED`, `NEEDS_UNLOCK`, `READY`, `PREPARING`, `ENCRYPTED_VERIFIED`, `PUBLISHING`, `PUBLISHED`, `CLEANUP_PENDING`, `COMPLETE`, `NEEDS_ATTENTION`; aggregate states are `NOT_STARTED`, `INVENTORIED`, `NEEDS_UNLOCK`, `RUNNING`, `ATTENTION_REQUIRED`, `COMPLETE`, `FAILED`. |
| 4 | Ledger storage/schema | Future SQLite migration `0012` adds `diary_migration_runs` and `diary_migration_items` with structural fields only; exact schema is §6. |
| 5 | Stable idempotency identity | Resolved item key is `(vaultId, documentId, canonicalLogicalPath, migrationSchemaVersion=1)`. Unresolved path inventory rows cannot authorize mutation and are replaced by the resolved tuple after `adopt-metadata`. |
| 6 | Plaintext primary protocol | Custom same-directory migration protocol: read one owned legacy generation, encrypt in memory, write ciphertext-only temp, move the same pre-existing plaintext inode to reserved quarantine, create-only publish ciphertext, verify, then clean. Generic plaintext atomic replace is not used. |
| 7 | Durable commit point | Successful fsynced ciphertext publication at the canonical path, after source revalidation and authenticated readback, followed by durable journal phase `PUBLISHED`. |
| 8 | Monotonic rollback | Before publication, restore the same original inode create-only on safe failure. After publication, never restore plaintext; resume forward and use `CLEANUP_PENDING`. |
| 9 | No-new-plaintext artifacts | Migration temp, journal, ledger, rollback/recovery payload and quarantine created by D8.4 contain ciphertext or structural ownership only. The only allowed plaintext quarantine is the one pre-existing source inode moved, not copied. |
| 10 | Missing metadata | Canonical path/date is validated first. The item waits for explicit `adopt-metadata`; `DocumentMetadata` creates a UUID row with date title, empty summary/tags and null Mood without parsing body. Ambiguous/stale identity is attention. |
| 11 | Malformed/unknown envelope | Magic-present malformed, auth failure, unknown version, wrong vault/id/path are never plaintext. Preserve bytes, return stable non-secret code, classify `NEEDS_ATTENTION`, and do not overwrite. |
| 12 | External-writer races | Exact source generation and directory identity are required at every boundary. External generation wins; migration never overwrites/deletes an unproven generation and quarantines its own artifacts for attention. |
| 13 | Legacy Draft/Recovery | Locked structural inventory only. After unlock, each valid family has exactly `import-to-primary` or typed `discard-draft`; ambiguous/changed families remain attention. No silent delete. |
| 14 | Encrypted Draft Store V2 | Out. D8.4 only disposes/migrates legacy rows; new managed persistent Draft/Recovery stays disabled. |
| 15 | Private SQLite metadata | Preserve structural identity/timestamps/Mood; normalize title to date; clear summary, managed tags/embeddings and proven managed history raw/payload rows after encrypted publication and confirmation. Mixed ownership remains attention. |
| 16 | `frontmatter_backup` | Identity-checked transactional cleanup: managed row becomes `cleaned`, backup/source/cleaned hashes and error clear; Note rows are untouched. Pending cleanup is resumable. |
| 17 | Git history | Disclose and retain. Inventory all local ref/object exposure classes read-only; do not rewrite or purge. Completion wording never claims historical purge. |
| 18 | Git remote policy | Automatic remote mutation and force-push are forbidden. Remote repositories, clones and remote-tracking objects are residual exposure. |
| 19 | Partial/attention semantics | Per-document atomic transactions with vault aggregate. Any unacknowledged attention item yields `ATTENTION_REQUIRED`; explicit acknowledgement leaves the item visible as `NEEDS_ATTENTION` but permits aggregate `COMPLETE` with residual disclosure. |
| 20 | Completion guarantee | All supported Docus-controlled legacy plaintext/current private stores are cleaned or explicitly surfaced as attention; no new durable plaintext body copy is created; valid V1 bytes are unchanged. |
| 21 | Residual risk | Legacy Git, remote/external backups, exports, clipboard history, browser copies, unlocked process memory and forensic erase remain outside the guarantee and are disclosed. |
| 22 | Release gate | §20 exact gate: migration/cleanup, no-new-plaintext, malformed fail-closed, crash/idempotency, Note regression, cross-platform, full CI, evidence, residual disclosure and review lineage all pass. |
| 23 | Overall closure | After implementation evidence and Independent Review/re-review, create a separate docs-only closure commit setting `D8.4 = REVIEW-CLOSED`; only then set overall `D8 Diary Encryption = REVIEW-CLOSED` in the canonical lifecycle. |

### 4.1 Decision records

Each decision has the same security owner: `DiaryMigrationService` delegates
cryptographic work to `DiaryAccessService`, filesystem ownership to existing
safe-path/lock primitives, metadata to `DocumentMetadata`, and client storage
to the existing DraftStore. Rejected alternatives were automatic lazy
migration, a second client key owner, generic plaintext atomic replace, an
encrypted Draft Store V2, automatic Git rewrite and remote force-push. None is
implemented by this plan.

## 5. Migration state machine

### 5.1 Item transitions

| From -> to | Preconditions / durable write | Access and locks | Crash/retry / UI |
| --- | --- | --- | --- |
| `DISCOVERED -> NEEDS_UNLOCK` | Legacy body or body-bearing auxiliary requires unlock; ledger records class/code only | No body read | Locked banner; resume after unlock. |
| `DISCOVERED -> READY` | Canonical path, stable identity and generation proven; no body mutation | Structural locks for probe only | Retry re-probes generation. |
| `DISCOVERED -> COMPLETE` | Valid encrypted no-op or proven missing primary with no supported work | No body exposure for no-op; missing primary remains attention instead of this path | Idempotent status. |
| `READY -> PREPARING` | User confirmation, lease and all locks acquired; journal created | Vault mutation -> structure -> document -> body lease | Crash before source move leaves source unchanged; retry. |
| `PREPARING -> ENCRYPTED_VERIFIED` | Ciphertext temp fsynced and decrypt/readback matches transient plaintext | Body lease remains current | Ciphertext temp/journal are replayable; no body in durable state. |
| `ENCRYPTED_VERIFIED -> PUBLISHING` | Source generation revalidated and same inode moved to owned quarantine | Same locks and lease | External mismatch stops before move/publish. |
| `PUBLISHING -> PUBLISHED` | Create-only target publish, fsync and authenticated readback succeed | Lease must still be current before publish; post-publish is monotonic | Recovery treats encrypted target authoritative. |
| `PUBLISHED -> CLEANUP_PENDING` | Any SQLite/IDB/source cleanup or final verification fails | Cleanup transaction/conditional IDB owner | Retry forward; never restore plaintext. |
| `PUBLISHED -> COMPLETE` | All required cleanup gates and final canary/identity verification pass | Metadata transaction and no active external conflict | Terminal success. |
| Any pre-publish -> `NEEDS_ATTENTION` | Identity conflict, external mutation, malformed source or unrecoverable ownership proof | No destructive fallback | Preserve/quarantine and show stable code. |
| `CLEANUP_PENDING -> COMPLETE` | Re-run proves encrypted target and all confirmed cleanup complete | Unlock only for body-bearing checks | Idempotent forward retry. |
| `NEEDS_ATTENTION -> READY` | User repaired external/identity condition and requested `retry-item` | Required unlock/locks reacquired | No implicit retry from a timer. |

`MIGRATION_IN_PROGRESS` is a classification/code for a concurrent journal, not
a state that authorizes a second writer. `NEEDS_ATTENTION` is terminal until an
explicit user action; it is never silently converted to `COMPLETE`.

### 5.2 Aggregate transitions

`NOT_STARTED -> INVENTORIED` follows an explicit scan. `INVENTORIED ->
NEEDS_UNLOCK` occurs when legacy body work is present. `INVENTORIED` or
`NEEDS_UNLOCK -> RUNNING` follows all confirmations and a current lease.
`RUNNING -> ATTENTION_REQUIRED` occurs on any unacknowledged item or auxiliary
decision. `RUNNING -> COMPLETE` requires every item to be terminal (`COMPLETE`,
valid-encrypted no-op, or explicitly acknowledged `NEEDS_ATTENTION`) plus Git
retention acknowledgment. Any unexpected storage failure is `FAILED` with a
resumable ledger/journal; it is not success.

## 6. Migration ledger

Future SQLite migration `0012_diary_migration_ledger.sql` creates exactly:

```sql
CREATE TABLE diary_migration_runs (
  run_id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  state TEXT NOT NULL CHECK (state IN (
    'NOT_STARTED','INVENTORIED','NEEDS_UNLOCK','RUNNING',
    'ATTENTION_REQUIRED','COMPLETE','FAILED'
  )),
  migration_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (migration_confirmed IN (0,1)),
  legacy_primary_removal_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (legacy_primary_removal_confirmed IN (0,1)),
  git_retention_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (git_retention_acknowledged IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE diary_migration_items (
  item_key TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES diary_migration_runs(run_id),
  vault_id TEXT NOT NULL,
  document_id TEXT,
  canonical_path TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  classification TEXT NOT NULL CHECK (classification IN (
    'ALREADY_ENCRYPTED_VALID','LEGACY_PLAINTEXT',
    'ENCRYPTED_MALFORMED','ENCRYPTED_UNKNOWN_VERSION',
    'ENCRYPTED_IDENTITY_MISMATCH','METADATA_MISSING',
    'METADATA_AMBIGUOUS','PRIMARY_MISSING','EXTERNAL_PATH_CONFLICT',
    'MIGRATION_IN_PROGRESS','CLEANUP_PENDING','NEEDS_ATTENTION'
  )),
  state TEXT NOT NULL CHECK (state IN (
    'DISCOVERED','NEEDS_UNLOCK','READY','PREPARING',
    'ENCRYPTED_VERIFIED','PUBLISHING','PUBLISHED',
    'CLEANUP_PENDING','COMPLETE','NEEDS_ATTENTION'
  )),
  source_generation_json TEXT,
  quarantine_generation_json TEXT,
  envelope_version INTEGER,
  attention_code TEXT,
  user_action TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_diary_migration_items_run_state
  ON diary_migration_items(run_id, state);
CREATE INDEX idx_diary_migration_items_identity
  ON diary_migration_items(vault_id, document_id, canonical_path, schema_version);
```

`item_key` is the literal encoded tuple
`vaultId\u0000documentId\u0000canonicalPath\u00001` for resolved items. A
pre-adoption inventory row uses `UNRESOLVED\u0000canonicalPath\u00001` only to
display an attention item; it cannot enter `PREPARING` and is replaced by the
resolved tuple after `adopt-metadata`.

The generation JSON contains only regular-file type, device, inode, size,
mtime/mtimeNs and directory identity. It contains no body hash. The ledger
forbids password, KEK, DEK, capability, raw body, excerpt, frontmatter,
title/summary/tags, recovery content and body-derived digest. Journal and
ledger updates are structural and idempotent.

## 7. Workstream A — discovery/classification

1. Add a `DiaryMigrationService.scan()` that enumerates only canonical managed
   paths using the existing symlink-safe resolver and bounded resource limits.
2. Inspect the first envelope bytes only to distinguish no-magic legacy bytes
   from magic-present bytes; never send magic-present bytes to Markdown,
   gray-matter or LinkIndex.
3. Resolve `DocumentMetadata` by exact path and ID. Detect stale rows,
   duplicate physical generations, path reuse and vault-ID mismatch before any
   body operation.
4. Inventory the IDB database and stores through a client bridge that returns
   structural fields only while locked. Inventory all SQLite private tables and
   local Git exposure classes read-only.
5. Persist only the §6 structural ledger and expose counts/path/date/status.
   Do not persist a body hash to make inventory look idempotent.

Entry proof: every managed file is one of the exact classifications in the PRD;
every unresolved identity is blocked before encryption; all ordinary Notes are
absent from the ledger.

## 8. Workstream B — primary plaintext migration

Implement the §9 protocol in a dedicated module. The migration temporary name
is `.docus-diary-migrate-ciphertext-<uuid>` and the moved source name is
`.docus-diary-migration-source-<uuid>`. Both are reserved, same-directory,
ownership-checked names. The source name is a moved pre-existing inode, never a
copy; it is deleted only after the confirmed post-publication cleanup gate.

The service must use `fs.open` with no-follow semantics, `lstat` generation
capture, an immediate second `lstat`/directory-identity check immediately
before moving the source inode, same-filesystem create-only link/rename for
ciphertext publication, file/parent fsync where supported, and
`verifySafePathResolution` before every irreversible step. It must use the
existing body lease for encryption, decryption and `assertCurrent()`.

Normal `PUT /api/posts/:path` for the locked document returns
`409 diary-migration-in-progress` while the document lock is held. A new date
created at another path continues through normal D8.2 encrypted create and is
classified as a valid-encrypted no-op.

## 9. Workstream C — Draft/Recovery legacy disposition

The client bridge adds explicit inventory and decision calls around the existing
`DraftStore.inspectVaultRecovery`, conditional delete APIs and family path
rules. It must not reuse ordinary Note recovery rendering for managed rows.

For `import-to-primary`, the unlocked UI shows the row only after current
identity and path are revalidated; the server performs an encrypted D8.2 save
with the row's baseline/CAS. Successful encrypted readback is the commit for
the import, followed by one IDB transaction deleting the exact primary and
selected conflict rows. A stale baseline or changed family returns attention.

For `discard-draft`, require the literal confirmation
`DISCARD LEGACY DIARY RECOVERY`; conditional deletion returns `deleted`,
`missing`, `stale` or `unsupported` and never drops a changed row. There is no
automatic cleanup timer for managed rows. Lock/logout/expiry calls the existing
`clearSensitiveState` seams synchronously before new state can publish.

Exit proof: locked row bodies never render/enter search/AI/clipboard/PDF;
valid rows are imported or typed-discarded; ambiguous rows remain; no new
managed persistent Draft is written; Note Draft tests are unchanged.

## 10. Workstream D — SQLite/private metadata

Add a D8.4 cleanup transaction owned by the migration service but implemented
through existing `documentMetadata`/tag/history owners. Before deletion, select
rows by exact managed `document_id` plus canonical path and verify the item is
`PUBLISHED`. In `BEGIN IMMEDIATE`, apply the field table in PRD §11, delete
managed history raw/payload rows and tag deltas, remove only orphaned shared tag
rows, and update ledger state after commit.

History operations with mixed managed and Note children are not split by path;
they remain and set `NEEDS_ATTENTION`. `history_metadata_document_tombstones`
remain identity-only. Invalid `tag_undo_records.operation_json` is never broad
deleted; it is attention. A transaction rollback leaves the encrypted primary
authoritative and the item `CLEANUP_PENDING`.

## 11. Workstream E — `frontmatter_backup`

The service queries `metadata_migrations` by exact path/document ID and requires
no active rollback journal and a `PUBLISHED` item. It clears
`frontmatter_backup`, `source_hash`, `cleaned_hash` and error and sets
`status='cleaned'` in the same SQLite transaction as the other managed private
cleanup. It preserves path, document ID and original path. An already-cleaned
row is a no-op; a mismatched or shared row is attention. Generic startup
`migrateVaultMetadata` and ordinary Note `frontmatterArchive` behavior remain
unchanged.

## 12. Workstream F — Git/history

Implement a read-only Git inventory in the migration service using the vault
repo owner (`server/history/git.ts`) and isolated commands equivalent to
`for-each-ref`, `rev-list --all --objects` and `fsck --no-reflogs --unreachable`.
Classify current tree/index, local branches/tags, remote-tracking refs, stash,
reachable commits, reflogs and unreachable objects separately. Record only
counts, refs, commit IDs and canonical managed paths in the report; never emit
blob content.

Do not call `addAndCommit`, `update-ref`, filter-repo, reflog expiry, prune or
push. The user-visible start request must acknowledge retention. The release
evidence records that D8.4 did not rewrite local or remote history and lists
uncontrolled residual classes.

## 13. Workstream G — mixed-state/crash recovery

Extend startup order to:

```text
vault writer ownership
seed folders
existing recoverInterruptedOperations
DiaryMigrationService.recover
History metadata reconcile
generic Note metadata migration
tag health
HTTP listener
```

`recover` recognizes only `.docus-diary-migrate-ciphertext-*`,
`.docus-diary-migration-source-*` and its structural journal. It validates
directory/inode ownership and V1 envelope identity, never logs body bytes, and
uses the matrix below. Generic `.docus-staged-*` and `.docus-delete-inflight-*`
remain owned by existing recovery and are not repurposed for Diary migration.

## 14. Workstream H — migration UX/API

### 14.1 Exact API surface

All endpoints require the existing authenticated application session and set
`Cache-Control: no-store`. Responses contain structural state only.

| Method/path | Request | Success | Auth/unlock | Side effect / idempotency |
| --- | --- | --- | --- | --- |
| `GET /api/diary/migration/status` | none | `200` run state, counts, safe item path/date/id/classification/state | Login; locked allowed | Read-only; same run returned. |
| `POST /api/diary/migration/scan` | `{}` | `202` `{runId,state,counts}` | Login; locked allowed | Structural inventory; existing active run is refreshed, no body mutation. |
| `POST /api/diary/migration/start` | `{runId,confirmMigration:true,confirmLegacyPrimaryRemoval:true,acknowledgeGitRetention:true}` | `202` `{runId,state}` | Login + current unlocked Diary lease | Starts one vault run; duplicate start returns `409 diary-migration-in-progress` or `409 diary-migration-already-complete`. |
| `POST /api/diary/migration/resume` | `{runId}` | `202` `{runId,state}` | Login + unlocked lease | Resumes journal/ledger forward; safe to repeat. |
| `POST /api/diary/migration/items/:itemKey/resolve` | `{action:'adopt-metadata'|'import-to-primary'|'discard-draft'|'retry-item'|'acknowledge-attention',confirmation?:'DISCARD LEGACY DIARY RECOVERY'}` | `202` item state | `adopt-metadata`/body actions require unlock; retry/ack require login | One exact item action; changed identity/family remains attention. |

There is no Git rewrite endpoint. Git retention is the only supported policy.
No endpoint returns a body for diagnostics or export.

### 14.2 Stable errors/statuses

| HTTP | Code | Meaning |
| ---: | --- | --- |
| 400 | `diary-migration-invalid-confirmation` | Request fields or typed discard confirmation are not exact. |
| 401 | existing auth error | Application login is absent/expired. |
| 404 | `diary-migration-run-not-found` | Run/item key is not present in this vault. |
| 409 | `diary-migration-already-complete` | Start requested for a completed run. |
| 409 | `diary-migration-in-progress` | Another vault/document migration owns the lock. |
| 409 | `diary-migration-identity-missing` | Required identity/adoption action is outstanding. |
| 409 | `diary-migration-identity-ambiguous` | More than one identity/generation can claim the path. |
| 409 | `diary-migration-external-mutation` | Generation/path changed or external writer won. |
| 409 | `diary-migration-cleanup-pending` | Encrypted publication succeeded; auxiliary cleanup remains. |
| 409 | `diary-migration-draft-decision-required` | Legacy Draft/Recovery action is not chosen. |
| 409 | `diary-migration-git-decision-required` | Retention acknowledgment is absent. |
| 409 | `diary-migration-attention-required` | Run has unresolved attention items. |
| 200 (item) | `diary-migration-legacy-plaintext` | Item classification returned in safe status/item data, not as an implicit mutation error. |
| 422 | `diary-migration-malformed-envelope` | Magic-present envelope is malformed/auth-invalid. |
| 422 | `diary-migration-unknown-envelope` | Envelope version is unsupported. |
| 422 | `diary-migration-identity-mismatch` | AAD vault/document/path does not match. |
| 423 | `diary-migration-locked` | Operation requires current Diary body access. |
| 503 | `diary-migration-unavailable` | Migration owner/ledger/recovery dependency is unavailable. |

Error bodies contain only `code`, a generic safe message, and bounded
structural details. Client-only invalidation and stale epoch results do not
become HTTP conflicts.

## 15. Workstream I — diagnostics/artifacts

Use a structured redacted logger. Canary tests must search every migration
temp, journal, quarantine, SQLite table, IndexedDB migration response, new Git
commit, server output, browser console, trace, screenshot, video and test
attachment for fresh values `D8_4_PRIMARY_<random>`, `D8_4_DRAFT_<random>`,
`D8_4_FRONTMATTER_<random>`, and `D8_4_METADATA_<random>`.

The canary harness records whether a matching legacy source existed before the
run. A match in a newly created durable artifact is failure even if the final
primary is encrypted. Body values, passwords, keys, capabilities, provider
payloads and raw exceptions are forbidden in logs/artifacts.

## 16. Workstream J — release/full regression

Add focused migration suites without weakening existing tests. Preserve the
D8.3 managed-path gates and run the complete existing quality bar. Release is
blocked until §20 passes and the implementation evidence has an exact-head CI
run, residual-risk statement and Independent Review lineage.

## 17. Test matrix

### 17.1 Primary and identity

| Case | Expected proof |
| --- | --- |
| Plaintext happy path | Ciphertext-only durable artifacts; encrypted target decrypts exactly; source inode removed only after confirmation. |
| Valid encrypted | Byte-for-byte no-op and `ALREADY_ENCRYPTED_VALID`. |
| Repeat/rerun | Same tuple converges without re-encryption or duplicate artifact. |
| Malformed/unknown/auth/AAD/vault mismatch | Stable 422/classification, no overwrite or plaintext fallback. |
| Missing/stale/ambiguous metadata | No encryption until adoption; wrong identity remains attention. |
| External save/replace/path reuse at each race | External generation wins; no clobber/delete; artifact quarantine is structural. |
| Lock/logout/expiry/capability replacement | Pre-publish operation aborts/fences; post-publish resumes forward. |
| Server restart at every hook | Matrix §19 result and idempotent retry. |

### 17.2 No-new-plaintext proof

After every hook, inspect temp/staging/journal/rollback/recovery/quarantine,
SQLite ledger, new Git commits, logs and test artifacts. Assert no fresh body
canary appears. Assert valid old legacy source is distinguished from a new
copy. Verify the ledger has no forbidden column/value.

### 17.3 Draft/SQLite/Git

- Locked legacy IDB row is not rendered; unlock discovers valid identity;
  import, typed discard, ambiguous identity, crash during deletion and retry
  all preserve user edits; ordinary Note Draft Store is unchanged.
- Managed SQLite private rows clean transactionally; Note rows, stable ID and
  Mood remain; `frontmatter_backup` cleanup is idempotent; crash rolls back.
- Git inventory covers branches/tags/remotes/stash/reflogs/reachable and
  unreachable objects; no local rewrite/remote force-push; ordinary Note Git
  history is unchanged; rerun is read-only.

### 17.4 Path/platform/scale

Test valid and invalid spellings (`diary/2026-08-31`, `.md`, absolute,
duplicate separators, dot segments, nested/wrong-case/wrong-extension),
symlinked file/directory, directory replacement, cross-device temp refusal,
many dates, large bounded bodies, many IDB rows and large Git histories.

## 18. Cross-platform validation

Run Linux, macOS and Windows jobs. Verify same-directory rename/link and open
handle behavior, directory fsync availability, case sensitivity, path
separator normalization, device/inode availability and bounded retry policy.
When a platform cannot fsync a directory, the implementation must use the
existing documented best-effort primitive and retain the journal until the
next verified startup; it must not claim durability from a sleep or arbitrary
retry count.

## 19. Failure/rollback matrix

| Failure point | Before/after commit | Required recovery |
| --- | --- | --- |
| Source read/encrypt/verify | Before | Original canonical plaintext remains; ciphertext temp is deleted/quarantined; retry after unlock. |
| Source generation changed | Before | Do not publish; external generation wins; reclassify/attention. |
| Source moved, target empty | Before | Restore the same inode create-only only when ownership and directory identity match; otherwise quarantine/attention. |
| Target occupied during publish | Before | Preserve occupant; quarantine ciphertext/source; attention. |
| Publish succeeds, process dies | After | Verify encrypted target; never restore plaintext; mark `PUBLISHED`/`CLEANUP_PENDING` and resume. |
| SQLite cleanup transaction aborts | After | SQLite rolls back; encrypted target remains; retry forward. |
| IDB disposition aborts | After auxiliary gate | Rows remain or conditional deletion is visible; repeat only confirmed action. |
| Git inventory fails | Independent read-only stage | Keep current data; retry inventory; no Git mutation. |
| Final completion marker fails | After | Ledger remains pending; startup reruns final verification and cleanup. |

The only automatic rollback is pre-publication restoration of the same
pre-existing inode. No post-publication error path writes plaintext to the
canonical path.

## 20. CI gate

The D8.4 implementation gate requires all of:

1. all migratable plaintext primaries are `COMPLETE` or explicit
   `NEEDS_ATTENTION` with user-visible code;
2. no newly created durable plaintext migration artifact;
3. valid encrypted files are byte-preserving no-ops;
4. malformed/unknown/AAD-invalid envelopes fail closed;
5. legacy Draft/Recovery, SQLite private metadata and `frontmatter_backup`
   follow the frozen action and preserve Note rows;
6. Git policy is applied as read-only disclosure and retention is acknowledged;
7. crash/restart and rerun idempotency proofs pass;
8. ordinary Note read/write/history/search/Draft behavior passes regression;
9. Linux/macOS/Windows cross-platform tests pass;
10. typecheck, build, full unit/integration, History, Recovery, browser E2E,
    Draft Store browser E2E, auth, tags-scale, visual and Docker smoke are
    green, plus all D8.4 suites;
11. docs, inventory, evidence, canary output and residual-risk disclosure are
    complete; and
12. implementation Independent Review passes (or its remediation/re-review
    chain is complete) before closure.

## 21. Evidence requirements

The future implementation evidence must record: starting HEAD and planning
approval commit; implementation commits; per-store inventory; every state
transition; no-new-plaintext canary proof; crash/restart and idempotency proof;
Draft/Recovery disposition; SQLite/`frontmatter_backup` cleanup; Git policy
proof; ordinary Note regression; cross-platform counts; exact-head CI run;
residual-risk statement; Independent Review verdict; remediation/re-review if
any; and final docs-only closure lineage.

## 22. Review/closure lifecycle

After this planning commit, stop. The next action is D8.4 Independent Planning
Review. A reviewer must verify the actual source owners, all 23 frozen
decisions, the no-copy migration protocol, state/ledger/API/error contracts,
crash matrix, Note non-regression, and release gate. Only a separate approval
may authorize implementation.

After implementation, create implementation evidence and request a separate
Independent Review. Address findings in separate remediation commits, obtain
re-review, and then create a docs-only closure record. The closure record must
state `D8.4 = REVIEW-CLOSED` only after all required gates and review lineage
are complete; it must then update the canonical D8 lifecycle to overall
`D8 Diary Encryption = REVIEW-CLOSED`.
