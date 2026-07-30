# Vault Git History — Implementation Record

## 1. Record Status

```text
Record type: Retrospective implementation record
Observed on production-code review baseline:
  00b17359d151bbdbe56115ed992700ecbb5e1ca1
Source: tangxiangxiang/docus
Branch reviewed: main
Consolidated: 2026-07-31
Closure: DRAFT — CLOSURE IN PROGRESS
```

This document records only behavior observed in production and test
source at the baseline above. `git diff` confirms that later
documentation commits through the consolidation starting point did
not change the reviewed History production or test files.

Future behavior lives in the
[Plan](superpowers/plans/2026-07-30-vault-git-history-implementation-plan.md)
and is explicitly **not implemented on the reviewed production
baseline**. Closure evidence lives in
[Draft Closure](vault-git-history-final-closure.md).

No test, typecheck, build, CI, or platform result is inferred from
source presence.

## 2. Architecture Overview

**Observed on production-code review baseline**

```text
Vue History UI/composables
        │
        ▼
src/lib/history-api.ts
        │  /api/history/*
        ▼
server/history/routes.ts
        ├── validation.ts
        ├── repo.ts
        ├── diff.ts
        └── git.ts
              ├── spawn('git', args)
              ├── process-local withRepoMutation
              ├── Temporary Commit Index
              ├── Real-Index sync / Repair
              └── Restore / Withdraw
```

The server uses Git CLI argument arrays without a shell. Create builds
commits through a Temporary Index. Repair and Withdraw synchronization
have hand-taken Index-lock helpers. Client path mutation barriers are
separate from the server mutex.

## 3. Module Responsibilities

| File | Observed responsibility |
|---|---|
| `server/history/git.ts` | Git spawn wrapper, status/log parsers, commit plumbing, process-local mutation queue, repository-operation checks, Repair store, Index synchronization, Withdraw, Restore. |
| `server/history/routes.ts` | 12 History endpoints, request validation, HTTP error mapping, capability cache, Working Tree hashes and Restore post-route stat. |
| `server/history/repo.ts` | first-touch dotfiles, nested-repository warning, `git init`, `core.autocrlf=false`. |
| `server/history/validation.ts` | logical History path/ref/SHA syntax only. |
| `src/lib/history-api.ts` | client-side wire interfaces and fetch wrappers; the server does not import this file despite the stale top comment. |
| `useHistoryCommit.ts` | composer, save/mutation barriers, Create request, post-commit refreshes, Repair client state. |
| `useHistoryWithdraw.ts` | confirmation, Vault-wide mutation barrier, Withdraw request, result reconciliation. |
| `useHistoryRestore.ts` | confirmation snapshot, save barrier, Restore request, editor/file-change reconciliation. |
| `useHistoryTimeline.ts` | document/revision projection and date buckets. |

## 4. HTTP API Inventory

**Observed on production-code review baseline**

| Method | Path | Success shape | Important observed behavior |
|---|---|---|---|
| GET | `/capability` | `{ gitAvailable, repoInitialized, initError? }` | may initialize the repository |
| GET | `/status` | `{ dirty, available }` | server uses graceful 503 for missing Git |
| POST | `/content-hashes` | `{ hashes }` | direct `fs.readFile`, follows symlinks |
| GET | `/log` | `{ commits }` | custom textual record separator |
| GET | `/file` | `{ path, ref, content }` | WORKTREE is a direct filesystem read |
| GET | `/diff` | `{ path, oldRef, newRef, diff }` | WORKTREE side is a direct filesystem read |
| POST | `/commits` | `{ sha, filesCommitted, indexRefreshFailed?, indexRepair?, repairStatePersistenceFailed? }` | exact-byte Create and auxiliary Index sync |
| GET | `/repair-status` | `{ transactions }` | read can trigger migration or quarantine write |
| POST | `/repair-index` | `{ repaired, repairStatePersistenceFailed? }` | hand-taken Index lock |
| POST | `/repair-index/discard` | `{ discarded }` | Repair metadata only |
| POST | `/drop` | `{ sha, droppedSha, filesChanged, indexRefreshFailed, indexRepair?, repairStatePersistenceFailed }` | any current HEAD is eligible; no marker |
| POST | `/restore` | `{ path, ref, raw, mtime }` | pre-read outside server transaction; later stat |

`ensureRepo` is called by each route. Its missing-file helper uses
`fs.access` followed by `fs.writeFile`, which has a non-overwrite
TOCTOU (`H-C13`).

## 5. Git Command and Parser Facts

**Observed on production-code review baseline**

- `run()` uses `spawn('git', args, { cwd, windowsHide: true })`.
- Status uses `git status --porcelain --untracked-files=all`.
- Log uses a custom
  `\x1e__DOCUS_LOG__\x1e` record separator and NUL header fields.
- `parseLog` splits on that textual separator. A commit message may
  contain it because message validation checks only non-empty text.
- The `log()` JSDoc says `--follow`; the implementation deliberately
  does not pass `--follow`.
- Create uses `read-tree`, `hash-object`, `update-index`, `write-tree`,
  `commit-tree`, `update-ref`, `show`, and Real-Index `reset`.
- Restore uses `git restore --source=<ref> --worktree`.
- Withdraw uses `show`, `rev-parse <sha>^`, CAS `update-ref`, and
  Temporary-Index synchronization.
- `git.ts` top commentary says the wrapper needs five commands; the
  current module invokes substantially more.

## 6. Create Version Sequence

**Observed on production-code review baseline**

Client:

```text
acquire path mutation barrier
→ saveSelected
→ POST /content-hashes
→ POST /commits
→ release save barrier
→ Promise.all(refreshStatus, refreshLog)
→ refreshComparisons
→ clear selection/message and update completion
→ refreshIndexRepairStatus
```

Server:

```text
validate request
→ ensureRepo
→ withRepoMutation
→ assertRepositoryIdle
→ ensureIndexRepairStorageReady
→ re-read Status
→ reject stale selection
→ captureExpectedFiles
→ ensure author identity
→ resolve old HEAD
→ build Temporary Commit Index from old HEAD
→ stage captured bytes and verify
→ write tree
→ reject unchanged tree
→ create commit object
→ assertRepositoryIdle
→ CAS update-ref HEAD
→ show immutable commit files
→ routine Real-Index sync
→ settle or record Repair metadata
→ return success/degradation shape
```

Factual boundaries:

- Status is re-read before `captureExpectedFiles`.
- `ensureIndexRepairStorageReady` failure aborts before commit-object
  creation and before HEAD update.
- immutable `show` runs after the HEAD CAS and before Real-Index sync.
- Create routine sync calls
  `git reset -q <targetHead> -- <paths>` up to three times.
- F0 and F1 do not exist in the current Create flow.
- when routine sync fails, `recordIndexRepair` captures the Real Index
  after that failure.
- the Repair-record creation helper does not acquire the Git Index
  lock.
- the client does not use `Promise.allSettled` for
  `refreshComparisons`; it awaits `Promise.all(refreshStatus,
  refreshLog)` and then awaits `refreshComparisons`.
- any of those refresh rejections enters `submit()`'s overall catch,
  can show `commit_failed`, and can prevent composer cleanup
  (`H-C2`).

## 7. Real-Index Synchronization and Repair

### 7.1 Routine Create sync

**Observed on production-code review baseline**

`syncIndexPaths`:

1. checks repository-operation state;
2. verifies HEAD;
3. runs `git reset -q <fixedHead> -- <paths>` against the Real Index;
4. verifies HEAD and `diff --cached --quiet`;
5. retries up to three times.

This can overwrite target-path staged intent that existed before the
Create operation or arrived between attempts (`H-C3`).

Withdraw uses a Temporary Index under a hand-taken lock, so it avoids
the concurrent unlocked retry window, but it still resets every
affected target path after HEAD moves. A target path staged before
Withdraw can therefore be replaced because no old-HEAD/F0
classification exists.

### 7.2 Repair metadata

**Observed on production-code review baseline**

Path: `<git-dir>/docus/index-repair.json`.

Schema version 2 stores transaction token, status, HEAD, paths, and
per-path Index fingerprints. Version 1 is migrated. Invalid data is
renamed to a corrupt quarantine file.

Publication properties are separate:

| Property | Observed state |
|---|---|
| atomic rename publication for non-empty state | observed |
| process-restart persistence | observed |
| full crash/power-loss durability | not established |
| cross-process lost-update protection | not implemented |

`writeIndexRepairFile` uses a temp file and rename but does not fsync
the file or parent directory. Empty state removes the final file.
`recordIndexRepair`, settle, discard, migration, and quarantine do not
share a cross-process metadata lock. `GET /repair-status` can trigger
migration or quarantine writes.

### 7.3 Current hand-taken Index-lock lifecycles

**Observed on production-code review baseline**

Both `repairIndexWithLock` and `syncDroppedIndexPaths` publish in this
order:

```text
write replacement bytes to .git/index.lock
→ fsync lock handle
→ close lock handle
→ rename .git/index.lock to .git/index
```

If rename has not committed, `finally` closes any open handle, removes
`.git/index.lock`, and removes the Temporary Index directory. The
reviewed source therefore does not have an open-handle rename defect
in either helper.

Repair fingerprints are checked before and after Temporary-Index
work. A mismatch can supersede a Repair. Only `EEXIST` is normalized
as Index-lock contention.

## 8. Withdraw Sequence

**Observed on production-code review baseline**

```text
client confirmation
→ acquire Vault-wide mutation barrier
→ POST /drop with 7–40 hex request
→ withRepoMutation
→ assertRepositoryIdle
→ Repair storage preflight
→ readCurrentHead
→ compare full HEAD string directly with request
→ show changed files; keep every .md suffix
→ rev-parse <sha>^
→ non-zero parent result becomes parent = null
→ assertRepositoryIdle
→ CAS update-ref HEAD or update-ref -d HEAD
→ syncDroppedIndexPaths
→ settle or record Repair
→ client register/settle Repair
→ closeDroppedRevision
→ Promise.allSettled(Status, Log, Comparison)
→ refreshIndexRepairStatus
→ local completion and toast
```

Current gaps:

- a short request cannot equal full HEAD (`H-C6`);
- no canonical same-vault marker is generated or checked (`H-C4`);
- changed paths do not pass full Managed History Path validation;
- every non-zero `rev-parse <sha>^` result is treated as root;
- `readCurrentHead` maps every non-zero result to `null`;
- merge, malformed output, and operational failures are not
  distinguished (`H-C11`);
- all non-operation 409 errors become latest-changed in the client;
- the three principal refreshes are settled, but remaining success
  callbacks have no dedicated regression isolation (`H-C2`).

Working Tree bytes are not changed by Withdraw.

## 9. Restore Sequence

**Observed on production-code review baseline**

```text
validate logical path/ref
→ ensureRepo
→ rawAt(requestedRef, path) outside withRepoMutation
→ restoreFile
   → withRepoMutation
   → git restore --source=<requestedRef> --worktree
→ fs.stat(path)
→ return pre-read raw + post-command mtime
```

The route does not resolve the accepted ref once to a full immutable
SHA. `raw` and `mtime` are not established as one post-restore file
snapshot. Filesystem operations can follow a symlink (`H-C10`).

The client writes `request.historicalRaw`, rather than `result.raw`,
to `tab.raw`, `tab.originalRaw`, and the file-change event. It does
preserve a newer editor revision and uses `Promise.allSettled` for
the two later refreshes.

## 10. Client State Lifecycles

**Observed on production-code review baseline**

- `useHistory` is scoped per `VaultContext` on the client.
- `pathMutationLock` has path and Vault-wide acquisition.
- Create uses a path lock and save barrier.
- Restore captures gesture-time confirmation input and uses a path
  lock and save barrier.
- Withdraw uses a Vault-wide lock.
- Repair transactions are mirrored in `useHistoryCommit`.
- server serialization is process-local and keyed by
  `path.resolve(repoRoot)`.
- `getStatus` recovers every non-2xx JSON body when called with
  `allowNonOkJson: true`, not only the intended graceful 503
  (`H-C1`).

## 11. Timeline and UI Behavior

**Observed on production-code review baseline**

- global Log projects commits to documents and revisions;
- per-document Log refresh is request-id guarded;
- grouping uses local midnight plus fixed `86_400_000` ms division,
  so DST boundaries are wrong (`H-C7`);
- no Log/Timeline pagination exists (`H-K10`);
- rename history is not `--follow`-merged (`H-K8`);
- snapshot/comparison panes are read-only;
- History context-menu and keyboard affordances exist.

## 12. Test Evidence Map

This is source inventory, not a claim that tests were run during this
documentation consolidation.

### 12.1 Existing test-source evidence

| Area | Existing source evidence |
|---|---|
| Create exact bytes / CAS / selection | `server/__tests__/history-git.test.ts`, `history-routes.test.ts` |
| Repair persistence / migration / quarantine | `history-git.test.ts`, `history-routes.test.ts` |
| Index lock during Repair | `holds index.lock across validation and atomic replacement` |
| Withdraw Worktree/unrelated Index preservation | `withdraws only the latest version...`, root-withdraw cases |
| Restore Working-Tree-only behavior | `restoreFile` Git tests and route tests |
| newer editor edit preservation | `useHistoryRestore.test.ts` |
| principal Withdraw refresh settling | `useHistoryWithdraw.test.ts` |
| repository-operation source list | seven markers in `git.ts`; direct Create parametrization covers `MERGE_HEAD` and `CHERRY_PICK_HEAD` only |
| client Vault scoping | `src/__tests__/useHistory.test.ts` |
| mutation barriers | `pathMutationLock.test.ts` and composable tests |
| parser multiline cases | current synthetic `parseLog` tests, which do not inject the separator |
| timeline grouping | one ordinary grouping test; no deterministic DST child process |

### 12.2 Coverage gaps — not implemented on the reviewed baseline

```text
Index: F0 before HEAD; pre-staged preservation; F0/F1 mismatch;
mixed path outcomes; failedPaths-only Repair; F0-bound Repair;
all no-write/cleanup/close-before-rename branches; external git add
after each failure; no rename after mismatch.

Filesystem: symlink leaf; symlink directory segment; no outside-Vault
hash, commit, WORKTREE read/diff, or Restore destination.

Resolution: unborn vs operational failure; full-SHA resolution;
strict root/one-parent/merge parsing; no HEAD move on failures.

Marker/Vault metadata: atomic first touch; stable concurrent ID;
no partial ID; locked malformed-ID quarantine; exact marker;
fake body trailers; unmarked/cross-vault/ambiguous/merge/invalid-path
Withdraw; marker-specific client UX.

Repair metadata: concurrent record/settle; migration/quarantine
lost-update protection; lock cleanup; read-only status behavior.

Restore: one immutable SHA; same SHA for read/write; post-read
result.raw; client result.raw authority; no double mutex; symlink;
refresh-success boundary.

Create/Withdraw success: each refresh rejection; immediate composer
settlement; no duplicate retry; repair-status and local cleanup
isolation.

Timeline/Log/bootstrap: DST spring/fall in explicit child TZ;
delimiter injection; multiline/control framing; bootstrap concurrent
non-overwrite and idempotence.

Existing gaps: all seven operation markers; direct backslash,
absolute, and hidden-path cases; same-Vault serialization and
different-Vault parallelism.
```

## 13. Reviewed Source Comments That Do Not Match Source

**Observed on production-code review baseline**

- `git.ts` says the wrapper uses five Git commands; the module now
  uses many more.
- `log()` JSDoc says `--follow`; implementation omits it.
- `repo.ts` says `.gitattributes` contains
  `* text=auto eol=lf`; the constant is intentionally empty.
- `history-api.ts` says the server imports its wire types; the server
  defines its own types.

These comments are documentary defects only in this task; production
source is intentionally unchanged.

## 14. Deviations From Intended Contract

Every Closure finding below is observed and open. Planned fixes are in
Plan Part B.

| ID | Finding | Severity | Closure Blocker |
|---|---|---|---|
| H-C1 | `/status` genuine server failures are swallowed as graceful unavailable | P1 | Yes |
| H-C2 | Create Version can report a successful commit as failure after refresh | P1 | Yes |
| H-C3 | Routine Real-Index sync can overwrite target-path staged intent | P1 | Yes |
| H-C4 | Withdraw lacks valid canonical same-vault marker enforcement | P1 | Yes |
| H-C5 | Restore ref/read/write/result are not one atomic observed snapshot | P1 | Yes |
| H-C6 | Short Withdraw SHA is accepted but never equals full HEAD | P2 | Yes |
| H-C7 | Timeline grouping uses fixed-duration day arithmetic across DST | P2 | Yes |
| H-C8 | Three-platform full-suite verification is missing | P1 (Verification) | Yes |
| H-C9 | Required History regression coverage is incomplete | P1 (Verification) | Yes |
| H-C10 | History filesystem reads/writes lack symlink-safe Vault containment | P1 | Yes |
| H-C11 | HEAD and Withdraw parent resolution do not fail closed | P1 | Yes |
| H-C12 | Repair metadata lacks cross-process lost-update protection | P1 | Yes |
| H-C13 | `ensureRepo` non-overwrite bootstrap has access/write TOCTOU | P2 | Yes |
| H-C14 | Textual Git-log separator is injectable through commit messages | P2 | Yes |
| H-K8 | Rename history is not `--follow`-merged | P2 | No |
| H-K10 | Timeline and Log have no pagination | P2 | No |
| H-K13 | SHA-256 Vault repositories are unsupported by the 40-zero CAS sentinel | P2 | No |

## 15. Observed Protections

The following are present in source but do not close the findings
above:

1. Create commits captured bytes through a Temporary Commit Index.
2. Create and Withdraw move HEAD by CAS.
3. Create and Withdraw check repository operation state at entry and
   before HEAD movement.
4. Repair and Withdraw Index publication fsync, close, then rename.
5. Repair verifies Index fingerprints.
6. Withdraw does not edit Working Tree bytes.
7. Restore uses `--worktree` and not `--staged`.
8. client mutation barriers prevent overlapping in-app workflows.
9. Repair state survives a normal process restart.

These are source-reviewed facts. Full final verification remains
unrun, Owner Approval is pending, and no Final Production Baseline is
recorded.
