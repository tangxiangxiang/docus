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
D8.2 Independent Review = PENDING
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
never the raw DEK, and remains active until the callback completes. Lock waits
for active body leases before dropping capabilities. No password, KEK, DEK, or
plaintext body is placed in local/session storage, SQLite, Git, logs, or the
envelope.

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

The remediation implementation/test commit is:

```text
471a6f9 fix(diary): close D8.2 encrypted body bypasses
```

## Review record

```text
D8.2 Self-review P0/P1/P2 = 0/0/0
D8.2 Independent Review    = PENDING
D8.2 closure               = NOT STARTED
```

This is a review-ready evidence record, not a closure record. The next
independent review must verify that primary files and atomic temp/staging paths
contain no requested Diary plaintext, that CAS compares decrypted plaintext
while committing ciphertext, that lock waits for active body leases, and that
ordinary Note semantics remain unchanged.
