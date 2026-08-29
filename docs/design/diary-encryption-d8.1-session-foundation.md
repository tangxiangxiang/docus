# D8.1 — Secondary Password + Diary Session Foundation

## 1. Status

```text
D8 overall                 = IN PROGRESS
D8.0                       = REVIEW-CLOSED
D8.1                       = REVIEW-READY
D8.1 Self-review           = PASS (0/0/0)
D8.1 Independent Review    = PENDING
D8.2                       = NOT STARTED
D8.3                       = NOT STARTED
D8.4                       = NOT STARTED
D8 Mood encryption         = OUT OF SCOPE
```

This document records the D8.1 implementation/evidence checkpoint. It is not
a closure record and does not claim Independent Review approval. D8.1 creates
the secondary-password access foundation only; it does not encrypt Diary
bodies, migrate plaintext, change Git history, or start D8.2–D8.4.

## 2. Baseline and commits

```text
Starting HEAD:
d977fff009bdc7d5bc35dcce2226fed5f38cf227

Implementation commit:
a24ff6f874fb50e4cc3d1a045c3f5c46d4840b1a

Evidence commit:
the commit that adds this document
```

The working tree was clean at the stated starting HEAD and the implementation
was performed on `main` after fast-forward synchronization with
`github/main`.

## 3. D8.1 scope

D8.1 establishes one shell-owned Diary access session with three states:

```text
UNINITIALIZED → setup → UNLOCKED
configured startup / lock / expiry → LOCKED
```

The implementation deliberately stops before body encryption and migration.
The existing Native Vault remains the document workspace and remains the owner
of body editing, dirty state, drafts, saves, History and Recovery semantics.

## 4. Password and key hierarchy

The secondary password is validated with the existing approved password bounds
(12–256 Unicode code points) without trimming or changing its UTF-8 bytes.
D8.1 derives a Diary-only KEK through the shared bounded KDF scheduler with a
separate versioned context and a fresh 16-byte salt:

```text
KDF       = scrypt
N/r/p     = 32768 / 8 / 1
maxmem    = 64 MiB
KEK       = HMAC-SHA-256(scrypt(password, Diary salt), Diary context)
DEK       = random 256-bit value
wrap      = AES-256-GCM
nonce     = random 12-byte value
tag       = 16 bytes
AAD       = versioned Diary context + vault identity
```

The Diary context is independent from the owner-login password hash and from
the existing AI key hierarchy. Wrong passwords, malformed stored parameters,
wrong vault binding, nonce/tag failures and unsupported configuration fail
closed. Intermediate KEK material is zeroized after use; the unwrapped DEK is
held only by the server-side in-memory capability owner while unlocked.

## 5. Durable configuration contract

Migration `0011_diary_access.sql` adds the singleton
`diary_access_config` row. It stores only the data needed to re-derive and
verify the wrapped key:

- format/KDF/wrap versions and approved parameters;
- random salt, wrap nonce, wrapped DEK and authentication tag;
- vault identity and creation/update timestamps.

It never stores the secondary password, the derived KEK, an unwrapped DEK, or
Diary body bytes. First-use setup derives and wraps the random DEK before the
configuration row is inserted transactionally. Setup does not create or
rewrite a Diary file, run migration, or write body content. A concurrent second
setup loses the singleton race and cannot overwrite the first configuration.

## 6. Capability and lifecycle ownership

The server issues a random opaque capability after successful setup/unlock.
The capability is bound in memory to:

```text
authentication session id
vault identity
process-wide access epoch
unwrapped DEK
```

Only the current epoch is valid. A new setup/unlock drops older in-memory
capabilities; explicit lock increments the epoch and zeroizes the in-memory
DEK. A new server process has no capability map, so a configured Diary starts
locked even though its wrapped configuration remains durable. Auth logout,
session expiry/revocation and a server-side `diary-locked` response invalidate
the corresponding client/server capability state.

The browser stores only the opaque capability in a module-level memory value.
It is not written to `localStorage`, `sessionStorage`, IndexedDB, SQLite, a
URL, Git, logs or any persisted tab/draft record. The browser never receives
the password, KEK or DEK.

## 7. Authenticated API surface

The new routes are mounted behind the existing auth boundary and CSRF rules:

```text
GET  /api/diary/access/status
POST /api/diary/access/setup
POST /api/diary/access/unlock
POST /api/diary/access/lock
```

Responses use `Cache-Control: no-store`. The existing typed authentication
session id is the only auth identity passed into Diary access ownership; the
raw login token is not placed in route context. No login, CSRF, session cookie
or auth-provider semantics were replaced.

## 8. Shell UI and client session owner

`App.vue` owns the access dialog and the scope transition contract. The dialog
supports first-use password confirmation, unlock, cancel, Escape, focus
management and bounded password fields. `NavBar` requests access before
selecting Diary. Wrong-password and cancel paths leave the current scope and
workspace unchanged; successful setup/unlock resolves the pending explicit
Diary intent exactly once.

The shared `useDiaryAccessSession` coordinator owns client state, capability
transport and auth/server-lock invalidation. `VaultView` reuses that coordinator
and does not create a second unlock state or key owner. Account actions expose
an explicit Diary lock operation.

## 9. Exactly-one scope contract

`activeScope` remains exactly one of:

```text
note | diary | ledger
```

Selecting the current scope is a no-op. A persisted `diary` preference is
normalized to `note` before the Diary body workspace is restored and the safe
value is persisted. Diary scope is selected only after an `UNLOCKED` access
session. Lock, expiry, server-process loss and denied access normalize the
active scope back to `note`.

Calendar structural/date/existence/Mood metadata remains available through its
existing metadata ownership. D8.1 does not make the Calendar a body reader or
create a second document lifecycle.

## 10. Tabs, restore and deep links

Managed Diary paths are classified with the shared normalized
`classifyDiaryPath()` authority. Before unlock:

- persisted managed Diary tabs are deferred as paths and do not call `getPost`,
  load raw text, create an editor model, or become the active document;
- ordinary Note, Archive, Inbox, Literature and Ledger tabs keep their existing
  restore behavior;
- a managed Diary deep link requests the shell access dialog without fetching
  its body;
- wrong-password and cancel paths create no Diary tab and expose no Diary body;
- a successful unlock resumes the explicit deep-link intent once from
  memory-only state.

After unlock, deferred Diary paths use the existing Native Vault tab restore
path. D8.1 does not activate every historical Diary tab or introduce a second
tab/router source of truth.

## 11. Server body gate

The reusable Diary body guard fails closed with `423 diary-locked` for
canonical managed Diary paths unless the request carries a valid current
session-bound capability. The guard is applied before body I/O to the direct
body operations, including:

| Surface | D8.1 disposition |
| --- | --- |
| post read/create/write/recover/delete/rename | managed Diary body gated |
| Diary date resolve when it reads/creates the document body | gated |
| History content hashes, file, diff, commits and restore | gated |
| metadata cleanup/restore/export and raw migration scan | gated |
| Markdown resource body access | gated |
| AI read/write/patch/delete/rename/chat body tools | gated by the same path/capability seam |
| tree/list/files state | structural projection; managed Diary listing avoids body parsing |
| SQLite document metadata/Mood endpoints | existing metadata owner remains available |

The guard uses the shared normalized path classifier rather than a loose
`startsWith('diary/')` rule. The current LinkIndex/search/draft plaintext
policies remain explicitly deferred to their D8.3/D8.4 owners; D8.1 does not
claim to have encrypted those stores. No new body format or Git exclusion is
implemented in this phase, and no new managed Diary body revision is claimed
to be safely encrypted yet.

## 12. Lock and invalidation behavior

Explicit lock and auth/session invalidation clear the server capability and
advance the access epoch. The client clears its opaque capability, leaves
Diary scope, deactivates Diary-sensitive History/Recovery presentations and
closes managed Diary document tabs through the existing workspace owner,
discarding only in-memory/plaintext draft presentation as required by the
locked boundary. Files, SQLite Mood/metadata, stable identities and durable
configuration are not deleted.

Late async unlock/status results are guarded by the current session/capability
state. A body request that discovers the server process has lost its in-memory
capability emits the lock event so the client cannot remain visibly unlocked.

## 13. D7 and ordinary-workspace boundaries

The following contracts are preserved:

- `diary/YYYY-MM-DD.md` and one-date-one-file remain unchanged;
- Calendar remains navigation/metadata presentation, not a body reader;
- Native ReadingPane/EditorPane, tab lifecycle, save/dirty/raw owner, History
  and Recovery owner remain unchanged;
- `activePath` and route state do not grant Diary body access by themselves;
- FileTree exact context remains generic and is not Diary-hardcoded;
- Archive, Inbox, Literature, Ledger and ordinary Note semantics remain
  available without secondary Diary unlock;
- Mood remains SQLite-owned metadata and is explicitly outside D8 body
  encryption scope.

This phase adds authorization gates around existing body owners; it does not
move body ownership into the access session or create a Diary-specific Reader,
Editor, save, draft or History lifecycle.

## 14. Validation evidence

The following validations were run for this implementation checkpoint:

```text
Focused access/session/tab regression:
3 files, 110 tests PASS

Full unit suite:
238 files, 3545 tests PASS, 2 skipped

History integration:
5 files, 174 tests PASS

Recovery integration:
5 files, 193 tests PASS

npm run typecheck:
PASS

npm run build:
PASS

git diff --check:
PASS
```

The build emitted only existing dependency annotation/chunk-size warnings.
The full unit run completed successfully with no test failures. Existing
History/Recovery suites were rerun because the locked body gate changes their
authenticated fixtures; their assertions continue to pass with explicit test
capabilities where body access is intended.

Focused coverage includes:

- approved crypto/config lengths, malformed parameters, vault binding and
  restart-without-capability behavior;
- exactly-once setup, wrong-password lock retention, lock and new-capability
  epochs, auth logout and revoked-session invalidation;
- capability header transport and client lock observation;
- first-use dialog setup/unlock/cancel/Escape behavior;
- nullable-scope removal and safe persisted-scope normalization;
- deferred managed Diary tab restore and authorized deep-link restore;
- locked direct Diary/posts/History/tool body operations;
- locked structural tree/list behavior without managed Diary frontmatter reads;
- ordinary-note and existing D7 Diary/Mood route regressions.

## 15. Self-review and open D8 work

```text
D8.1 crypto/config foundation       PASS
D8.1 session/capability owner       PASS
D8.1 auth/CSRF boundary             PASS
D8.1 scope invariant                PASS
D8.1 tab/deep-link boundary         PASS
D8.1 direct body fail-closed gate   PASS
D8.1 lock/logout/expiry invalidation PASS
D8.1 ordinary workspace isolation   PASS
D8.1 no body encryption claimed     PASS
D8.1 no migration claimed           PASS
D8.1 no Git history rewrite claimed PASS

D8.1 Self-review P0/P1/P2           0/0/0
D8.1 Independent Review             PENDING
```

The following remain outside this checkpoint and must not be inferred from
the current pass results:

- D8.2 encrypted body envelope/read/write/migration;
- D8.3 encrypted draft, search, LinkIndex, History/Recovery and export policy;
- D8.4 migration, legacy compatibility, full release gate and closure;
- password change/rekey, backup/restore and client-only decryption decisions.

## 16. Final lifecycle at this checkpoint

```text
D7 overall                 = REVIEW-CLOSED

D8 overall                 = IN PROGRESS
D8.0                       = REVIEW-CLOSED
D8.1                       = REVIEW-READY
D8.1 Self-review           = PASS (0/0/0)
D8.1 Independent Review    = PENDING
D8.2                       = NOT STARTED
D8.3                       = NOT STARTED
D8.4                       = NOT STARTED
D8 Mood encryption         = OUT OF SCOPE
```

Stop here for Independent Review. Do not mark D8.1 closed and do not begin
D8.2 in this implementation/evidence checkpoint.
