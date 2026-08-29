# D8.2 — Encrypted Diary Body Read / Write

Status: `IN PROGRESS`

This phase implements the first encrypted managed-Diary body storage seam after
D8.1. It does not close D8.2, start D8.3, or claim that the complete D8 privacy
graph is encrypted.

## Lifecycle

```text
D8 overall        = IN PROGRESS
D8.0              = REVIEW-CLOSED
D8.1              = REVIEW-CLOSED
D8.2              = IN PROGRESS
D8.2 Self-review  = PENDING
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
- `PUT /api/posts/diary/YYYY-MM-DD`;
- managed-Diary recovery creation.

Ordinary Note routes retain their existing plaintext behavior. Calendar,
SQLite-owned Mood metadata, Native workspace ownership, and the D8.1 access
capability remain unchanged.

The adapter uses AES-256-GCM with a fresh 96-bit nonce per write and a verified
128-bit authentication tag. The authenticated data binds the envelope to the
vault identity, stable `documentId`, canonical logical path, and envelope
version. Only a serialized JSON envelope reaches the primary file and the
atomic temporary/staged write APIs; the requested Markdown remains available
only in the authorized operation's memory.

The server-side Diary access service remains the sole owner of the live DEK.
Routes receive a short-lived operation copy only after the existing capability
gate and clear that copy in a `finally` boundary. No password, KEK, DEK, or
plaintext body is placed in local/session storage, SQLite, Git, logs, or the
envelope.

## Compatibility and explicit non-goals

An existing plaintext Diary body can still be read after authorization as a
legacy compatibility path, but every D8.2 create/save/recovery write emits the
authenticated envelope. Plaintext-to-envelope migration is deliberately
reserved for D8.4; D8.2 does not claim that existing plaintext has been
converted.

D8.2 does not yet claim:

- encrypted Draft/Recovery stores, browser search cache, or LinkIndex teardown;
- History/Git exclusion and non-Git Diary history;
- encrypted PDF/clipboard/export policy;
- rename/folder-move re-encryption;
- idempotent vault-wide migration or metadata cleanup.

These remain D8.3/D8.4 work and remain outside this implementation checkpoint.

## Negative behavior

Supported envelope reads fail closed for:

- unknown envelope version or algorithm;
- malformed nonce, tag, or payload;
- authentication-tag failure/tampering;
- stable identity or canonical path mismatch.

The response does not return body bytes when one of these checks fails. Ordinary
Note behavior is not routed through the Diary adapter.

## Validation recorded at this checkpoint

```text
Focused D8.2 suites: 5 files / 47 tests = PASS
Server typecheck: PASS
git diff --check: PASS
```

The focused suite covers envelope round-trip, fresh nonce behavior, tamper,
unknown version, identity mismatch, legacy read compatibility, Diary create
and read, encrypted Diary save, recovery, and unchanged ordinary Note PUT/GET
semantics. Full repository regression and CI remain release evidence for the
later D8.2 review gate.

## Review record

```text
D8.2 Self-review P0/P1/P2 = PENDING
D8.2 Independent Review    = PENDING
D8.2 closure               = NOT STARTED
```

This evidence is intentionally not a closure record. The next review must
verify that primary files and atomic temp/staging paths contain no requested
Diary plaintext, that CAS compares decrypted plaintext while committing
ciphertext, and that ordinary Note semantics remain unchanged.
