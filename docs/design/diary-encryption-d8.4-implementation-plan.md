# D8.4 Migration, Legacy Cleanup & Release Closure — Implementation Plan

Status: `REVIEW-READY`; D8.4 Independent Planning Review:
`CHANGES REQUIRED (0/5/3)` [historical]; D8.4 Planning Remediation Round 1:
`COMPLETE`; D8.4 Independent Planning Re-review:
`CHANGES REQUIRED (0/1/1)` [historical]; D8.4 Planning Remediation Round 2:
`COMPLETE`; D8.4 Independent Planning Re-review Round 2: `PENDING`;
implementation: `BLOCKED / NOT STARTED`. This plan is the implementation
authority after Planning Review approval. It contains no production
implementation.

## 1. Status / lifecycle

```text
D8.0 = REVIEW-CLOSED
D8.1 = REVIEW-CLOSED
D8.2 = REVIEW-CLOSED
D8.3 = REVIEW-CLOSED
D8.4 Planning = REVIEW-READY / NOT APPROVED
D8.4 Independent Planning Review = CHANGES REQUIRED (0/5/3) [historical]
D8.4 Planning Remediation Round 1 = COMPLETE
D8.4 Independent Planning Re-review = CHANGES REQUIRED (0/1/1) [historical]
D8.4 Planning Remediation Round 2 = COMPLETE
D8.4 Independent Planning Re-review Round 2 = PENDING
D8.4 implementation = BLOCKED / NOT STARTED
D8.4 = NOT REVIEW-CLOSED
```

The future sequence is Planning Independent Review -> any docs-only
remediation/re-review -> `APPROVED` ->
implementation -> self-review -> implementation Independent Review -> any
remediation/re-review -> docs-only closure -> `D8.4 REVIEW-CLOSED`. Planning
approval and implementation are separate events.

## 2. Baseline / provenance

The original planning gate was verified before drafting:

```text
HEAD:        c88e99554c291181c6e3f17e695aa228f34d40b2
branch:      main
github/main: c88e99554c291181c6e3f17e695aa228f34d40b2
status:      clean
closure CI:  #597 / run 33391810588 / attempt 1 / 8 of 8 PASS
```

The closure run's exact head is `c88e99554c291181c6e3f17e695aa228f34d40b2`.
The original D8.4 planning commit was
`cbd5424ebe82737604b621a1be58f1c1b965e5f0`; its Independent Planning Review
commit is `9f8d06d1f0dd2223dfc2ccc3d313f4a30053c386` with historical verdict
`CHANGES REQUIRED (0/5/3)`. This remediation changes planning documents only;
the historical review remains immutable and the next gate is an Independent
Planning Re-review.
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
| Atomic durability / migration filesystem | `server/atomicTextWrite.ts` is the existing Note owner; future `DiaryMigrationFs` is the sole D8.4 native filesystem owner | Do not use the generic plaintext replace path for migration. `DiaryMigrationFs` must provide one captured-handle conditional source transition whose native mutation compares source and parent generations, create-only ciphertext publication, exact artifact verification and explicit durability/unsupported results on Linux, macOS and Windows. |
| Crash recovery | `server/crashRecovery.ts:recoverInterruptedOperations`, called by `server/prod.ts` and `server/vite-plugin.ts` before HTTP | Extend startup with `DiaryMigrationService.recover`; generic Note recovery remains unchanged. |
| Document metadata | `server/documentMetadata.ts` (`createDocumentMetadata`, `getDocumentMetadata`, snapshots/restore) | Preserve stable id/path/timestamps/Mood; minimal adoption row is created only by explicit action. |
| SQLite connection/migrations | `server/db.ts`, migrations 0001-0011 (including `0001_ai_history.sql`) | Future migration 0012 adds only the structural D8.4 ledger and AI/frontmatter consent provenance; cleanup is one `BEGIN IMMEDIATE` transaction. |
| Frontmatter archive | `server/metadataMigration.ts`, `server/frontmatterArchive.ts` | Managed rows are skipped by generic owner and cleaned only by D8.4 identity-checked transaction. |
| IndexedDB Draft/Recovery | `draftStore.ts` (DB `docus-draft-recovery`, v2), `useUnsavedDraftPersistence.ts`, `useUnsavedDraftRecovery.ts`, `useDraftRecoveryManagement.ts` | Inventory legacy rows; import through encrypted primary or typed-discard; no encrypted Draft Store V2. |
| AI history | `server/migrations/0001_ai_history.sql`, `server/ai/messages.ts`, `server/ai/chat.ts`, `server/ai/tools.ts` | Inventory sessions/messages and structured managed-Diary `read_file` results; require unlock for content classification; whole-session explicit discard or policy retention; no free-text or substring surgery. |
| Search | `src/lib/search.ts` (`bodyCache`, `primeBody`, epoch), `src/lib/searchResults.ts` | Verify no managed body cache; keep D8.3 structural-only behavior. |
| LinkIndex | `server/linkIndex.ts`, client `useLinkIndex` | Structural path/existence only; no migration body parsing or new managed links. |
| History/Git | `server/history/git.ts:addAndCommit`, `server/history/routes.ts`, `server/history/restore.ts` | Read-only legacy inventory; no rewrite, prune, ref mutation or force-push. |
| UI/session teardown | `useDiaryAccessSession`, `createVaultContext`, VaultView and epoch seams | Fence migration callbacks and clear managed memory on lock; no second epoch/session authority. |
| Consent/inventory authority | Future `DiaryMigrationService` plus the D8.4 ledger/API/UI | Immutable `inventoryRevision` snapshots and action-scoped consents are reconstructed and checked server-side; client tokens never authorize a later generation. |

## 4. Architectural decisions

The following 23 decisions are frozen. “Rejected alternative” is historical
context, not an implementation choice left open.

| # | Decision | Chosen contract and owner |
| ---: | --- | --- |
| 1 | Migration trigger / UX | Explicit Settings/post-upgrade **Diary Migration & Legacy Cleanup** workflow. Scan is explicit and structural; migration never runs on open/read/save/search/startup. Scan creates an immutable `inventoryRevision`; the user grants independent, revision-bound action scopes for primary migration/removal, private SQLite/AI/frontmatter work, Draft actions and Git/AI retention. |
| 2 | Orchestrator owner | New server-side `DiaryMigrationService` under `server/diaryMigration/`, called by dedicated routes and startup recovery; it composes existing owners and makes all migration decisions. |
| 3 | State machine | Item states are `DISCOVERED`, `NEEDS_UNLOCK`, `READY`, `PREPARING`, `ENCRYPTED_VERIFIED`, `PUBLISHING`, `RECOVERY_AUTH_REQUIRED`, `DURABILITY_PENDING`, `CONSENT_REQUIRED`, `PUBLISHED`, `CLEANUP_PENDING`, `COMPLETE`, `NEEDS_ATTENTION`; aggregate states are `NOT_STARTED`, `INVENTORIED`, `NEEDS_UNLOCK`, `RUNNING`, `ATTENTION_REQUIRED`, `COMPLETE`, `FAILED`. A syntactic V1 target is never `PUBLISHED`; policy-retained AI history is a separately recorded terminal disposition. |
| 4 | Ledger storage/schema | Future SQLite migration `0012` adds `diary_migration_runs`, `diary_migration_items` and action-scoped consent/provenance records with structural fields only: immutable `inventoryRevision`, reviewed generation, action scope, exact ciphertext fingerprint, AI session identity and frontmatter binding CAS; no plaintext/body size. Exact proposal is §6. |
| 5 | Stable idempotency identity | Resolved item key is `(vaultId, documentId, canonicalLogicalPath, migrationSchemaVersion=1)`. Unresolved path inventory rows cannot authorize mutation and are replaced by the resolved tuple after `adopt-metadata`. |
| 6 | Plaintext primary protocol | `DiaryMigrationFs` is the sole native owner: capture an exact source/parent authority, encrypt in memory, write ciphertext-only temp, perform the one captured-handle conditional transition of the same pre-existing inode to reserved quarantine, publish the exact ciphertext with atomic no-replace, verify and clean. Generic pathname rename/copy/delete and weaker alternate primitives are forbidden. |
| 7 | Durable commit point | Security linearization is the moment ciphertext publication may have succeeded: plaintext restoration is permanently forbidden from that point. `PUBLISHED` requires exact ciphertext fingerprint/generation, AES-GCM/AAD authenticated readback with the unlocked body lease, and required file/directory durability before the durable journal write. Locked uncertainty is `RECOVERY_AUTH_REQUIRED`, never `PUBLISHED`. |
| 8 | Monotonic rollback | Before the publication syscall, restore the same original inode only through a live or exact restart-reacquired `DiaryMigrationFs` ownership token. After the syscall may have succeeded, never restore plaintext or overwrite a target; defer authentication, use `RECOVERY_AUTH_REQUIRED`/`DURABILITY_PENDING`/`CLEANUP_PENDING`, or surface attention. |
| 9 | No-new-plaintext artifacts | Migration temp, journal, ledger, rollback/recovery payload and quarantine created by D8.4 contain ciphertext or structural ownership only. The only allowed plaintext quarantine is the one pre-existing source inode transitioned without a second data copy; a quarantine pathname or matching metadata never authorizes deletion. |
| 10 | Missing metadata | Canonical path/date is validated first. The item waits for explicit `adopt-metadata`; `DocumentMetadata` creates a UUID row with date title, empty summary/tags and null Mood without parsing body. Ambiguous/stale identity and null-ID frontmatter ownership are attention; adoption never binds a backup by path alone. |
| 11 | Malformed/unknown envelope | Magic-present malformed, auth failure, unknown version, wrong vault/id/path are never plaintext. Preserve bytes, return stable non-secret code, classify `NEEDS_ATTENTION`, and do not overwrite. |
| 12 | External-writer races | All source transition, quarantine removal and target publication use the frozen `DiaryMigrationFs` native contracts. The mutation itself proves exact source/parent generation; external generation wins; unsupported, junction/reparse, cross-device, open-handle or durability results fail closed and retain artifacts. |
| 13 | Legacy Draft/Recovery | Locked structural inventory only. After unlock, each valid family has exactly `import-to-primary` or typed `discard-draft`, each bound to an immutable inventory revision/generation and action scope; ambiguous/changed families remain attention. No silent delete. |
| 14 | Encrypted Draft Store V2 | Out. D8.4 only disposes/migrates legacy rows; new managed persistent Draft/Recovery stays disabled. |
| 15 | Private SQLite metadata | Preserve structural identity/timestamps/Mood; normalize title to date; clear summary, managed tags/embeddings and proven managed history raw/payload rows after encrypted publication and action-scoped confirmation. Inventory `0001` AI sessions/messages; provable managed-Diary tool results get explicit whole-session discard or policy retention/attention. Mixed ownership remains attention. |
| 16 | `frontmatter_backup` | A `NULL document_id` is `FRONTMATTER_IDENTITY_UNRESOLVED` and retained. Optional explicit `BIND_FRONTMATTER_IDENTITY` may set a non-null ID only after exact row/generation/CAS proof and never clears backup; cleanup then requires non-null identity, `PUBLISHED`, no rollback dependency and the same CAS. Note rows are untouched. |
| 17 | Git history | Disclose and retain. Inventory all local ref/object exposure classes read-only; do not rewrite or purge. Completion wording never claims historical purge. |
| 18 | Git remote policy | Automatic remote mutation and force-push are forbidden. Remote repositories, clones and remote-tracking objects are residual exposure. |
| 19 | Partial/attention semantics | Per-document atomic transactions with vault aggregate and immutable `inventoryRevision`. Independent consents are `MIGRATE_PRIMARY`, `REMOVE_VERIFIED_LEGACY_PRIMARY`, `CLEAN_PRIVATE_SQLITE`, `IMPORT_DRAFT`, `DISCARD_DRAFT`, `DISCARD_AI_SESSION`, `RETAIN_AI_HISTORY`, `BIND_FRONTMATTER_IDENTITY` and `ACKNOWLEDGE_GIT_RETENTION`; new/changed rows are `CONSENT_REQUIRED`. Any unacknowledged attention yields `ATTENTION_REQUIRED`; acknowledged attention remains visible. |
| 20 | Completion guarantee | Every supported Docus-controlled current private store, including AI sessions/messages and frontmatter null rows, is explicitly resolved/cleaned, valid-encrypted no-op, policy-retained private state or `NEEDS_ATTENTION`; no new durable plaintext body copy is created; valid V1 bytes are unchanged. Git policy-retained and external residuals are reported separately. |
| 21 | Residual risk | Legacy Git, remote/external backups, exports, clipboard history, browser copies, unlocked process memory and forensic erase remain outside the guarantee and are disclosed. |
| 22 | Release gate | §20 exact gate: migration/cleanup, deferred-auth recovery, no-new-plaintext/no-body-size, malformed fail-closed, action-scoped consent, AI/frontmatter disposition, crash/idempotency using the exact hook oracle, Note regression, cross-platform, full CI, evidence, residual disclosure and review lineage all pass. |
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
| `DISCOVERED -> CONSENT_REQUIRED` | Item is new/changed relative to immutable reviewed `inventoryRevision` | Structural probe only | No action until a new revision/scope is reviewed. |
| `DISCOVERED -> READY` | Canonical path, stable identity, current revision and generation proven; no body mutation | Structural locks for probe only | Retry re-probes generation and consent. |
| `DISCOVERED -> COMPLETE` | Valid encrypted no-op after authenticated verification | No body exposure for no-op; missing primary remains attention | Idempotent status. |
| `READY -> PREPARING` | Revision-bound action consent, lease and all locks acquired; journal created | Vault mutation -> structure -> document -> body lease | Crash before source transition leaves source unchanged; retry. |
| `PREPARING -> ENCRYPTED_VERIFIED` | Ciphertext temp durable and decrypt/readback matches transient plaintext | Body lease remains current | Temp/journal replayable; no body in durable state. |
| `ENCRYPTED_VERIFIED -> PUBLISHING` | `DiaryMigrationFs.transitionOwnedSource` performs the captured-source/expected-parent conditional mutation and returns exact quarantine provenance | Same locks and live native authorities | Unsupported/identity mismatch/occupied quarantine stops before publication; no pathname fallback. |
| `PUBLISHING -> DURABILITY_PENDING` | Publication or directory durability may have happened but required durability result is unknown | No cleanup; target not overwritten | Retain artifacts/journal; retry verified durability. |
| `PUBLISHING -> RECOVERY_AUTH_REQUIRED` | Target may have been published; transaction fingerprint/generation matches but server is locked | No cleanup/body mutation | Unlock reconciliation required; never call syntactic V1 valid. |
| `PUBLISHING -> PUBLISHED` | Create-only target publish, required durability and authenticated readback succeed | Lease must be current for auth; post-publication is monotonic | Target authoritative; cleanup forward only. |
| `PUBLISHED -> CLEANUP_PENDING` | Any SQLite/IDB/AI/frontmatter/source cleanup or final verification fails | Cleanup owner and action scopes | Retry forward; never restore plaintext. |
| `PUBLISHED -> COMPLETE` | All required cleanup gates, consent and final canary/identity checks pass | Metadata transaction and no active external conflict | Terminal resolved/cleaned result. |
| Any pre-publication -> `NEEDS_ATTENTION` | Identity conflict, external mutation, malformed source, unsupported filesystem or failed authentication | No weaker alternate primitive | Preserve/quarantine and show stable code. |
| `CLEANUP_PENDING -> COMPLETE` | Re-run proves authenticated target and all confirmed cleanup complete | Unlock for body/AI checks; same scopes | Idempotent forward retry. |
| `RECOVERY_AUTH_REQUIRED -> PUBLISHED` | Unlock, exact fingerprint/generation and AES-GCM/AAD auth succeed with current lease | Body lease required | Journal phase is written only after durable proof. |
| `RECOVERY_AUTH_REQUIRED -> NEEDS_ATTENTION` | Auth/fingerprint/generation mismatch or forged syntactic V1 | No overwrite or cleanup | Target/quarantine preserved; explicit attention. |
| `NEEDS_ATTENTION -> READY` | User repaired condition, new revision/scope reviewed and requested `retry-item` | Required unlock/locks reacquired | No implicit retry from a timer. |

`MIGRATION_IN_PROGRESS` is a classification/code for a concurrent journal, not
a state that authorizes a second writer. `RECOVERY_AUTH_REQUIRED`,
`DURABILITY_PENDING` and `CONSENT_REQUIRED` are not success and block cleanup
or body mutation. A `CONSENT_REQUIRED` item cannot inherit an earlier
revision. `NEEDS_ATTENTION` is terminal until an explicit user action; it is
never silently converted to `COMPLETE`.

### 5.2 Aggregate transitions

`NOT_STARTED -> INVENTORIED` follows an explicit scan that creates an immutable
`inventoryRevision`. `INVENTORIED -> NEEDS_UNLOCK` occurs when legacy body
work is present. `INVENTORIED` or `NEEDS_UNLOCK -> RUNNING` follows all current
action scopes and a current lease; a rescan creates a new revision and
invalidates stale consent for changed/new rows.
`RUNNING -> ATTENTION_REQUIRED` occurs on any unacknowledged item or auxiliary
decision. `RUNNING -> COMPLETE` requires every item to be terminal (`COMPLETE`,
valid-encrypted no-op, explicitly acknowledged `NEEDS_ATTENTION`, or explicit
policy-retained AI state) plus Git-retention and AI-retention acknowledgments.
Any unexpected storage failure is `FAILED` with a resumable ledger/journal; it
is not success.

### 5.3 Restart authority state machine

Logical identity, observed filesystem generation, live mutation authority and
restart recovery authority are separate types. The item key
`(vaultId, documentId, canonicalPath, schemaVersion)` selects an item only; it
never authorizes a mutation. Device/volume plus inode/file ID, parent identity
and available birth/generation provenance identify an observed generation, but
matching those fields to a ledger row is still not destructive authority. A
live source/parent/quarantine handle pair is authority only for the one native
conditional operation that consumes it. A crash destroys that process-local
authority.

The required restart transitions are:

```text
owned live source
    -> source transitioned to quarantine
    -> live token lost by crash
    -> structural recovery
    -> exact native quarantine reacquisition
       -> REACQUIRED_EXACT_QUARANTINE
          (forward cleanup may continue after publication/auth gates)
       -> QUARANTINE_OWNERSHIP_UNPROVEN
          -> NEEDS_ATTENTION
```

Before source transition, the durable journal records the reviewed
`inventoryRevision`, logical identity, transaction/schema version, expected
parent generation, captured source generation, reserved quarantine name and
phase. After the native transition and parent durability barrier, the helper's
returned quarantine generation and parent generation are durably recorded.
These records contain only structural provenance (including a platform file
handle/generation when it is non-secret and restart-reacquirable), reserved
names, phase, durability and internal ciphertext fingerprint. They never store
body, body length, body hash/digest, keys, capabilities or message content.

Restart may enter `REACQUIRED_EXACT_QUARANTINE` only when a platform-native
operation opens the expected parent and reserved name without symlink/reparse
traversal, compares the persisted generation and parent in the same authority
domain, and returns a new handle-bound token. Missing post-transition
provenance, a missing quarantine, a parent replacement, a same-name different
generation, or an unavailable native reacquisition primitive enters
`QUARANTINE_OWNERSHIP_UNPROVEN` and `NEEDS_ATTENTION`; it never deletes,
restores, overwrites or recreates plaintext. A pre-publication restore also
requires a durable pre-publication journal and an empty canonical destination;
an external destination occupant wins. Post-publication quarantine removal
uses the same exact reacquisition proof. There is no path-only or “probably
ours” recovery state.

## 6. Migration ledger

Future SQLite migration `0012_diary_migration_ledger.sql` proposes exactly the
following tables; no SQL migration is created by this remediation:

```sql
CREATE TABLE diary_migration_runs (
  run_id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  inventory_revision INTEGER NOT NULL,
  reviewed_revision INTEGER,
  state TEXT NOT NULL CHECK (state IN (
    'NOT_STARTED','INVENTORIED','NEEDS_UNLOCK','RUNNING','ATTENTION_REQUIRED',
    'COMPLETE','FAILED'
  )),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE diary_migration_items (
  item_key TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES diary_migration_runs(run_id),
  vault_id TEXT NOT NULL,
  document_id TEXT,
  canonical_path TEXT NOT NULL,
  inventory_revision INTEGER NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  classification TEXT NOT NULL CHECK (classification IN (
    'ALREADY_ENCRYPTED_VALID','LEGACY_PLAINTEXT',
    'ENCRYPTED_MALFORMED','ENCRYPTED_UNKNOWN_VERSION',
    'ENCRYPTED_IDENTITY_MISMATCH','METADATA_MISSING',
    'METADATA_AMBIGUOUS','PRIMARY_MISSING','EXTERNAL_PATH_CONFLICT',
    'MIGRATION_IN_PROGRESS','CLEANUP_PENDING','RECOVERY_AUTH_REQUIRED',
    'DURABILITY_PENDING','CONSENT_REQUIRED','LEGACY_DIARY_AI_HISTORY',
    'FRONTMATTER_IDENTITY_UNRESOLVED','NEEDS_ATTENTION'
  )),
  state TEXT NOT NULL CHECK (state IN (
    'DISCOVERED','NEEDS_UNLOCK','READY','PREPARING',
    'ENCRYPTED_VERIFIED','PUBLISHING','RECOVERY_AUTH_REQUIRED',
    'DURABILITY_PENDING','CONSENT_REQUIRED','PUBLISHED',
    'CLEANUP_PENDING','COMPLETE','NEEDS_ATTENTION'
  )),
  source_generation_json TEXT,
  source_parent_generation_json TEXT,
  quarantine_name TEXT,
  quarantine_generation_json TEXT,
  quarantine_parent_generation_json TEXT,
  quarantine_durability TEXT CHECK (quarantine_durability IN (
    'NOT_STARTED','UNKNOWN','DURABLE','FAILED'
  )),
  target_generation_json TEXT,
  transaction_id TEXT,
  ciphertext_fingerprint TEXT,
  ai_session_id INTEGER,
  ai_message_ids_json TEXT,
  frontmatter_row_cas_json TEXT,
  envelope_version INTEGER,
  attention_code TEXT,
  last_action_scope TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, inventory_revision, item_key)
);

CREATE TABLE diary_migration_consents (
  consent_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES diary_migration_runs(run_id),
  vault_id TEXT NOT NULL,
  inventory_revision INTEGER NOT NULL,
  item_key TEXT NOT NULL,
  action_scope TEXT NOT NULL CHECK (action_scope IN (
    'MIGRATE_PRIMARY','REMOVE_VERIFIED_LEGACY_PRIMARY','CLEAN_PRIVATE_SQLITE',
    'IMPORT_DRAFT','DISCARD_DRAFT','DISCARD_AI_SESSION','RETAIN_AI_HISTORY',
    'BIND_FRONTMATTER_IDENTITY','ACKNOWLEDGE_GIT_RETENTION'
  )),
  reviewed_generation_json TEXT,
  reviewed_item_set_fingerprint TEXT NOT NULL,
  consented_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('GRANTED','INVALIDATED','CONSUMED')),
  FOREIGN KEY (run_id, inventory_revision, item_key)
    REFERENCES diary_migration_items(run_id, inventory_revision, item_key)
);

CREATE INDEX idx_diary_migration_items_run_state
  ON diary_migration_items(run_id, state);
CREATE INDEX idx_diary_migration_items_identity
  ON diary_migration_items(vault_id, document_id, canonical_path, schema_version);
CREATE INDEX idx_diary_migration_consents_scope
  ON diary_migration_consents(run_id, inventory_revision, action_scope, item_key);
```

`item_key` is the literal encoded tuple
`vaultId\u0000documentId\u0000canonicalPath\u00001` for resolved items. A
pre-adoption inventory row uses `UNRESOLVED\u0000canonicalPath\u00001` only to
display an attention item; it cannot enter `PREPARING` and is replaced by the
resolved tuple after `adopt-metadata`. Every item belongs to exactly one
immutable `inventory_revision`; a rescan appends a new revision and marks new
or changed tuples `CONSENT_REQUIRED`.

Generation JSON contains only regular-file type, device/inode or Windows file
ID, available birth/generation provenance, mtime/mtimeNs when available and
directory identity. `source_parent_generation_json`, `quarantine_name`,
`quarantine_generation_json` and `quarantine_parent_generation_json` make the
restart provenance explicit; `quarantine_durability` records whether the
parent-directory barrier is known. The live helper handle token is
process-memory-only and is never serialized. The JSON contains no byte size,
body hash, plaintext digest or content. A ciphertext fingerprint is SHA-256
of the randomized encrypted artifact and is classified as internal non-secret
transaction provenance; it is never returned in a locked response and cannot
authorize mutation alone.
`frontmatter_row_cas_json` contains structural row status/updated-at/nullness
only; any existing source hash used as a CAS is compared transiently inside
the SQLite transaction and is never copied to this ledger. The ledger forbids
password, KEK, DEK, capability, raw body, excerpt, frontmatter, title/summary/
tags, recovery content, message content and body-derived digest/size. Journal
and ledger updates are structural and idempotent.

Each consent is server-created and binds one action scope to the exact vault,
run, immutable inventory revision, item key, reviewed generation and a
server-computed fingerprint of the reviewed item set. For run-scoped
`ACKNOWLEDGE_GIT_RETENTION`, the ledger creates a synthetic `RUN` item key
whose fingerprint covers the complete revision; `RETAIN_AI_HISTORY` remains
bound to each affected session item. The API never accepts a client token as
authorization. Retention acknowledgments are not cleanup permission.

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
   structural fields only while locked. Inventory every SQLite private table,
   including `sessions`, `messages.content` and structured AI tool-result
   envelopes, plus local Git exposure classes read-only.
5. Persist an immutable `inventoryRevision` and structural item snapshots in
   the §6 ledger. Expose only counts/path/date/status and opaque AI IDs while
   locked. Do not persist body length, a body hash or message content to make
   inventory look idempotent.
6. A rescan creates a new revision rather than refreshing an authorized run in
   place. The service compares current generation/row CAS to the reviewed
   snapshot and sets `CONSENT_REQUIRED` for every new or changed primary, IDB
   family, SQLite row, AI session or frontmatter row.

Entry proof: every managed file is one of the exact classifications in the PRD;
every unresolved identity is blocked before encryption; all ordinary Notes are
absent from the ledger.

## 8. Workstream B — primary plaintext migration

Implement the §9 protocol in a dedicated module. The migration temporary name
is `.docus-diary-migrate-ciphertext-<uuid>` and the moved source name is
`.docus-diary-migration-source-<uuid>`. Both are reserved, same-directory,
ownership-checked names. The source name is a moved pre-existing inode, never a
copy; it is removed only after the confirmed post-publication cleanup gate.

`DiaryMigrationFs` is the sole native filesystem owner. Its exact operations
are `captureSourceGeneration`, `transitionOwnedSource`,
`writeCiphertextTemp`, `publishCiphertextCreateOnly`,
`verifyCiphertextArtifact`, `removeOwnedQuarantineGeneration` and
`syncDurability`. `transitionOwnedSource(capturedSourceAuthority,
expectedParentAuthority, reservedQuarantineName)` is one native conditional
namespace mutation: the mutation itself compares the captured source
generation and expected parent generation, requires the quarantine name to be
absent, moves the same existing inode/file object without copying or
overwriting, and returns exact quarantine generation/provenance. A pathname
check followed by rename, hard-link-plus-unlink, copy/delete and overwrite
rename are forbidden. `removeOwnedQuarantineGeneration` applies the same
handle-bound comparison at unlink time.

The platform contracts are fixed, not selectable. Linux resolves parent/source
with `openat2(RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS)` and
`O_PATH|O_NOFOLLOW`, uses `statx`/native file handles for evidence, and
requires the named `D8_DIARY_RENAME_BY_HANDLE` primitive, bound by
`docus_diary_transition_owned_source_linux`, for the conditional
rename-by-handle ABI; `renameat2(RENAME_NOREPLACE)` is only ciphertext
publication and `open_by_handle_at` is only a possible restart reacquisition
after the named exact tuple check. A composed `openat2`/pathname-rename
sequence is not an implementation of the primitive; the named
`D8_DIARY_REACQUIRE_BY_HANDLE` must verify the persisted tuple before returning
a restart token.
macOS resolves parent/source with `openat` and `O_NOFOLLOW`, records vnode
identity, and requires the named `D8_DIARY_RENAME_BY_VNODE` primitive, bound by
`docus_diary_transition_owned_source_macos`, for the vnode-handle conditional
rename; `renameatx_np(RENAME_EXCL)` is only ciphertext publication. The named
`D8_DIARY_REACQUIRE_BY_VNODE` verifies the persisted parent/name/vnode tuple
before returning a restart token. Windows opens
source and parent with reparse-safe `CreateFileW`, omits
`FILE_SHARE_DELETE`, records `FileIdInfo`, and performs the source transition
with `SetFileInformationByHandle(FileRenameInfoEx)` on the captured source
handle, `RootDirectory` set to the captured parent and replace-if-exists
omitted. Publication uses the same API on the ciphertext temp with
fail-if-exists semantics. A platform/filesystem that cannot supply its exact
conditional operation returns `diary-migration-filesystem-unsupported`
(HTTP 503) before mutation; no weaker operation is allowed.

Because the source fd/handle and expected parent authority are consumed by the
same conditional namespace operation, a source replacement between capture and
mutation, a parent replacement, and a quarantine-name race cannot cause an
unowned generation to be moved or removed; the operation returns the frozen
external/occupied/unsupported result instead.

Stable outcomes are `SOURCE_GENERATION_CHANGED`,
`PARENT_GENERATION_CHANGED`, `TARGET_OCCUPIED`, `FILESYSTEM_UNSUPPORTED`,
`CROSS_DEVICE`, `SOURCE_BUSY`, `DURABLE`, `DURABILITY_UNKNOWN` and
`DURABILITY_FAILED`. Linux `ESTALE`/post-compare `ENOENT`, macOS
`ENOENT`/`ESTALE`, and Windows `ERROR_FILE_NOT_FOUND`/
`ERROR_PATH_NOT_FOUND` mean an external generation won. `EEXIST`/
`ENOTEMPTY` or `ERROR_FILE_EXISTS`/`ERROR_ALREADY_EXISTS` mean occupied
destination; `EXDEV`/`ERROR_NOT_SAME_DEVICE` means cross-device;
`EBUSY`/`EAGAIN`/`EWOULDBLOCK` or Windows sharing/lock violations mean
retryable source busy; missing required APIs/flags map to unsupported.
Required file and parent-directory durability failures remain unknown/failed
and never become `PUBLISHED`.

The live fd/handle token is process-memory-only. Before the source mutation,
the journal durably records inventory revision, logical identity, source and
parent generations, reserved name and phase; after the mutation and parent
durability barrier it records the returned quarantine and parent generations.
On restart, only a fresh `D8_DIARY_REACQUIRE_BY_HANDLE`,
`D8_DIARY_REACQUIRE_BY_VNODE` or the Windows handle reopen plus exact
`FileIdInfo` comparison may produce `REACQUIRED_EXACT_QUARANTINE`; otherwise the item is
`QUARANTINE_OWNERSHIP_UNPROVEN`/`NEEDS_ATTENTION` and no delete, restore,
overwrite or plaintext recreation is allowed. A same-name different
generation is external state. Pre-publication restoration requires exact
reacquisition and an empty canonical destination; post-publication cleanup
uses the same proof. Generation records never contain body size, body hash,
plaintext digest, keys, capabilities or message content.

Durability is an ordered set of independent proofs: sync the ciphertext temp
file and its parent before source transition; perform the source namespace
transition and sync its parent before recording quarantine provenance; publish
the ciphertext target with no-replace and sync the target file and target
parent; authenticate readback and write durable `PUBLISHED`; then unlink the
quarantine and sync its parent in a separate cleanup barrier. An unknown or
failed barrier is `DURABILITY_PENDING`/attention and never becomes
`PUBLISHED` or durable quarantine removal. The unlink syscall and directory
barrier therefore remain distinct crash seams.

The source-transition adversarial oracle is explicit (and is identical to the
normative matrix in PRD §9.1e):

| Case | Permitted? | Result/state | Preservation and retry rule |
| --- | --- | --- | --- |
| Source replaced before or at transition | No | `SOURCE_GENERATION_CHANGED`/`EXTERNAL_PATH_CONFLICT` | External generation is never moved or deleted; new revision required |
| Source pathname replaced after capture | No | Native captured-handle compare refuses replacement | No pathname fallback; preserve both generations; attention |
| Source or parent becomes junction/reparse | No | `FILESYSTEM_UNSUPPORTED`/attention | Preserve object/artifacts; repair and rescan |
| Parent directory replaced | No | `PARENT_GENERATION_CHANGED` | Preserve new parent/source; fresh provenance required |
| Quarantine destination exists or is case-fold collision | No | `TARGET_OCCUPIED`/identity conflict | Occupant wins; no overwrite or same-name retry |
| Quarantine name reused after crash | No unless exact reacquired | `QUARANTINE_OWNERSHIP_UNPROVEN` | Different generation/absent name is never deleted or recreated |
| Target appears before publication | No | `TARGET_OCCUPIED`/`EXTERNAL_PATH_CONFLICT` | Preserve target, temp and quarantine; no overwrite |
| Cross-device operation | No | `CROSS_DEVICE`/unsupported | Retain artifacts; never copy/delete |
| Missing no-replace or exact-source primitive | No | `FILESYSTEM_UNSUPPORTED` | No namespace mutation; attention, no weaker fallback |
| Windows sharing/antivirus/open-handle denial | No | `SOURCE_BUSY` or unsupported | Do not force close; retry only with exact generation, then attention |
| Directory durability fails or is unknown | No `PUBLISHED` | `DURABILITY_PENDING`/attention | Retain journal/ciphertext/quarantine; no cleanup or plaintext restore |
| Live token lost by crash | No immediate action | Exact reacquisition attempted | All artifacts retained until native proof |
| Restart cannot reacquire quarantine authority | No | `QUARANTINE_OWNERSHIP_UNPROVEN`/`NEEDS_ATTENTION` | Manual attention; no guessed delete/restore/overwrite |

The same oracle applies to quarantine removal. A successful source transition
does not turn its pathname or matching ledger metadata into delete authority.

The existing body lease performs encryption, decryption and `assertCurrent()`.
Publication records an internal ciphertext SHA-256 fingerprint and target
generation (not byte size). File and directory durability must be `DURABLE`
before `PUBLISHED`; unknown durability is `DURABILITY_PENDING`. If a process
dies after publication may have occurred while locked, recovery uses
`RECOVERY_AUTH_REQUIRED` and waits for unlock/AES-GCM/AAD authentication.

Normal `PUT /api/posts/:path` for the document serializes behind the existing
FIFO `withDocumentWriteLock`; it does not return a migration-specific 409 just
because that lock is held. After acquiring the lock it revalidates current
session/CAS/primary and migration-item state. If the item is
`RECOVERY_AUTH_REQUIRED`, body read/write returns HTTP 423 with code
`diary-migration-auth-required`; otherwise it proceeds or returns the existing
semantic conflict. Only competing migration-control requests may return
`409 diary-migration-in-progress`. A new date at another path continues
through normal D8.2 encrypted create and is classified as a valid-encrypted
no-op.

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

The bridge accepts an `inventoryRevision`, exact family generation and the
server-created `IMPORT_DRAFT` or `DISCARD_DRAFT` consent ID. The server
reconstructs the current IDB family and conditional CAS; a rescan or row
change invalidates the consent and yields `CONSENT_REQUIRED`. A client token,
typed phrase or old `runId` is never sufficient. An item in
`RECOVERY_AUTH_REQUIRED` cannot import until its primary target is
cryptographically reconciled.

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
deleted; it is attention. The same transaction inventories `0001` AI
`sessions`/`messages` and identifies only structured `read_file` results naming
an exact managed path. A provable item is `LEGACY_DIARY_AI_HISTORY` and
defaults to attention; `DISCARD_AI_SESSION` is an explicit whole-session
delete through the existing AI message owner, while `RETAIN_AI_HISTORY` is an
explicit Docus-controlled policy-retained residual. Mixed sessions are never
substring-edited and ordinary AI rows remain unchanged. Every action uses its
own immutable-revision consent. A transaction rollback leaves the encrypted
primary authoritative and the item `CLEANUP_PENDING`.

## 11. Workstream E — `frontmatter_backup`

The service queries `metadata_migrations` by exact path plus a proven non-null
document ID and requires no active rollback journal and a `PUBLISHED` item. A
row with `document_id IS NULL` is `FRONTMATTER_IDENTITY_UNRESOLVED` and remains
attention; `adopt-metadata` does not make it owned by path proximity. A
separately consented `BIND_FRONTMATTER_IDENTITY` transaction may set the ID
only when it selects the exact null row, exact path, status, `updated_at`,
`source_hash`, `frontmatter_backup` and `cleaned_hash` CAS values and proves
the current source generation is that legacy row. Binding never clears the
backup and its CAS values are not copied into public status.

Only after the non-null identity binding, primary `PUBLISHED`, no rollback
dependency and the same row CAS may the transaction clear
`frontmatter_backup`, `source_hash`, `cleaned_hash` and error and set
`status='cleaned'`. An already-cleaned row is a no-op; a mismatched, changed or
shared row remains attention. Generic startup `migrateVaultMetadata` and
ordinary Note `frontmatterArchive` behavior remain unchanged.

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
directory/file ownership and non-secret transaction fingerprint/generation,
but it cannot authenticate AES-GCM while the service is locked. If a target
may have been published, it records `RECOVERY_AUTH_REQUIRED`; a provenance
mismatch is `NEEDS_ATTENTION`. It never logs body bytes, deletes quarantine or
restores plaintext over a possible target. A process-local source/quarantine
token is destroyed by a crash. On restart, recovery may obtain a new token
only through the platform-specific native exact reacquisition proof described
in Workstream B; otherwise it records
`QUARANTINE_OWNERSHIP_UNPROVEN`/`NEEDS_ATTENTION` and performs no delete,
restore, overwrite or plaintext recreation. After unlock, the existing
`DiaryBodyOperation` revalidates exact target identity and authenticates the V1
envelope with vault/document/path AAD before writing `PUBLISHED` or starting
cleanup. Generic `.docus-staged-*` and `.docus-delete-inflight-*` remain owned
by existing recovery and are not repurposed for Diary migration. The locked
matrix is exact: (A) target absent plus pre-publication journal plus
`REACQUIRED_EXACT_QUARANTINE` permits token-bound source restoration only;
otherwise attention; (B) target exists and publication may have happened
preserves target/quarantine and records `RECOVERY_AUTH_REQUIRED` when
fingerprint matches, never plaintext restore or cleanup; (C)
generation/provenance mismatch preserves the external target and records
`NEEDS_ATTENTION`.

## 14. Workstream H — migration UX/API

### 14.1 Exact API surface

All endpoints require the existing authenticated application session and set
`Cache-Control: no-store`. Responses contain structural state only.

| Method/path | Request | Success | Auth/unlock | Side effect / idempotency |
| --- | --- | --- | --- | --- |
| `GET /api/diary/migration/status` | none | `200` run state, `inventoryRevision`, counts, safe item path/date/id/classification/state and opaque AI IDs | Login; locked allowed | Read-only; no body length, fingerprint, generation detail or message content. |
| `POST /api/diary/migration/scan` | `{}` | `202` `{runId,inventoryRevision,state,counts}` | Login; locked allowed | Creates an immutable revision; a rescan never refreshes consent in place. New/changed rows become `CONSENT_REQUIRED`. |
| `POST /api/diary/migration/start` | `{runId,inventoryRevision,requestedScopes:[{itemKey,scope}]}` | `202` `{runId,inventoryRevision,state}` | Login; body work additionally requires an unlocked Diary lease | Server reconstructs the revision/generations and creates action-scoped consent records; a concurrent migration-control request returns `409 diary-migration-in-progress`, a completed run returns `409 diary-migration-already-complete`. |
| `POST /api/diary/migration/resume` | `{runId,inventoryRevision}` | `202` `{runId,inventoryRevision,state}` | Login; `RECOVERY_AUTH_REQUIRED`/body work requires unlock | Resumes only the same reviewed revision and persisted scopes; a newer revision requires new consent; safe to repeat. |
| `POST /api/diary/migration/items/:itemKey/resolve` | `{inventoryRevision,action:'adopt-metadata'|'import-to-primary'|'discard-draft'|'discard-ai-session'|'retain-ai-history'|'bind-frontmatter-identity'|'retry-item'|'acknowledge-attention',confirmation?:'DISCARD LEGACY DIARY RECOVERY'}` | `202` item state/category | Body/AI actions and binding require unlock; retry/ack require login | Actions map exactly to `IMPORT_DRAFT`, `DISCARD_DRAFT`, `DISCARD_AI_SESSION`, `RETAIN_AI_HISTORY` and `BIND_FRONTMATTER_IDENTITY`; server reconstructs item/scope; changed identity/family/session/row remains `CONSENT_REQUIRED` or attention. |

There is no Git rewrite endpoint. Git retention is the only supported policy.
AI retention is a separate explicit Docus-controlled policy action; it is not
grouped with external residuals. No endpoint returns a body or AI message
content for diagnostics or export.

### 14.2 Stable errors/statuses

| HTTP | Code | Meaning |
| ---: | --- | --- |
| 400 | `diary-migration-invalid-confirmation` | Request fields or typed discard confirmation are not exact. |
| 401 | existing auth error | Application login is absent/expired. |
| 404 | `diary-migration-run-not-found` | Run/item key is not present in this vault. |
| 409 | `diary-migration-already-complete` | Start requested for a completed run. |
| 409 | `diary-migration-in-progress` | Another migration-control request owns the same run/vault; ordinary document saves do not use this code merely because the FIFO document lock is held. |
| 409 | `diary-migration-identity-missing` | Required identity/adoption action is outstanding. |
| 409 | `diary-migration-identity-ambiguous` | More than one identity/generation can claim the path. |
| 409 | `diary-migration-external-mutation` | Generation/path changed or external writer won. |
| 409 | `diary-migration-consent-required` | Item or generation is new/changed since the reviewed inventory revision or has no action-scoped consent. |
| 409 | `diary-migration-cleanup-pending` | Encrypted publication succeeded; auxiliary cleanup remains. |
| 409 | `diary-migration-durability-pending` | Publication/directory durability cannot yet be proven; item is not `PUBLISHED`. |
| 409 | `diary-migration-source-busy` | A required handle-bound source transition cannot proceed because an open/shared handle owns the generation. |
| 409 | `diary-migration-cross-device` | The required same-filesystem no-copy operation cannot be performed. |
| 409 | `diary-migration-quarantine-ownership-unproven` | Restart cannot reacquire the exact quarantine generation and parent; no delete, restore or overwrite is permitted. |
| 409 | `diary-migration-draft-decision-required` | Legacy Draft/Recovery action is not chosen. |
| 409 | `diary-migration-git-decision-required` | Retention acknowledgment is absent. |
| 409 | `diary-migration-attention-required` | Run has unresolved attention items. |
| 200 (item) | `diary-migration-legacy-plaintext` | Item classification returned in safe status/item data, not as an implicit mutation error. |
| 422 | `diary-migration-malformed-envelope` | Magic-present envelope is malformed/auth-invalid. |
| 422 | `diary-migration-unknown-envelope` | Envelope version is unsupported. |
| 422 | `diary-migration-identity-mismatch` | AAD vault/document/path does not match. |
| 423 | `diary-migration-locked` | Operation requires current Diary body access for an item not yet in deferred recovery. |
| 423 | `diary-migration-auth-required` | Item is `RECOVERY_AUTH_REQUIRED`; structural status is readable, but body read/save/create, resume, cleanup, Draft import and AI disposition wait for post-unlock fingerprint/generation/AES-GCM/AAD reconciliation. |
| 503 | `diary-migration-filesystem-unsupported` | Linux/macOS/Windows adapter cannot provide the exact handle-bound no-copy, create-only or durability semantics; all unproven artifacts are retained. |
| 503 | `diary-migration-unavailable` | Migration owner/ledger/recovery dependency is unavailable. |

Error bodies contain only `code`, a generic safe message, and bounded
structural details. Client-only invalidation and stale epoch results do not
become HTTP conflicts.

## 15. Workstream I — diagnostics/artifacts

Use a structured redacted logger. Canary tests must search every migration
temp, journal, quarantine, SQLite table (including AI `sessions/messages`),
IndexedDB migration response, new Git commit, server output, browser console,
trace, screenshot, video and test attachment for fresh values
`D8_4_PRIMARY_<random>`, `D8_4_DRAFT_<random>`,
`D8_4_FRONTMATTER_<random>`, and `D8_4_METADATA_<random>`.

The canary harness records whether a matching legacy source existed before the
run. A match in a newly created durable artifact is failure even if the final
primary is encrypted. Body/message values, byte length, body/AI digests,
passwords, keys, capabilities, provider payloads and raw exceptions are
forbidden in logs/artifacts. The internal ciphertext fingerprint is permitted
only in the migration ledger/proof and is not exposed to locked clients.

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
| Malformed/unknown/auth/AAD/vault mismatch | Stable 422/classification, no overwrite or plaintext interpretation. |
| Missing/stale/ambiguous metadata | No encryption until adoption; wrong identity remains attention. |
| External save/replace/path reuse at each race | External generation wins; no clobber/delete; artifact quarantine is structural. |
| Lock/logout/expiry/capability replacement | Pre-publish operation aborts/fences; post-publish resumes forward. |
| Locked restart after `AFTER_CIPHERTEXT_PUBLISH_SYSCALL` or `AFTER_TARGET_DURABILITY` | `RECOVERY_AUTH_REQUIRED` when fingerprint/generation matches; no plaintext restore/cleanup; unlock + exact AES-GCM/AAD succeeds to `PUBLISHED`, forged/replaced target to attention. |
| Server restart at each exact hook enum | The deterministic oracle in §19 records filesystem/journal/SQLite/IDB state and allowed next state; no timing-based kill. |

### 17.2 No-new-plaintext proof

At each exact hook enum listed in §19, inspect temp/staging/journal/rollback/
recovery/quarantine, SQLite ledger and `sessions/messages`, new Git commits,
logs and test artifacts. Assert no fresh body canary, byte-size value,
plaintext digest or AI message content appears. Assert valid old legacy source
is distinguished from a new copy and the ledger has no forbidden field/value.

### 17.3 Consent, AI and frontmatter

- Confirm revision R1, then introduce primary/IDB/SQLite/AI/frontmatter row B;
  a rescan produces R2 and B remains `CONSENT_REQUIRED`.
- Change a reviewed generation G1 to G2, replay the old run/action, and prove
  removal/cleanup/import/discard is rejected; typed discard does not override
  the revision check.
- Inventory `sessions/messages` fixtures for structured managed-Diary
  `read_file`, ordinary AI, mixed Note+Diary, locked hiding, explicit
  whole-session discard, retention acknowledgment, crash/retry/idempotency and
  no message-content ledger/log copy.
- Exercise `metadata_migrations.document_id IS NULL`: no proof retains
  `FRONTMATTER_IDENTITY_UNRESOLVED`; path reuse cannot bind/clear; verified
  generation binds identity only; binding/cleanup crashes and CAS changes
  retain the row; Note rows at the same path are untouched.

### 17.4 Draft/SQLite/Git

- Locked legacy IDB row is not rendered; unlock discovers valid identity;
  import, typed discard, ambiguous identity, crash during deletion and retry
  all preserve user edits; ordinary Note Draft Store is unchanged.
- Managed SQLite private rows clean transactionally; Note rows, stable ID and
  Mood remain; `frontmatter_backup` cleanup is idempotent; crash rolls back.
- Git inventory covers branches/tags/remotes/stash/reflogs/reachable and
  unreachable objects; no local rewrite/remote force-push; ordinary Note Git
  history is unchanged; rerun is read-only.

### 17.5 Locking and ownership

- A migration-held document lock makes ordinary managed PUT queue; after the
  lock is released it revalidates current session/CAS/primary and either saves
  or returns the existing semantic conflict. No migration-specific 409 is
  emitted merely for lock wait.
- Two migration-control starts have deterministic ownership conflict; logout/
  expiry while queued cannot publish a stale result; vault/structure/document
  lock ordering has no deadlock.

### 17.6 Path/platform/scale

Test valid and invalid spellings (`diary/2026-08-31`, `.md`, absolute,
duplicate separators, dot segments, nested/wrong-case/wrong-extension),
symlinked file/directory, directory replacement, cross-device temp refusal,
many dates, large bounded bodies, many IDB rows and large Git histories.

## 18. Cross-platform validation

Run Linux, macOS and Windows jobs against the same `DiaryMigrationFs` contract.
Verify the declared native adapter's captured-handle conditional source
transition, create-only publication, junction/reparse rejection,
open-handle/antivirus behavior, case-folded path identity, cross-device
refusal and file/directory durability. Linux and macOS require directory
`fsync`; Windows requires the declared directory-handle flush. A pathname
check/use pair is not a source proof. If any required conditional mutation,
reacquisition primitive or durability proof is unavailable, return
`diary-migration-filesystem-unsupported` or
`diary-migration-durability-pending`, retain the journal/artifacts and do not
advance to `PUBLISHED`; no timing retry, copy/delete or overwrite operation is
permitted.

## 19. Failure/rollback matrix and deterministic hook oracle

The only automatic rollback is pre-publication restoration of the same
pre-existing inode through a live or exact restart-reacquired
`DiaryMigrationFs` token. Once the ciphertext publication syscall may have
succeeded, no recovery path writes plaintext to the canonical path. The
authoritative hook set contains exactly **19 named seams**, identical to the
PRD §15 list. Every hook is a deterministic fault-injection seam, not a sleep
or timing window:

| Hook | Filesystem state | Journal / SQLite ledger | IDB state | Locked restart / authoritative generation | Allowed recovery / forbidden action / next state |
| --- | --- | --- | --- | --- | --- |
| `AFTER_JOURNAL_PREPARED` | Source canonical; no ciphertext publication | PREPARING journal/item | unchanged | locked; source authoritative | Retry after consent/unlock; no cleanup; `PREPARING` |
| `AFTER_CIPHERTEXT_TEMP_FSYNC` | Source canonical; ciphertext temp durable | ENCRYPTED_VERIFIED journal | unchanged | locked; source authoritative | Re-probe source; token-only temp removal; `ENCRYPTED_VERIFIED` |
| `BEFORE_SOURCE_TRANSITION` | Source canonical; target absent | pre-publication | unchanged | locked; source authoritative | Retry or attention; no move/publish; `READY`/`NEEDS_ATTENTION` |
| `AFTER_SOURCE_TRANSITION` | Exact source inode at quarantine; target absent | PUBLISHING | unchanged | locked; quarantine authoritative pre-publication | Token-bound restore only if target empty; no pathname delete; `PUBLISHING` |
| `BEFORE_CIPHERTEXT_PUBLISH` | Quarantine source; ciphertext temp durable; target absent | PUBLISHING | unchanged | locked; quarantine authoritative until syscall | Publish create-only or fail closed; no overwrite; `PUBLISHING` |
| `AFTER_CIPHERTEXT_PUBLISH_SYSCALL` | Target may exist; quarantine may exist | PUBLISHING; fingerprint recorded | unchanged | locked; target may be authoritative | Never restore plaintext; defer auth; `RECOVERY_AUTH_REQUIRED` or attention |
| `AFTER_TARGET_DURABILITY` | Target durable; quarantine may exist | provenance recorded, not PUBLISHED | unchanged | locked; target may be authoritative | Unlock auth only; no cleanup; `RECOVERY_AUTH_REQUIRED` |
| `AFTER_AUTHENTICATED_READBACK` | Exact target authenticated; quarantine may exist | proof recorded; journal not PUBLISHED | unchanged | locked; target authoritative; ledger pending | Resume journal only with current lease; PUBLISHED pending |
| `BEFORE_PUBLISHED_JOURNAL` | Authenticated target; quarantine may exist | journal write not started | unchanged | locked; target authoritative | Write only after durability proof; no plaintext restore; PUBLISHED pending |
| `AFTER_PUBLISHED_JOURNAL` | Authenticated target; quarantine may exist | durable PUBLISHED | unchanged | locked; target authoritative | Cleanup forward only; `PUBLISHED`/`CLEANUP_PENDING` |
| `BEFORE_SQLITE_CLEANUP_COMMIT` | Authenticated target; quarantine may exist | `PUBLISHED`; SQLite transaction open and not committed (including a whole-session AI disposition) | unchanged | locked; target authoritative | Kill rolls back the transaction; no target overwrite; `CLEANUP_PENDING` |
| `AFTER_SQLITE_CLEANUP_COMMIT` | Authenticated target; quarantine may exist | SQLite transaction committed; migration ledger may still lag (including committed whole-session AI disposition) | unchanged | locked; target authoritative | Reconcile exact rows idempotently; never recreate/delete a replacement; `CLEANUP_PENDING` |
| `BEFORE_IDB_DISPOSITION_COMMIT` | Authenticated target; quarantine may exist | PUBLISHED/cleanup pending | exact rows unchanged; IDB transaction open | locked; target authoritative | Abort/rollback IDB; changed rows need consent; `CLEANUP_PENDING` |
| `AFTER_IDB_DISPOSITION_COMMIT` | Authenticated target; quarantine may exist | ledger pending auxiliary completion | confirmed rows deleted or retained | locked; target authoritative | Re-read idempotently; no second destructive action; `CLEANUP_PENDING` |
| `BEFORE_SOURCE_QUARANTINE_UNLINK` | Authenticated target; exact owned quarantine exists | cleanup pending; unlink not invoked | confirmed dispositions durable | locked; target authoritative; exact quarantine authority required | Unlink only through native exact-generation operation; otherwise attention; `CLEANUP_PENDING` |
| `AFTER_SOURCE_QUARANTINE_UNLINK_BEFORE_DIR_DURABILITY` | Authenticated target; unlink syscall returned; parent-directory durability barrier not completed | cleanup pending; `quarantine_unlink=COMPLETED`, `quarantine_dir_durability=UNKNOWN` | confirmed dispositions durable | locked; target authoritative; namespace may be durable or uncertain | On restart inspect actual namespace; never recreate plaintext or delete a replacement; `DURABILITY_PENDING`/`CLEANUP_PENDING` |
| `AFTER_SOURCE_QUARANTINE_DIR_DURABILITY` | Authenticated target; unlink returned and parent-directory durability barrier completed | cleanup pending; `quarantine_removal_durable=COMMITTED` | confirmed dispositions durable | locked; target authoritative; owned quarantine is durably absent | Forward-only verification; never require/recreate quarantine; `CLEANUP_PENDING`/`COMPLETE` |
| `BEFORE_ITEM_COMPLETE` | Authenticated target; no owned plaintext quarantine | all required cleanup durable | dispositions durable | locked; target authoritative | Revalidate consent/provenance; no guess; `CLEANUP_PENDING` |
| `AFTER_ITEM_COMPLETE` | Authenticated target; no owned plaintext artifact | item COMPLETE durable | dispositions durable | locked; target authoritative | Idempotent no-op; aggregate requires all scopes/residuals |

For `BEFORE_SOURCE_QUARANTINE_UNLINK`, the quarantine entry must still exist
and the native exact-generation unlink is the only next operation. For
`AFTER_SOURCE_QUARANTINE_UNLINK_BEFORE_DIR_DURABILITY`, an unlink syscall has
returned but the parent barrier has not; restart inspects the actual namespace,
never recreates plaintext, fsyncs the parent if the name is absent, and retries
only an exact-reacquired generation if the name remains. A different
generation is preserved as external state. For
`AFTER_SOURCE_QUARANTINE_DIR_DURABILITY`, absence is durably committed and
forward cleanup never requires the plaintext quarantine.

`DISCARD_AI_SESSION` maps to the two SQLite hooks with
`operationClass=DISCARD_AI_SESSION`. At the before-commit seam the exact
session row and every inventoried message row still exist, the transaction
rolls back on kill, the item remains `CLEANUP_PENDING`, and the same consent
is usable only if its inventory revision, session row generation and message
ID set still match. At the after-commit seam the session and all inventoried
messages are absent while the migration ledger may lag; restart records the
already-completed whole-session disposition idempotently and never recreates
data. A replacement/new row with the same numeric ID is a changed generation,
requires new consent and is never deleted by the old action. `RETAIN_AI_HISTORY`
has no destructive hook and remains an explicit policy-retained state.

On an unlocked restart, every hook first revalidates the current epoch,
inventory consent and exact native generations. The pre-publication hooks
(`AFTER_JOURNAL_PREPARED`, `AFTER_CIPHERTEXT_TEMP_FSYNC`,
`BEFORE_SOURCE_TRANSITION`, `AFTER_SOURCE_TRANSITION`,
`BEFORE_CIPHERTEXT_PUBLISH`) may retry only their recorded phase with the
exact source/parent/quarantine proof. The publication hooks
(`AFTER_CIPHERTEXT_PUBLISH_SYSCALL`, `AFTER_TARGET_DURABILITY`,
`AFTER_AUTHENTICATED_READBACK`, `BEFORE_PUBLISHED_JOURNAL`) must authenticate
the exact target before writing `PUBLISHED`; failure remains attention and
never restores plaintext. The post-publication SQLite, IDB and quarantine
hooks continue only the exact pending action after scope/generation checks;
the unlink-before-directory-durability hook inspects namespace rather than
recreating it, and `AFTER_ITEM_COMPLETE` is an idempotent no-op. This is the
unlocked counterpart of every locked-restart row above.

The harness launches a child Docus server against an isolated temporary vault,
signals the parent exactly when a selected enum seam is reached, terminates
the child without graceful cleanup, then starts a fresh process against the
same state. Browser/IndexedDB seams separately instrument the actual IDB
transaction for server-save-response loss, before commit, after commit and a
changed row before retry. No `sleep`, `waitForTimeout`, random kill delay or
retry timing is accepted as crash evidence.

## 20. CI gate

The D8.4 implementation gate requires all of:

1. all migratable plaintext primaries are `COMPLETE` or explicit
   `NEEDS_ATTENTION` with user-visible code;
2. no newly created durable plaintext migration artifact;
3. valid encrypted files are byte-preserving no-ops;
4. malformed/unknown/AAD-invalid envelopes fail closed;
5. locked publication uncertainty enters `RECOVERY_AUTH_REQUIRED`, unlock
   proves exact ciphertext fingerprint/generation/AES-GCM/AAD, and no plaintext
   restore/cleanup occurs before authentication;
6. `DiaryMigrationFs` proves the same captured-handle conditional, no-copy,
   create-only and durability semantics on Linux/macOS/Windows, with
   unsupported outcomes fail-closed and restart exact-reacquisition or
   `QUARANTINE_OWNERSHIP_UNPROVEN`;
7. every destructive action is bound to immutable `inventoryRevision`, exact
   item/generation and action scope; a new/changed row cannot inherit consent;
8. legacy Draft/Recovery, SQLite private metadata, AI `sessions/messages` and
   `frontmatter_backup` follow the frozen action and preserve Note rows;
9. Git policy is applied as read-only disclosure and retention is acknowledged;
10. crash/restart and rerun idempotency proofs pass for every exact 19-hook
    enum, including unlink-before-directory-durability and the mapped
    whole-session AI disposition;
11. ordinary Note read/write/history/search/Draft behavior passes regression;
12. Linux/macOS/Windows cross-platform tests pass;
13. typecheck, build, full unit/integration, History, Recovery, browser E2E,
    Draft Store browser E2E, auth, tags-scale, visual and Docker smoke are
    green, plus all D8.4 suites;
14. docs, inventory, evidence, canary output and residual-risk disclosure are
    complete; and
15. implementation Independent Review passes (or its remediation/re-review
    chain is complete) before closure.

## 21. Evidence requirements

The future implementation evidence must record: starting HEAD and planning
approval commit; implementation commits; immutable inventory revisions and
action-scoped consents; per-store inventory including AI sessions/messages;
every state transition including `RECOVERY_AUTH_REQUIRED`,
`DURABILITY_PENDING`, `CONSENT_REQUIRED` and
`QUARANTINE_OWNERSHIP_UNPROVEN`; ciphertext fingerprint/generation proof
without body size; no-new-plaintext canary proof; the exact 19-hook oracle
crash/restart and idempotency proof, including quarantine unlink versus
directory durability and the mapped AI whole-session disposition;
Draft/Recovery disposition;
SQLite/`frontmatter_backup` cleanup and null-ID binding; AI whole-session
disposition; Git policy proof; ordinary Note regression; cross-platform
counts; exact-head CI run; residual-risk categories; Independent Review
verdict; remediation/re-review if any; and final docs-only closure lineage.

## 22. Review/closure lifecycle

After this Round-2 planning-remediation commit, stop. The historical
Independent Planning Review remains `CHANGES REQUIRED (0/5/3)` and the first
Independent Planning Re-review remains `CHANGES REQUIRED (0/1/1)`; the next
action is D8.4 Independent Planning Re-review Round 2. That reviewer must
verify the actual source owners, all 23 frozen decisions, the deferred-auth
recovery, the exact captured-generation `DiaryMigrationFs` contract and
restart reacquisition, immutable consent scopes, AI/frontmatter disposition,
no-body-size ledger, exact API/error contracts, the 19-hook deterministic
crash oracle, Note non-regression and release gate. Only a separate approval
may authorize implementation.

After implementation, create implementation evidence and request a separate
Independent Review. Address findings in separate remediation commits, obtain
re-review, and then create a docs-only closure record. The closure record must
state `D8.4 = REVIEW-CLOSED` only after all required gates and review lineage
are complete; it must then update the canonical D8 lifecycle to overall
`D8 Diary Encryption = REVIEW-CLOSED`.
