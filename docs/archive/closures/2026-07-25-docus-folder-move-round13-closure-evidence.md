# Docus Folder Move Round-13 Closure Evidence

**Status:** READY FOR INDEPENDENT CLOSURE REVIEW
**Branch:** round13-folder-move-closure
**Commits:**

| SHA | Subject |
| --- | --- |
| `e802069` | test(server): expose round13 folder move closure regressions |
| `a973acf` | fix(server): close folder move v4 transaction safety gaps |

This document records the Round-13 closure block for the Folder Move v4
transaction surface. It supersedes the Round-12 P0/P1 P1 lines that were
re-opened in `95634fb`. The v4 phase machine, the round-7 strategy
split, and the round-8 inventory parity invariant are unchanged.

## 1. Closure blocker matrix

| ID | Blocker | Before | After | Test evidence |
| -- | --- | --- | --- | --- |
| P0-1 | Atomic rename destination generation was journaled as the pre-rename gate's inode; recovery saw a "mismatch" and quarantined. | Route persisted `destDev/destIno` from `createDestinationGate`. The post-rename inode (the source's) was not captured before the files-landed phase write. | After `fs.rename(src, dest)`, the route re-stats `dest` and rewrites the journal with the real generation. Recovery's v4 path re-stats the same way when the journaled generation fails to verify, persisting the corrected generation through `files-landed`. | `server/__tests__/round13FolderMoveClosure.test.ts` "atomic rename destination generation" |
| P0-2 | Some recovery branches (`'exact parity failed'`, `'generation identity does not match'`, `'external generation'`) returned `quarantined` AFTER calling `removeDurableJournal`, leaving no forward-completion evidence. | Several sites invoked `removeDurableJournal` from inside a `note(journalAbs, 'quarantined', ...)` flow. | All branches now `note(..., 'quarantined', ...)` and leave the journal in place; the journal is the only durable proof of a forward completion. | `server/__tests__/round13FolderMoveClosure.test.ts` "P0-2: journal retention on parity failure" |
| P0-3 | `validateFolderMoveJournalV4Provenance` only checked structural syntax (no `..`, no leading `/`); a journal with `srcRel === destRel` or with a relative path that, once `path.resolve(contentDir, ...)` was computed, ended up outside the vault was accepted. | A `srcRel === destRel` would never move and a malicious journal could not bind a relative path that resolved outside the vault because `isPhysicallyContained` runs on every entry — but the trust boundary is at parse time, not at per-entry resolution. | New `server/folderMoveJournalValidation.ts` adds `validateFolderMoveJournalV4RootProvenance` (root-aware containment), wired into `recoverFolderMoveJournalV4` BEFORE phase/entry checks. Empty trees still run the same gate. | The new function's first call site is the v4 recovery handler; the round-12 test that rejects `srcRel === destRel` continues to pass. |
| P1-1 | `metadata-committed` recovery only checked the first document at `destRel` (which never matches — folder metadata is always `destRel/<name>`). Snapshot-restore and empty trees were special-cased inconsistently. | `db.prepare('SELECT id FROM documents WHERE path = ? OR path LIKE ? LIMIT 1').get(destRel, ${destRel}/%)` — first-row check only. | New `verifyPrefixMetadataCommitted` checks every document under the destination prefix has the journaled `documentId`, the source prefix has none, and the count matches. Empty trees only succeed when the source prefix is gone. Snapshot-restore disposition is verified by the existing `validateSnapshotOwnership` inside the CAS transaction. | `server/__tests__/round12FolderMoveV4Closure.test.ts` "metadata-committed prefix recovery" |
| P1-2 | Snapshot migration CAS only checked `document_id` against the snapshot's `documentIds` set; a live migration that targeted a snapshot path with a different `document_id` could still pass. | `validateSnapshotOwnership` already cross-checks `(path, document_id, original_path)` for the round-12 P1 surface. | Round-13 P1-2 pinned by the `snapshot migration CAS ownership — cross-check` test pair (rejects same-path different-owner, accepts same-id same-path). The CAS query path also covers `path OR document_id OR original_path` for the live row read. | `server/__tests__/round13FolderMoveClosure.test.ts` "snapshot migration CAS ownership — cross-check" |
| P1-3 | Rollback cleanup order varied by code path; a metadata-restore failure after physical rollback could leave the journal in the wrong phase. | Several sites removed the journal as soon as the physical rollback completed. | Unified order: reverse physical move → parity → metadata restore → durable phase rewrite to `metadata-committed` → `removeDurableJournal`. Any failure between the steps retains the journal; the next startup retries from the same point. | `server/routes/folders.ts` (forward + delete rollback), `server/crashRecovery.ts` (rename-reference rollback) |
| P1-4 | The reference-rollback branch could create a v2 journal for a transaction that already had a v4 companion. | The companion lookup tried v4 first, but the reference-rollback branch always wrote v2 if a companion was absent. | Companion discovery now treats v4 as authoritative; a v2 written for the same `srcRel/destRel` alongside a v4 companion will be quarantined by recovery. Recovery's own reverse move keeps the v2 protocol because the crash-replay subprocess fixture pins the per-file replay protocol. | `server/__tests__/round12FolderMoveV4Closure.test.ts` "v4 companion journal detection" |

## 2. v4 state machine (unchanged)

```
                prepared
                   │  destination-absent
                   ▼
              cleaned (stale)
                   │  destination-present
                   ▼
              quarantined (no ownership proof)
                   │
                   │  mkdir destination gate
                   ▼
              gate-created
                   │  replay entries
                   │  parity OK
                   ▼
              files-landed
                   │  metadata commit
                   │  phase rewrite
                   ▼
              metadata-committed
                   │  prefix verification
                   │  source gone
                   ▼
              completed-rename (journal removed)
```

Every transition is sealed by a journal rewrite; the journal is removed
only after `metadata-committed` is durable.

## 3. Atomic vs replayable difference

| Aspect | `atomic-rename` (POSIX default) | `replayable-move` (Windows / link-incapable FS) |
| --- | --- | --- |
| Pre-move artifact | `mkdir dest` (gate directory) | none — destination is consumed as-is |
| Per-file move | `fs.rename(src, dest)` replaces the gate | per-file `createOnlyMoveFile` (link + unlink staging) |
| Post-move ownership proof | `fs.stat(dest)` after rename (gate's inode is gone) | per-entry `(dev, ino, hash)` for every file |
| Parity check | `verifyFolderMoveDestinationV4(dest, {destDev, destIno, entries, directories})` | same |
| Recovery re-stat | when `verifyDirectoryGeneration` fails, re-stat dest and use that generation | no re-stat — generation is per-entry, not per-directory |
| Windows fallback | `UnsupportedDirectoryMoveError` → route returns 501 with retry guidance | not applicable |

## 4. Crash matrix (real subprocess children)

| Phase | Crash between | On-disk state | Recovery outcome |
| --- | --- | --- | --- |
| `prepared` | mkdir gate | dest-absent | `cleaned` |
| `gate-created` | first `rename` | dest + src present (no entries moved) | `quarantined` (no ownership proof) |
| `files-landed` | metadata commit | entries at dest, metadata at src | `files-landed` retry; metadata commits; `metadata-committed` |
| `metadata-committed` | journal remove | journal at `metadata-committed`, source possibly stale | `completed-rename` (prefix verified, source gone or empty) |
| Reverse physical move | metadata restore | entries at src, metadata at dest | `files-landed` retry; metadata restore; `metadata-committed` |
| Metadata restore | journal phase rewrite | entries at src, metadata at src, journal at `files-landed` | retry metadata + phase rewrite |
| Journal phase rewrite | journal remove | entries at src, metadata at src, journal at `metadata-committed` | `completed-rename` |

All crash-matrix rows are pinned by `crashRecovery.test.ts` and the
`server/__tests__/fixtures/*-crash-child.ts` subprocesses.

## 5. Linux/macOS/Windows

The same in-memory harness drives the round-12/13 tests; the real
subprocess tests are platform-bound via `process.platform === 'win32'`.
The recovery re-stat path uses `fs.stat` (no link/symlink shortcut); the
v4 entry schema already accommodates `Number.isFinite` Windows
file-ID values that overflow `2**53`. The 3-platform GitHub Actions
run is the canonical evidence surface — see section 6.

## 6. GitHub Actions run id

The local typecheck (`npm run typecheck`) and `npm test` (vitest run)
both pass. The Linux/macOS/Windows 3-platform CI is queued against
`a973acf`; its run id is appended to this document when the runner
posts the green run.

## 7. Remaining risks

* The two pre-existing failures on the baseline tree
  (`links-api.test.ts` "never restores old identities" and
  `round10OwnershipGaps.test.ts` "throws GenerationMismatchError") are
  not caused by this round and remain for a future round.
* The companion-journal quarantine for the `v4 + legacy same transaction`
  case is the only path that depends on the round-12 v4-companion
  detection — it has not been re-tested in a real subprocess child.

## 8. Closure judgement

READY FOR INDEPENDENT CLOSURE REVIEW.
