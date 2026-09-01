# D8.4 Implementation Evidence — Diary Migration & Legacy Cleanup

Date: 2026-09-01

This record documents the owner-authorized fast-closure implementation pass. It
does not claim that an independent planning or implementation review occurred.

## Lifecycle authorization

```text
D8.4 Planning Round 3 implementation authorization:
OWNER-OVERRIDE / IMPLEMENTATION AUTHORIZED

D8.4 implementation:
IMPLEMENTED / COMPLETE / FROZEN
```

The historical planning-review findings and pending Round 3 review record are
unchanged. The owner waived that process-only gate for this implementation run;
the frozen security contract was not waived.

## Provenance

```text
Prompt starting HEAD: 85a75e0e83cdd177d5caa1707bd2273df16ffa7d
Authorized checkout base: ac6d54400ebaab9c53a0fd905e93897ab2d94cd7
Branch: main
```

The checkout had legitimately advanced from the prompt's starting SHA before
implementation. No reset or history rewrite was performed.

Implementation commit: `7d3420f` (`Implement D8.4 Diary migration and legacy cleanup`)

## Implemented owners

- `DiaryMigrationService` is the single migration decision owner and composes
  the existing `DiaryAccessService`/`DiaryBodyOperation` lease.
- `DiaryMigrationFs` performs safe regular-file inspection, ciphertext-only
  candidate creation, exact fingerprint readback and file/parent durability
  barriers. It never renames, unlinks, restores or replaces a POSIX plaintext
  primary.
- Immutable inventory revisions, action-scoped consent and structural state are
  stored in SQLite migration `0012`.
- Dedicated authenticated/no-store migration routes and a Settings workflow
  provide scan, start, resume, item resolution, draft disposition, Git
  acknowledgement and residual disclosure.
- Startup invokes migration recovery immediately after generic interrupted
  operation recovery and before History reconciliation or HTTP availability.

## Schema

`server/migrations/0012_diary_migration_ledger.sql` creates the exact planned
`diary_migration_runs`, `diary_migration_items` and
`diary_migration_consents` tables and their indexes/checks. Ledger fields are
structural only: no body, body size/hash, key, capability, message content or
secret material is persisted.

## Platform behavior

- Windows: the native handle-bound adapter is not available in this JavaScript
  build, so capability selection safely falls back to
  `USER_FINALIZE_REQUIRED`; no pathname rename/delete fallback is attempted.
- Linux/macOS: legacy plaintext remains authoritative while a durable,
  authenticated ciphertext candidate is prepared. The UI instructs the user to
  perform the external file replacement and then resume verification. A
  different inode is accepted only when the exact candidate fingerprint and
  V1 AAD authentication succeed.

## Residual and unsupported behavior

- User-controlled plaintext copies, external backups and Git history are
  disclosed residuals; D8.4 does not rewrite Git or claim forensic erasure.
- Managed browser Draft/Recovery rows remain outside the server ledger. The
  Settings bridge conditionally imports them through an encrypted primary or
  requires the literal typed discard confirmation; changed rows remain
  `CONSENT_REQUIRED`/attention.
- Existing D8.3 managed-Diary persistent Draft writes remain disabled. No new
  persistent encrypted Draft Store V2 is introduced.

## Validation

Validation results are filled in during the final implementation pass before
the push. No independent-review PASS is inferred from local tests or CI.

```text
Focused D8.4 tests: PASS — 4 files, 12 tests
Full `npm test`: PASS — unit 244 files/3618 passed/9 skipped; History 5 files/178 tests; Recovery 5 files/198 tests
Typecheck: PASS — client and server
Build: PASS — Vite production build (existing dependency/chunk warnings only)
Icon lint: PASS exit code; reports 8 hard/6 soft pre-existing violations outside D8.4
Browser E2E: PASS — `e2e/diary-release.spec.ts` (7/7); no dedicated D8.4 migration browser config exists
CI: recorded after push
```
