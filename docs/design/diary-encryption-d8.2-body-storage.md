# D8.2 — Encrypted Diary Body Read / Write

Status: `REVIEW-READY`

This phase implements the first encrypted managed-Diary body storage seam after
D8.1. It does not close D8.2, start D8.3, or claim that the complete D8 privacy
graph is encrypted.

## Lifecycle

```text
D8 overall        = IN PROGRESS
D8.0              = REVIEW-CLOSED
D8.1              = REVIEW-CLOSED
D8.2              = REVIEW-READY
D8.2 Self-review  = PASS (0/0/0)
D8.2 Independent Review = RE-REVIEW PENDING
D8.3              = NOT STARTED
D8.4              = NOT STARTED
D8 Mood encryption = OUT OF SCOPE
```

## Scope

D8.2 owns the versioned authenticated envelope and the primary managed-Diary
body paths:

- Diary date creation;
- `GET /api/posts/diary/YYYY-MM-DD`;
- `PUT /api/posts/diary/YYYY-MM-DD`.

Generic managed-Diary recovery creation remains prohibited because it cannot
prove the prior document identity. A future adapter-aware owner must integrate
that lifecycle without creating a second body or recovery owner.

Ordinary Note routes retain their existing plaintext behavior. Calendar,
SQLite-owned Mood metadata, Native workspace ownership, and the D8.1 access
capability remain unchanged.

The adapter uses AES-256-GCM with a fresh 96-bit nonce per write and a verified
128-bit authentication tag. The authenticated data binds the envelope to the
vault identity, stable `documentId`, canonical logical path, and envelope
version. Only a magic-marked, serialized JSON envelope reaches the primary file
and the atomic temporary/staged write APIs; the requested Markdown remains
available only in the authorized operation's memory.

The server-side Diary access service remains the sole owner of the live DEK.
Routes receive a bounded body-operation lease only after the existing
capability gate; the lease exposes read/decrypt/encrypt/assert-current methods,
never the raw DEK, and remains active until the callback completes. The lease
is operation-local and unusable after the callback exits. Explicit lock, auth
logout/invalidation, capability expiry, and same-session capability replacement
share one per-session quiescence boundary: new leases are rejected immediately,
existing leases may finish their callback, and the transition does not report
completion until those leases drain and the capability DEK is dropped. Session
quiescence is isolated by auth session. No password, KEK, DEK, or plaintext body
is placed in local/session storage, SQLite, Git, logs, or the envelope.

## Compatibility and explicit non-goals

An existing plaintext Diary body can still be read after authorization as a
legacy compatibility path, but every D8.2 create/save write emits the
authenticated envelope. Plaintext-to-envelope migration is deliberately
reserved for D8.4; D8.2 does not claim that existing plaintext has been
converted.

D8.2 deliberately fails closed for capabilities it cannot safely adapt yet:

- generic managed-Diary recovery creation;
- AI read/create/write/patch of managed Diary bodies;
- managed-Diary rename/move and any generic reference rewrite whose footprint
  may contain a managed Diary body;
- managed-Diary History/Git create, log, file, diff, commit, and restore routes.

D8.2 does not yet claim support for:

- encrypted Draft/Recovery stores, browser search cache, or LinkIndex teardown;
- encrypted PDF/clipboard/export policy;
- adapter-aware rename/folder-move re-encryption;
- adapter-aware non-Git Diary History;
- idempotent vault-wide migration or metadata cleanup.

These remain D8.3/D8.4 work and remain outside this implementation checkpoint.

## Negative behavior

Supported envelope reads fail closed for:

- unknown envelope version or algorithm;
- malformed nonce, tag, or payload;
- authentication-tag failure/tampering;
- stable identity or canonical path mismatch;
- encrypted Diary files whose SQLite metadata identity is missing.

The response does not return body bytes when one of these checks fails. Ordinary
Note behavior is not routed through the Diary adapter. Locked or unsupported
AI, recovery, rename/reference-rewrite, and History/Git paths return stable
fail-closed responses before reading a managed Diary body.

## Validation recorded at this checkpoint

```text
Focused D8.2 suites: 5 files / 217 tests = PASS
Full unit: 240 files / 3556 passed / 9 skipped = PASS
Client + server typecheck: PASS
Production build: PASS
git diff --check: PASS
```

The focused suite covers envelope round-trip, fresh nonce behavior, tamper,
unknown version, identity mismatch, strict envelope parsing and size limits,
legacy read compatibility, Diary create/read/save, body-operation lock leases,
missing-metadata identity fail-closed behavior, rollback, managed History/Git
rejection, AI and rename/reference-rewrite rejection, and unchanged ordinary
Note semantics. Seven pre-D8.2 managed-Diary History metadata endpoint
characterizations remain as historical skipped tests because D8.2 now
intentionally rejects those routes; the two other skips are pre-existing.

The original implementation checkpoint remains historical evidence: its
focused count was `5 files / 47 tests`. It is not the final D8.2 validation
count.

The initial D8.2 Independent Review recorded `P0 = 0`, `P1 = 1`, and
`P2 = 3`. The follow-up remediation added deterministic lifecycle evidence
for each finding:

- auth logout/invalidation waits for an active encrypted body operation before
  the successful transition completes;
- an active operation may finish against its still-owned lease, while new body
  leases for the quiescing session are rejected immediately;
- same-session unlock/capability replacement waits for active body leases and
  only then publishes the replacement capability;
- capability expiry uses the same quiescence boundary and does not zeroize an
  active lease mid-callback;
- session A quiescence does not block or invalidate session B;
- a captured `DiaryBodyOperation` fails closed after `withBodyOperation()`
  returns;
- the exact-head tags-scale migration expectation follows schema version 11,
  including D8.1 migration `0011_diary_access.sql`.

The line above is an earlier checkpoint. The consolidated Independent Review
of the D8.2 baseline later classified the complete set of findings as
`P0 = 0`, `P1 = 2`, `P2 = 3`, `CHANGES REQUIRED`; the current remediation
record below preserves that classification and its history rather than
rewriting it as a pass.

The implementation/test remediation lineage is:

```text
471a6f9  fix(diary): close D8.2 encrypted body bypasses
bc33c60  fix(diary): unify D8.2 body quiescence
7a52e2b  docs(diary): record D8.2 quiescence remediation
6e418fe  fix(diary): align D8.2 E2E access lifecycle
00df558  test(diary): avoid redundant lifecycle navigation
69ef0a8  fix(diary): close D8.2 access lifecycle gaps
```

The evidence sync after this remediation remains review-ready rather than a
closure record. It retains the consolidated Independent Review `CHANGES
REQUIRED` history for P1-1, P1-2, P2-1, P2-2 and P2-3; this remediation records
those findings as addressed and leaves the independent re-review pending.

## Historical remediation validation

The following block belongs to the earlier remediation checkpoint before the
current access-boundary remediation. It is retained as historical evidence;
the current counts and dispositions are recorded in the section below.

The final remediation head was validated with these results:

```text
D8.2 focused suites: 6 files / 229 tests = PASS
D8.1 adversarial/access regression: 2 files / 18 tests = PASS
D7 Diary/Mood/Calendar regression: 9 files / 95 tests = PASS
Full unit: 240 files / 3562 passed / 9 skipped = PASS
History integration: 5 files / 174 tests = PASS
Recovery integration: 5 files / 193 tests = PASS
Tags-scale: 2 files / 6 tests = PASS
npm run typecheck: PASS
npm run typecheck:client: PASS
npm run typecheck:server: PASS
npm run build: PASS
git diff --check: PASS
```

The build emitted only the repository's existing dependency annotation and
large-chunk warnings. The nine skipped unit tests are the seven historical
managed-Diary History endpoint characterizations intentionally superseded by
D8.2 fail-closed behavior plus the two pre-existing skips; active ordinary
Note History coverage remains passing.

The earlier envelope/bypass remediation remains historical evidence:

```text
471a6f9 fix(diary): close D8.2 encrypted body bypasses
```

The current quiescence and cross-platform test remediation is `bc33c60`.

## Historical Diary E2E access-lifecycle remediation

This section records the earlier fixture/bootstrap remediation and remains
historical. It is not the final validation record for the current access
boundary changes.

The browser failure cascade was traced to a missing D8.2 precondition rather
than to a common Diary product failure. Playwright `storageState` carried the
authenticated login cookie, but a new `BrowserContext`, page JavaScript
process, or `APIRequestContext` did not carry the server's process-local Diary
capability. The first protected Diary setup/cleanup calls therefore received
the expected `423 diary-locked`. A worker-scoped login must not be interpreted
as Diary access, and no capability token was logged during this diagnosis.

The Diary E2E fixture now makes that distinction explicit:

- each Diary test gets a fresh authenticated browser session;
- the page enters Diary through the normal UI setup/unlock flow after a full
  navigation or reload, without persisting the capability;
- API seed/cleanup uses a separate fresh authenticated client and carries its
  freshly issued capability only in an in-memory
  `X-Docus-Diary-Capability` request header;
- `storageState`, local/session storage, cookies, IndexedDB, URLs, and the
  database remain capability-free;
- locking the browser page does not invalidate the separate API session;
- a client with the login cookie but no capability remains `423 diary-locked`,
  while the capability-bearing fixture reaches the normal protected-route
  result (for an absent date, `404`).

This preserves the server guard and D8.2 quiescence instead of weakening them.
The fixture also keeps unsupported managed-Diary History and generic Recovery
paths as explicit fail-closed evidence (`422` with their stable error codes).
The seven pre-D8.2 managed-Diary History/Recovery success cases remain
transparent skips with an adapter-ownership reason; they are not counted as
passing support for encrypted-body History or Recovery.

One narrow product integration fix was required by the same fresh-process
boundary. During the security bootstrap, `App.vue` can transiently normalize a
persisted Diary scope to `note` before the UI unlocks again. `VaultView` now
leaves the Calendar query seed/provenance intact during that locked bootstrap;
an actual unlocked scope exit still applies the existing query ownership rules.
This does not grant access, change routing, or create a second query owner.

The new access regression covers the exact boundary:

```text
authenticated cookie without capability -> 423 diary-locked
normal UI unlock / explicit API capability -> protected route proceeds
capability absent from browser and Playwright storage -> PASS
page-session lock -> separate API capability remains isolated
managed History/Recovery without an adapter -> stable 422 fail closed
```

Fresh validation after the fixture and bootstrap remediation:

```text
focused client/Vault suites: 6 files / 102 passed
Diary browser suites: 69 passed / 7 skipped
access-lifecycle regression: 3 passed
complete Chromium E2E: 152 collected / 145 passed / 7 skipped
full unit: 240 files / 3562 passed / 9 skipped
History integration: 5 files / 174 passed
Recovery integration: 5 files / 193 passed
Tags-scale: 2 files / 6 passed
client + server typecheck: PASS
production build: PASS
```

The seven browser skips are the same intentionally unsupported managed-Diary
History/Recovery success paths described above; the complete run contains no
active Diary access failure. No production server guard, capability storage
rule, D8.2 quiescence boundary, Diary body owner, Calendar lifecycle, or
ordinary Note behavior was bypassed.

## Current access-boundary remediation evidence

This section is the current remediation record on implementation commit
`69ef0a8033165c9d8ab43e5acc8034269cb24a2f`, whose parent is the reviewed
`00df5583f4929a4f04463d36fd7070aa42f63893`. It is separate from the
historical validation blocks above and does not close D8.2.

### Capability request routing

The ambient client request helper no longer reads or forwards the in-memory
`X-Docus-Diary-Capability` value. Capability-bearing requests use the explicit
`diaryAuthFetch` seam, and path-aware wrappers select that seam only when the
canonical logical path is a managed `diary/YYYY-MM-DD` path (including the
history `.md` wire spelling). Ordinary Note requests to the same generic
post/history/resource wrappers remain on ordinary `authFetch` and carry no
Diary header. Structural summary/tree/metadata reads remain ordinary by
design; vault-wide body-scanning preview uses the explicit Diary seam, while
generic scanner/index privacy remains D8.3 scope.

The request-boundary unit test proves, with a live in-memory capability, that
an ordinary Note request sends no capability, while a managed Diary post and
managed Diary history request send the capability. The capability remains
process-local: it is not put in local/session storage, IndexedDB, cookies,
URLs, storage state, SQLite, logs, or response artifacts.

### Trace and failure-artifact containment

All ten Diary Playwright specs that import the Diary fixture set
`trace: 'off'` and retain `screenshot: 'only-on-failure'`. This avoids
serializing capability-bearing network headers into Diary trace archives while
preserving screenshots and error context for failures; the repository's
non-Diary suites retain their existing artifact policy.

A controlled deliberately failing Diary fixture check produced a failure
screenshot and `error-context.md`, produced zero trace zip archives, and found
no `X-Docus-Diary-Capability` header in that result directory. This is an
artifact-containment check, not a claim that all unrelated test artifacts are
sanitized.

### Capability issuance and quiescence fence

Setup/unlock reserves a per-session issuance ticket before asynchronous KDF or
unwrap work. A lifecycle generation is advanced synchronously when lock,
logout/invalidation, expiry, or capability replacement begins; the latest
same-session issuance sequence wins deterministically. The final issuance
check is adjacent to the capability-map publication with no asynchronous gap.
An invalidated unpublished DEK is zeroized, and replacement still waits for
existing encrypted body leases through the established quiescence boundary.

The service tests cover paused unlocks invalidated by explicit lock, auth
logout, and expiry, plus concurrent same-session unlocks where the newest
issuance remains valid and the older unpublished DEK is rejected and cleared.
The existing body-operation lease and cross-session isolation tests remain
passing.

### Fresh bootstrap, access loss, and fixture lifecycle

`useDiaryAccessSession` exposes an authoritative `statusResolved` signal.
`VaultView` no longer infers a real lock boundary from `state !== UNLOCKED`:
fresh-process scope normalization can preserve Calendar-owned context while
status is unresolved, whereas a reconciled lock/logout/expiry clears
Calendar-owned query and provenance and preserves user-owned FileTree state.
The source regression verifies this distinction.

The worker Diary configuration now uses a disposable authenticated session and
explicit logout/teardown. Each browser test receives a fresh authenticated
session; API setup/cleanup uses a separate fresh session with its capability
only in an in-memory request header; page fixture teardown explicitly logs out
its own session. The worker session needed by later tests is not revoked as a
side effect of configuration cleanup.

### Current validation

```text
D8.2 focused unit/API suites: 7 files / 87 passed / 7 skipped = PASS
Diary Chromium suite: 10 specs / 79 collected / 72 passed / 7 skipped = PASS
Diary lifecycle regression subset: 7 passed = PASS
History integration: 5 files / 174 passed = PASS
Recovery integration: 5 files / 193 passed = PASS
Tags-scale: 2 files / 6 passed = PASS
npm run typecheck: client + server = PASS
npm run build = PASS
Full unit harness: 240 passed files / 3568 passed / 9 skipped;
  1 file with 2 pre-existing unrelated failures in useEditorTabs.test.ts
  = NOT A PASS
git diff --check: PASS
```

The seven skips in the current D8.2-focused and Diary browser records are the
intentionally unsupported managed-Diary History/Recovery success paths; they
are not new omissions. The two full-unit failures are the existing
`useEditorTabs.test.ts` dirty-close and rename-event failures, outside this
remediation's changed files and scope. No current evidence claims a full-unit
pass because of those failures.

### Current remediation disposition and lifecycle

The consolidated prior Independent Review of the `00df5583` baseline was
`P0 = 0`, `P1 = 2`, `P2 = 3`, `CHANGES REQUIRED`. Its findings and current
remediation dispositions are:

```text
D8.2-IR-P1-1  ambient capability injection + Diary trace artifact  REMEDIATED
D8.2-IR-P1-2  unlock issuance resurrection across lifecycle fences  REMEDIATED
D8.2-IR-P2-1  fresh bootstrap confused with real access loss        REMEDIATED
D8.2-IR-P2-2  worker fixture session teardown                         REMEDIATED
D8.2-IR-P2-3  lineage/count/evidence drift                            REMEDIATED

D8.2 Self-review                 = PASS (0/0/0)
D8.2 Independent Re-review       = RE-REVIEW PENDING
D8.2 closure                     = NOT STARTED
D8.3                           = NOT STARTED
D8.4                           = NOT STARTED
D8 Mood encryption              = OUT OF SCOPE
```

This remediation record is review-ready evidence only. It does not claim
Independent Review PASS, does not create a D8.2 closure record, and does not
start D8.3 or D8.4.

## Review record

```text
D8.2 Self-review P0/P1/P2 = 0/0/0
D8.2 Independent Review    = RE-REVIEW PENDING
D8.2 earlier checkpoint    = P0: 0, P1: 1, P2: 3
D8.2 consolidated prior IR = P0: 0, P1: 2, P2: 3; CHANGES REQUIRED
D8.2 remediation           = COMPLETE; re-review pending
D8.2 closure               = NOT STARTED
```

This is a review-ready evidence record, not a closure record. The next
independent review must verify that primary files and atomic temp/staging paths
contain no requested Diary plaintext, that CAS compares decrypted plaintext
while committing ciphertext, that lock waits for active body leases, and that
ordinary Note semantics remain unchanged.
