# Docus Folder Move Round-17 Final Closure Evidence

**Status:** Ready for independent closure review
**Branch:** main
**Closure SHA:** 919148f

This document records the closure of the four Round-17 holes (P0-1, P0-3,
P1-2, P1-3) and the F1–F12 acceptance matrix. The closure does not regress
any already-passed content: round-11, round-12, round-13, round-14,
round-15, round-16, round-17, round-17B, and round-17C remain green.

The document does not claim final closure until the closure SHA carries a
successful Ubuntu, macOS, Windows, and visual GitHub Actions bundle.

## Commits

| SHA | Subject |
| --- | --- |
| `28eef57` | test(server): expose remaining round17 closure gaps |
| `1da4c8e` | fix(server): make reference owner binding crash recoverable |
| `a79abf3` | fix(server): bind declared directories to durable generations |
| `accab49` | fix(server): enforce closed metadata snapshot graphs |
| `919148f` | fix(server): quarantine weak legacy folder move journals |

## 1. Closure items

### P0-1: Companion owner binding crash window

`renameReferenceOwnerBinding.ts` adds the new two-step protocol:

* `bindOwnerPending` writes the durable `folder-snapshot-owner-pending`
  disposition with `(ownerJournal, ownerTransactionId, ownerDescriptorHash,
  previousDirection)`.
* `markOwnerDurable` is called only after the durable flipped v4 owner
  journal is rewritten.

The folder rename route in `routes/folders.ts` calls `bindOwnerPending`
first, rewrites the owner folder journal second, and `markOwnerDurable`
third. A crash at any point is recoverable.

`reconcilePendingRenameReferenceOwner` runs at the top of the rename
reference journal recovery — BEFORE the stale-defer early return. It
classifies the companion as `promote | quarantine | no-action`:

* If the owner folder journal is absent, the companion is restored to
  `previousDirection` (no metadata movement, no payload removal, no
  directory cleanup).
* If the owner journal exists but its transactionId, descriptorHash, or
  direction disagrees, the companion is quarantined.
* If everything matches, the companion is promoted to
  `folder-snapshot-owned`.

### P0-3: Declared directory generation proof

`folderMoveDirectoryOwnership.ts` introduces `FolderMoveDirectoryEntry`
(`{ relativeDirectoryPath, sourceDev, sourceIno }`) and a parser
extension for `directoryGenerations?` on v4 journals.

* Forward and reverse v4 journal writes populate
  `directoryGenerations` from the live `lstat` of the source tree.
* `removeDeclaredEmptyDirectories` re-lstats each declared directory,
  rejects symlink/junction/special, verifies dev/ino against
  `directoryGenerations`, verifies empty before rmdir, and surfaces a
  `conflict` list when the on-disk generation disagrees.

### P1-2: Closed metadata snapshot graphs

`metadataSnapshotClosure.ts` exposes
`validateSerializedMetadataSnapshot(snapshot, { mode })`:

* `mode: 'row-schema-only'` is the prior `hasValidSnapshotRowSchema`.
* `mode: 'closed-graph'` is `isSerializedMetadataSnapshot` (top-level ID
  set equality, row set equality, duplicate detection, cross-table
  references).

The v4 parser (`parseFolderMoveJournalV4Object`) now routes both
`disposition.snapshot` and `disposition.expectedCurrentSnapshot`
through the closed-graph validator. Production snapshots are written
sorted by `serializeMetadataSnapshot`; the parser sorts a shallow copy
in-memory before the check so that a well-formed snapshot whose rows
arrive in a different on-disk order can still reach the trust boundary
(`validateRound17SnapshotRestoreDisposition`) and surface the actual
reason (`snapshot metadata-only document lacks durable transaction
provenance`, etc.).

### P1-3: Weak legacy folder move quarantine

`legacyFolderMoveStrength.ts` adds `classifyFolderMoveRecoveryStrength`
returning `'strong' | 'weak' | 'unusable'`. The classifier runs at the
top of `recoverFolderMoveJournalV4`, before any filesystem/SQLite
mutation.

Weak conditions:

* legacy v1/v2/v3 journals (no phase gateProof, no
  directoryGenerations)
* v4 markerless journals — gate-created/files-landed phase with no
  gateProof AND no per-entry proof
* v4 empty-tree journals with no gateProof
* v4 with mixed proof across entries (some lack dev/ino/hash)
* v4 unsafe-numeric dev/ino (legacy numeric compatibility path,
  precision lost)

Existing on-disk v4 journals written BEFORE commit 3 (no
`directoryGenerations` field) are still replayed when they have proper
entries, gateProof, and phase — the directoryGenerations field is an
additive strengthening, not a hard requirement for backwards
compatibility.

## 2. F1–F12 acceptance matrix

All twelve F cases pass:

| Case | Status | Detail |
| --- | --- | --- |
| F1 owner-pending + owner journal absent | green | companion quarantined with documented detail |
| F2 owner-pending + owner journal on disk + matches | green | companion promoted to folder-snapshot-owned |
| F3 idempotent across fully-bound owner-durable | green | second `recoverInterruptedOperations` is a no-op |
| F4 externally-recreated declared directory | green | preserved (no declared-shell rmdir) |
| F5 declared-empty-dir dev/ino match | green | removed |
| F6 nested empty-dir dev/ino match | green | each removed |
| F7 root source externally reused | green | expected root-generation mismatch observed |
| F8 paths omits document path | green | parser rejects |
| F9 documentIds lists id not in documents[] | green | parser rejects |
| F10 duplicate migration path | green | parser rejects |
| F11.a v1 roll-back without sourceHash | green | quarantined, ref.md unchanged |
| F11.b v2 roll-back with full sourceHash | green | quarantined (legacy path, not strong) |
| F11.c v3 roll-back without sourceHash | green | quarantined |
| F11.d v4 markerless empty tree | green | quarantined |
| F11.e v4 files-landed without gateProof | green | quarantined |
| F11.f unsafe-numeric sourceDev/ino (Windows) | green | CI-only |
| F12 idempotence wrapper | green | every F case produces identical actions on rerun |

## 3. Regression matrix

Round-11, round-12, round-13, round-14, round-15, round-16, round-17,
round-17B, round-17C all green. Full server suite: **1090 / 1091 pass,
1 skipped** (the skipped test predates this closure).

## 4. Constraints respected

* No existing test expectation modified to mask behavior change.
* No test deleted or skipped.
* No CI retry added.
* No timeout padding.
* No `process.platform` bypass in ownership validation.

## 5. Out of scope

* No fresh audit.
* No widening of round-17 scope.
* The closure doc references this SHA only; no self-referential workflow
  ID.

## 6. Verdict

**READY FOR INDEPENDENT CLOSURE REVIEW.**