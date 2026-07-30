# Vault Git History — Implementation Plan

**Date:** 2026-07-30
**Consolidated:** 2026-07-31
**Status:** Closure Remediation Plan — Pending Owner Approval
**Closure:** DRAFT — CLOSURE IN PROGRESS
**Production-code review baseline:** `00b17359d151bbdbe56115ed992700ecbb5e1ca1`

This Plan implements the contracts in the
[Design](../specs/2026-07-30-vault-git-history-design.md). Current
behavior is recorded in the
[Implementation Record](../../vault-git-history-implementation-record.md);
closure evidence belongs in the
[Draft Closure](../../vault-git-history-final-closure.md).

Every item in Part B is a **Planned remediation / Closure requirement /
Not implemented on the reviewed production baseline**. No future
behavior in this Plan may be reported as observed.

## Part A — Retrospective Baseline

The reviewed production baseline already provides:

1. repository bootstrap and Git capability;
2. logical path/ref validation;
3. Status, Log, Snapshot, and Diff reads;
4. exact Working Tree capture and Temporary-Index Create Version;
5. CAS HEAD movement;
6. process-local repository mutation serialization;
7. persistent Index Repair metadata and hand-taken Index-lock Repair;
8. Working-Tree-only Restore;
9. latest-HEAD Withdraw;
10. client Timeline, Snapshot, Comparison, Restore, Withdraw, and
    Repair surfaces.

The baseline is not the intended closure state. In particular:

- Create routine sync still runs up to three Real-Index resets;
- no F0/F1 path outcome exists;
- no canonical marker or Vault identity exists;
- filesystem operations can follow symlinks;
- HEAD/parent resolution does not fail closed;
- Repair metadata has no cross-process lock;
- Restore is not one atomic resolved-ref/read/write/post-read
  transaction;
- Create can report a successful commit as failure after refresh;
- Git-log framing and DST grouping remain incorrect;
- final regression and three-platform verification are missing.

## Part B — Closure Remediation Tasks

The finding IDs, titles, severities, and blocker status are canonical:

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

### History-C1 — Correct `/status` response truthfulness

**Finding:** H-C1, P1, Closure Blocker.

**Files:** `src/lib/history-api.ts`,
`src/lib/__tests__/history-api.test.ts`.

**Implementation:**

Parse the response once. Recover only:

```text
HTTP 503
AND body is an object
AND body.available === false
AND body.dirty is an array
```

Every other non-2xx throws `HistoryApiError`. Remove the general
`allowNonOkJson` escape hatch from `getStatus`.

**Required tests:**

```text
recovers the exact graceful unavailable 503 body
throws on a non-graceful 503
throws on a 500 even when it has JSON
throws on a malformed non-2xx body
```

**Done:** genuine server faults cannot masquerade as Git
unavailability.

### History-C2 — Separate primary mutation success from refresh work

**Finding:** H-C2, P1, Closure Blocker.

**Files:** `src/composables/vault/useHistoryCommit.ts`,
`src/composables/vault/useHistoryWithdraw.ts`,
`src/i18n/locales/en.ts`, `src/i18n/locales/zh.ts`, and both
composable test files.

**Implementation:**

For Create:

```text
await createCommit
→ acknowledge success
→ settle selection/message/completion state
→ release barrier
→ run refreshStatus, refreshLog, refreshComparisons independently
→ summarize failures as one informational refresh warning
```

No refresh runs inside the primary commit-failure catch. A retry after
a refresh failure sees settled composer state and cannot duplicate the
version.

Withdraw already uses `Promise.allSettled` for Status, Log, and
Comparison. Keep that behavior and isolate
`closeDroppedRevision`, Repair register/settle,
`refreshIndexRepairStatus`, and local completion updates so none can
turn the successful server response into `withdraw_failed`.

**Required tests:**

```text
commit remains successful when refreshStatus rejects
commit remains successful when refreshLog rejects
commit remains successful when comparison refresh rejects
selection and message settle immediately after commit response
retry after refresh failure does not create a duplicate version
withdraw remains successful when repair-status refresh rejects
withdraw remains successful when local tab cleanup throws or is isolated
```

### History-C3 — Implement path-selective atomic Real-Index sync

**Finding:** H-C3, P1, Closure Blocker.

**Dependencies:** History-C10 symlink-safe resolver and History-C12
Repair metadata lock must land first. History-C11 supplies fail-closed
HEAD resolution. C3 reuses, but does not rewrite, the proven
close-before-rename lifecycle already present in
`repairIndexWithLock` and `syncDroppedIndexPaths`.

**Files:** `server/history/git.ts`, `server/history/routes.ts`,
`src/lib/history-api.ts`,
`src/composables/vault/useHistoryCommit.ts`,
`src/composables/vault/useHistoryWithdraw.ts`,
`src/components/vault/HistoryChangesPanel.vue`,
`src/i18n/locales/en.ts`, `src/i18n/locales/zh.ts`, and relevant
server, route, API, composable, and component tests.

**Wire contract:**

```ts
interface IndexSyncRequest {
  oldHead: string | null
  targetHead: string | null
  paths: string[]
  expectedIndexBeforeHeadMove:
    Record<string, IndexEntryFingerprint[]>
}

interface IndexSyncOutcome {
  synchronizedPaths: string[]
  preservedExternalPaths: string[]
  failedPaths: string[]
}
```

The caller does not pass `safeCandidatePaths`. The server derives it
from F0 and old-HEAD tree entries.

**Create sequence:**

```text
validate request
→ acquire withRepoMutation
→ assertRepositoryIdle
→ ensure Repair storage preflight
→ re-read Status
→ capture exact expected Working Tree bytes
→ ensure author / Vault metadata
→ build Temporary Commit Index from oldHead
→ write tree
→ create commit object
→ capture F0 from Real Index for every target path
→ compare F0 with oldHead tree entries
→ classify safeCandidatePaths / preservedExternalPaths
→ assertRepositoryIdle immediately before HEAD move
→ CAS update-ref HEAD
→ syncIndexAtomic
```

Empty-repository classification is exact:

```text
oldHead entry absent + F0 absent  → safe candidate
oldHead entry absent + F0 present → preserved external staged intent
```

**`syncIndexAtomic` algorithm:**

1. If no safe candidate exists, return preserved paths without
   acquiring `index.lock`.
2. Resolve the absolute Git directory.
3. Acquire `.git/index.lock` with `open(..., 'wx')`.
4. Read the Real Index under lock and capture F1 per target.
5. Classify each target independently:
   - F0 differs from old HEAD → preserved;
   - F1 differs from F0 → preserved;
   - both match → `pathsToSynchronize`.
6. If `pathsToSynchronize` is empty, close and remove `index.lock`;
   do not run reset/update-index, write, or rename.
7. Seed a Temporary Index from the locked Real Index, or use
   `read-tree --empty` when absent.
8. Apply scoped reset/update-index only to `pathsToSynchronize`.
9. Verify those paths against `targetHead`; preserved and unrelated
   entries remain byte-for-byte seeded.
10. Re-check the operation state and HEAD.
11. Write replacement bytes to `.git/index.lock`.
12. `fsync` the lock handle.
13. Close the lock handle.
14. Atomically rename `.git/index.lock` to `.git/index`.
15. Remove the Temporary Index directory.

If rename has not committed, `finally` closes the handle, removes
`index.lock`, and removes the Temporary Index directory. There are no
destructive retries.

**Outcome rules:**

- `synchronizedPaths`: fully checked and published.
- `preservedExternalPaths`: unchanged; no Repair, banner, Retry, or
  `indexRefreshFailed`; one informational toast.
- `failedPaths`: safe candidates affected by lock, I/O, Temporary
  Index, verification, fsync, close, or rename failure. Only these
  paths may create a pending Repair, and `expectedIndex` is F0.
- an F1 mismatch never fails safe siblings;
- a global failure fails unfinished safe candidates only;
- `indexRefreshFailed = failedPaths.length > 0`.

**Windows error normalization:**

Only `EEXIST`, `EBUSY`, `EAGAIN`, and `EPERM` positively classified as
lock contention become degraded success. An ordinary permission
failure is not swallowed.

**Required tests:**

```text
captures F0 before moving HEAD
preserves a path staged before Create Version
preserves a path changed from F0 to F1
synchronizes one safe path while preserving one mismatched path
creates Repair only for failedPaths
binds failed-path Repair to pre-HEAD F0
does not acquire index.lock when no safe path exists
removes index.lock when all paths become preserved under lock
removes index.lock after Temporary Index creation failure
removes index.lock after verification failure
closes index.lock before atomic rename
allows a subsequent external git add after every failure branch
does not rename after fingerprint mismatch
```

### History-C4 — Add atomic Vault identity and canonical marker

**Finding:** H-C4, P1, Closure Blocker.

**Dependencies:** History-C11 for full-SHA and parent parsing;
History-C10 for changed-path validation.

**Files:** `server/history/repo.ts`, `server/history/git.ts`,
`server/history/routes.ts`, `server/history/validation.ts`,
`src/lib/history-api.ts`,
`src/composables/vault/useHistoryWithdraw.ts`,
`src/i18n/locales/en.ts`, `src/i18n/locales/zh.ts`, Withdraw
composable/component tests, and server/route tests.

**Vault identity publication:**

Use `<git-dir>/docus/vault-id` and one dedicated metadata creation
lock:

```text
acquire vault-id creation lock
→ if a valid final id exists, return it
→ quarantine malformed final id while still locked
→ create a same-directory temporary id file exclusively
→ write one complete lowercase UUID plus newline
→ fsync
→ close
→ atomically publish final id
→ fsync parent directory where supported
→ release creation lock
```

Concurrent first touch yields one stable ID and never exposes an empty
or partial file.

**Create marker:**

Append one final canonical trailer paragraph:

```text
Docus-Version: 1
Docus-Vault-Version: <vault-id>
```

User-body lines that resemble trailers are not authoritative.
Parsing examines the final canonical trailer paragraph and requires
exactly one value for each key, no unknown line inside the canonical
block, and a same-Vault ID. Duplicate keys or ambiguous final trailer
layout fail closed.

**Legacy policy: Option A — fail closed (fixed).**

Legacy unmarked commits cannot be withdrawn. They must be recommitted
through the new Create Version flow. There is no claim endpoint,
author/date inference, or alternate migration policy.

The marker is an accidental-withdrawal guard, not cryptographic
provenance proof.

**Withdraw client error contract:**

Return stable server error codes and distinguish:

```text
latest changed
repository operation
invalid same-vault marker
cross-vault marker
ambiguous marker
legacy unmarked commit
merge commit
invalid changed path
```

No general “all 409 = latest changed” path remains.

**Required tests:**

```text
creates vault id atomically on first touch
concurrent first touch produces one stable vault id
does not expose a partial vault id
quarantines malformed vault id without racing a writer
Create appends exactly one canonical trailer block
user body fake trailers are not authoritative
Withdraw rejects unmarked external commit
Withdraw rejects cross-vault marker
Withdraw rejects duplicate or ambiguous canonical trailers
Withdraw rejects merge commit
Withdraw rejects non-managed changed path
client shows marker-specific conflict rather than latest-changed
```

### History-C5 — Replace Restore with one atomic entry point

**Finding:** H-C5, P1, Closure Blocker.

**Dependencies:** History-C10 and History-C11.

**Files:** `server/history/git.ts`, `server/history/routes.ts`,
`src/lib/history-api.ts`,
`src/composables/vault/useHistoryRestore.ts`, Restore route/API/
composable tests.

**Implementation:**

Introduce one `restoreFileAtomic(...)` that owns the only
`withRepoMutation`. The route must not add a mutex, run `rawAt`
beforehand, or call an old helper that acquires its own mutex.

```text
withRepoMutation
→ resolve accepted ref once to one full immutable commit SHA
→ read source using the full SHA
→ resolve and reject symlink-safe destination
→ git restore --source=<fullSha> --worktree -- <path>
→ open verified file handle
→ fstat/read/fstat identity check
→ bounded retry or conflict
→ return requestedRef, resolvedRef, result.raw, and result.mtime
```

The response is the post-restore snapshot observed inside the
repository mutation transaction. It does not promise that an external
process cannot write immediately afterward. The client uses
`result.raw` for the editor baseline and `VaultFileChanges`, while
preserving newer editor edits. Refresh failures remain success.

**Required tests:**

```text
resolves accepted ref once to one immutable full SHA
uses the resolved SHA for read and write
returns post-restore observed Working Tree bytes
uses result.raw in editor state
uses result.raw in VaultFileChanges
preserves newer editor edits
does not double-acquire withRepoMutation
rejects symlink target paths
does not report completed restore as failed when refresh fails
```

### History-C6 — Resolve accepted Withdraw SHA once

**Finding:** H-C6, P2, Closure Blocker.

**Files:** `server/history/validation.ts`, `server/history/git.ts`,
`server/history/routes.ts`, route and Git tests.

**Implementation:**

Keep 7–40 hex validation. Resolve the request with
`rev-parse --verify <request>^{commit}` to one full immutable SHA.
Reject ambiguous, missing, malformed, or non-commit results. Every
subsequent operation uses the full SHA:

- HEAD equality;
- marker check;
- parent parse;
- changed-path discovery;
- CAS update-ref.

There is no reject-short-SHA branch.

**Required tests:**

```text
resolves a short SHA to a full commit SHA
uses the same full SHA for every Withdraw check
rejects ambiguous or non-commit resolution
```

### History-C7 — Use DST-safe local-calendar ordinals

**Finding:** H-C7, P2, Closure Blocker.

**Files:** `src/composables/vault/useHistoryTimeline.ts`,
`src/composables/vault/__tests__/useHistoryTimeline.test.ts`, and a
small child-process fixture if needed.

**Implementation:**

Replace elapsed-millisecond day math with:

```ts
function localDayOrdinal(timestamp: number): number {
  const date = new Date(timestamp)
  return Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ) / 86_400_000
}
```

Run deterministic DST cases by spawning a child Node/Vitest process
with an explicit `TZ` environment. Runtime mutation of
`process.env.TZ` is not an alternate plan.

**Required tests:**

```text
groups correctly across DST spring-forward
groups correctly across DST fall-back
runs DST cases under an explicit child-process TZ
groups a local previous-day item as Yesterday near midnight
keeps future timestamps in Today
```

### History-C8 — Complete three-platform full-suite verification

**Finding:** H-C8, P1 (Verification), Closure Blocker.

**Files:** no production file; CI/verification evidence only unless a
real failure requires a separately reviewed change.

**Required matrix:** Linux, macOS, Windows.

Each platform must run the approved full suite at the same immutable
candidate production SHA. Record command, run URL/log, date, platform,
and result in the Closure. Existing CI configuration is not evidence
of a completed run.

### History-C9 — Complete required regression coverage

**Finding:** H-C9, P1 (Verification), Closure Blocker.

This task owns the aggregate coverage gate. Tests implemented in
C1–C7 and C10–C14 count toward it, but the gate closes only when all
scenarios below exist and pass.

**Index synchronization**

```text
captures F0 before moving HEAD
preserves a path staged before Create Version
preserves a path changed from F0 to F1
synchronizes one safe path while preserving one mismatched path
creates Repair only for failedPaths
binds failed-path Repair to pre-HEAD F0
does not acquire index.lock when no safe path exists
removes index.lock when all paths become preserved under lock
removes index.lock after Temporary Index creation failure
removes index.lock after verification failure
closes index.lock before atomic rename
allows a subsequent external git add after every failure branch
does not rename after fingerprint mismatch
```

**Symlink safety**

```text
rejects a symlink Markdown leaf
rejects a symlink directory segment
does not hash bytes outside the Vault
does not commit bytes outside the Vault
does not expose outside bytes through WORKTREE file or diff
Restore rejects a symlink destination
```

**Ref/parent resolution**

```text
distinguishes unborn HEAD from operational failure
resolves a short SHA to a full commit SHA
classifies root commit only from valid parent output
rejects merge commits
does not move HEAD on parent-resolution failure
does not move HEAD on malformed parser output
```

**Marker and Vault metadata**

```text
creates vault id atomically on first touch
concurrent first touch produces one stable vault id
does not expose a partial vault id
quarantines malformed vault id without racing a writer
Create appends exactly one canonical trailer block
user body fake trailers are not authoritative
Withdraw rejects unmarked external commit
Withdraw rejects cross-vault marker
Withdraw rejects duplicate or ambiguous canonical trailers
Withdraw rejects merge commit
Withdraw rejects non-managed changed path
client shows marker-specific conflict rather than latest-changed
```

**Repair metadata**

```text
serializes concurrent record and settle
does not lose transactions during migration
does not lose transactions during quarantine
cleans metadata lock after failure
repair-status does not perform an unlocked write
```

**Restore**

```text
resolves accepted ref once to one immutable full SHA
uses the resolved SHA for read and write
returns post-restore observed Working Tree bytes
uses result.raw in editor state
uses result.raw in VaultFileChanges
preserves newer editor edits
does not double-acquire withRepoMutation
rejects symlink target paths
does not report completed restore as failed when refresh fails
```

**Commit/Withdraw success boundary**

```text
commit remains successful when refreshStatus rejects
commit remains successful when refreshLog rejects
commit remains successful when comparison refresh rejects
selection and message settle immediately after commit response
retry after refresh failure does not create a duplicate version
withdraw remains successful when repair-status refresh rejects
withdraw remains successful when local tab cleanup throws or is isolated
```

**Timeline/parser/bootstrap and existing gaps**

```text
groups correctly across DST spring-forward
groups correctly across DST fall-back
runs DST cases under an explicit child-process TZ
does not create phantom log records from delimiter characters
round-trips multiline commit bodies and control characters safely
does not overwrite a dotfile created concurrently
concurrent ensureRepo calls remain idempotent
parametrizes all seven repository-operation markers
tests logical path backslash, absolute, and hidden-directory rejection
serializes same-Vault server mutations and allows different Vaults in parallel
```

### History-C10 — Add one symlink-safe filesystem resolver

**Finding:** H-C10, P1, Closure Blocker.

**Files:** new shared server History path-resolver module,
`server/history/validation.ts`, `server/history/routes.ts`,
`server/history/git.ts`, and route/Git tests.

**Implementation:**

One helper performs the six steps in Spec §7:

```text
logical syntax validation
→ lstat every segment
→ reject symlink segment and leaf
→ canonicalize Vault root and target
→ verify containment
→ return verified path or open handle
```

No endpoint constructs `path.join(repoRoot, logicalPath)` and then
reads/writes it independently. Apply the helper to `/content-hashes`,
Create capture, WORKTREE `/file`, WORKTREE `/diff`, Restore
read/write/post-read, and `restoreFileAtomic`.

**Required tests:** every Symlink Safety test listed in C9.

### History-C11 — Make HEAD, commit, and parent resolution fail closed

**Finding:** H-C11, P1, Closure Blocker.

**Files:** `server/history/git.ts`, `server/history/routes.ts`,
server/route tests.

**Implementation:**

Replace nullable catch-all HEAD resolution with:

```ts
type HeadResolution =
  | { kind: 'head'; sha: string }
  | { kind: 'unborn' }
```

Identify `unborn` through a positive repository-state check. Any
operational `rev-parse` failure throws.

Resolve the candidate to one full SHA, then run:

```text
git rev-list --parents -n 1 <resolvedSha>
```

Strict parse:

```text
1 token  → root
2 tokens → one parent
3+       → merge, reject
failure, empty output, non-hex token, or unexpected SHA → abort
```

No resolution failure may reach `update-ref`.

**Required tests:** every Ref/Parent Resolution test listed in C9.

### History-C12 — Serialize Repair metadata across processes

**Finding:** H-C12, P1, Closure Blocker.

**Files:** `server/history/git.ts` or a new Repair-store module, and
server/route tests.

**Implementation:**

Introduce `withRepairMetadataLock` backed by an exclusive lock file
under `<git-dir>/docus/`. Acquisition uses `open(..., 'wx')` with a
bounded contention retry. Existing lock means wait/fail closed; it is
never ignored. The helper closes and removes its own lock in `finally`.

All of the following execute under that lock:

- `recordIndexRepair`;
- `settleIndexRepairPaths`;
- `discardIndexRepair`;
- v1 migration;
- corrupt quarantine;
- any read-modify-write state transition.

`GET /repair-status` is read-only. If migration or quarantine is
needed, it enters the locked mutation helper before writing; it never
performs an unlocked write.

Keep the distinctions explicit:

```text
atomic publication                    implemented already for non-empty writes
process-restart persistence           implemented already
power-loss durability                 not established
cross-process lost-update protection  delivered by this task
```

**Required tests:** every Repair Metadata test listed in C9.

### History-C13 — Remove bootstrap non-overwrite TOCTOU

**Finding:** H-C13, P2, Closure Blocker.

**Files:** `server/history/repo.ts`,
`server/__tests__/history-git.test.ts`.

**Implementation:**

Replace `access → writeFile` with:

```ts
await fs.writeFile(path, content, { encoding: 'utf8', flag: 'wx' })
```

Treat only `EEXIST` as success. Propagate every other error.

**Required tests:**

```text
does not overwrite a dotfile created concurrently
concurrent ensureRepo calls remain idempotent
```

### History-C14 — Replace injectable textual Log framing

**Finding:** H-C14, P2, Closure Blocker.

**Files:** `server/history/git.ts`,
`server/__tests__/history-git.test.ts`, route/API tests as needed.

**Implementation:**

Use one NUL-framed Git output contract. Header fields and name-only
paths are NUL-terminated; an empty NUL field closes each record.
Because Git commit messages and path names cannot contain NUL, the
parser can consume exact field boundaries without a textual sentinel.
Validate field count, SHA, date, and record termination; malformed
output fails instead of yielding partial `CommitRecord`s.

Delete `LOG_SEPARATOR` and `findHeaderEnd`. Do not add a second
message-validation fallback.

**Required tests:**

```text
does not create phantom log records from delimiter characters
round-trips a message containing record-separator characters
round-trips multiline commit bodies and control characters safely
does not interpret body lines as file names
rejects malformed NUL framing
```

### History-C15 — Run final closure verification

After C1–C14:

```text
npm run typecheck
npm run build
npm test -- --run
approved Long Flow History e2e
git diff --check
Linux/macOS/Windows matrix
```

Record exact commands, SHA, platform, and results. A documentation-only
check is not Final Production Baseline evidence.

### History-C16 — Capture immutable Final Production Baseline

Only after C15 is green, record the immutable production SHA in the
Closure. Do not guess it and do not record a commit's own unknown SHA
inside that same commit.

### History-C17 — Owner approval and maintenance-mode entry

After all blockers are closed, the final SHA is recorded, and the
Owner approves:

- flip Closure to CLOSED;
- set Owner Approval to approved;
- update README with the final production SHA;
- activate Maintenance-Mode rules.

Until then:

```text
Owner Approval: PENDING / BLOCKED
Final Production Baseline: NOT YET CAPTURED
Maintenance Mode: NOT ENTERED
```

## Execution Order

```text
Phase 0 — Final documentation consolidation

Phase 1 — Shared safety foundations
  History-C10  symlink-safe filesystem resolver
  History-C11  fail-closed HEAD/commit/parent resolver
  History-C12  Repair metadata cross-process locking
  History-C13  atomic bootstrap writes
  History-C14  machine-safe log parser

Phase 2 — API and UI truthfulness
  History-C1
  History-C2
  dedicated Withdraw marker errors from History-C4

Phase 3 — Commit marker and Index safety
  History-C4  Vault-id metadata + marker generation/parsing
  History-C6  full-SHA request resolution
  History-C3  routine sync F0/F1 + shared result model

Phase 4 — Restore correctness and Timeline
  History-C5  restoreFileAtomic + result.raw authority
  History-C7  DST-safe grouping

Phase 5 — Regression completion
  History-C9

Phase 6 — Verification
  History-C8
  History-C15

Phase 7 — Final closure
  History-C16
  History-C17
```

C3, C4, C6, C10, C11, and C12 touch shared server core. The phase
order is mandatory; parallel implementation against the same
functions is not authorized by this Plan.
