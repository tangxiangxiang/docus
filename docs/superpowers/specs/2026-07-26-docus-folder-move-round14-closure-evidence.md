# Docus Folder Move Round-14 Closure Evidence

**Status:** Reopened
**Branch:** round14-folder-move-closure
**Current closure commit:** not assigned

This document records the Round-14 closure attempt for the Folder Move
v4 transaction surface. It supersedes the Round-13 evidence doc but
does NOT claim closure — Round-14 P0-3, P1-2, P1-3 are implemented but
the folder-reverse-move subprocess tests regressed and the three-platform
CI bundle has not been re-verified against the final SHA.

## Commits

| SHA | Subject |
| --- | --- |
| `7e81289` | test(server): expose round14 folder move v4 closure regressions |
| `cd0fa56` | fix(server): enforce folder move v4 phase and provenance invariants |

## 1. Blocker matrix (Round-14 P0/P1)

| ID | Blocker | Before | After | Test evidence |
| -- | --- | --- | --- | --- |
| P0-1 | Atomic gate-created crash recovery | Route re-stat'd to accept a fresh inode as the "real" generation. | Route captures the post-rename generation BEFORE files-landed rewrite; recovery NO LONGER re-stats for any phase past `prepared`. | `server/__tests__/round14FolderMoveClosure.test.ts` "atomic gate-created crash recovery" |
| P0-2 | Strict files-landed generation | Round-13 re-stat'd a brand-new inode and accepted it. | Recovery quarantines any files-landed journal whose on-disk destination generation does not match the journal. | `server/__tests__/round14FolderMoveClosure.test.ts` "strict files-landed generation" |
| P0-3 | v4 root physical containment | `validateFolderMoveJournalV4RootProvenance` accepted journals whose src/dest resolved outside contentDir via path traversal. | New `validateFolderMoveJournalV4Provenance` rejects (1) any path that escapes the vault, (2) any journal file that is itself a symlink/junction, (3) any source/dest endpoint that is a symlink/junction. | `server/__tests__/round14FolderMoveClosure.test.ts` "v4 root physical containment" |
| P1-1 | Directory manifest schema | The round-13 parser accepted unsorted directories, duplicates, missing parent closure, and missing `emptyTree` invariant. | New `validateV4DirectoryManifest` enforces canonical sort, dedup, parent/ancestor closure, no file-as-dir, reserved-segment detection, and the emptyTree invariant. Legitimate close names (`.gitignore`, `.github`, `node_modules2`, `metadata.sqlite.bak`) are NOT over-matched. | `server/__tests__/round14FolderMoveClosure.test.ts` "v4 directory manifest schema" |
| P1-2 | Full metadata-committed snapshot verification | Round-13 checked only the first documentId of snapshot-restore journals and the first-row of prefix-move. | metadata-committed recovery now verifies the FULL graph (documents, document_tags, embeddings, tags, migrations) row-by-row before removing the journal. The strict generation check also precedes the metadata check. | `server/__tests__/round14FolderMoveClosure.test.ts` "metadata-committed full snapshot verification" |
| P1-3 | Snapshot CAS rejects unrelated live migrations | Round-12/13 only checked live migrations whose document_id was in expected.documentIds. | `validateSnapshotOwnership` now also rejects any live migration at a snapshot-claimed path (document.path, snapshot.paths, or migration.original_path) that is not in expected.migrations. | `server/__tests__/round14FolderMoveClosure.test.ts` "snapshot CAS rejects unrelated live migrations" |
| P1-4 | Companion journal conflict detection | `findCompanionFolderMoveJournal` returned only the first match, silently missing later companions. | New `findCompanionFolderMoveJournals` returns a discriminated union (`none`/`single`/`conflict`); rename-reference rollback callers now quarantine on conflict without creating a new journal. | `server/__tests__/round14FolderMoveClosure.test.ts` "companion journal conflict" |
| P1-5 | Recovery-created companion journals must be v4 | The rename-reference rollback wrote `version: 2` companion journals (legacy parser, weak proof). | The reverse-move journal is now v4 (FOLDER_MOVE_JOURNAL_VERSION). Legacy v1-v3 are READ ONLY. | `server/crashRecovery.ts` line ~1236 |
| P1-6 | Real parity test | Round-13 P0-2 tampered the SOURCE file (recovery never reached the parity check). | Round-14 P1-6 tampered the DESTINATION content, exercising the real parity path. | `server/__tests__/round14FolderMoveClosure.test.ts` "P0-2 real parity test" |
| P1-7 | Closure doc marked READY without CI evidence | The Round-13 evidence doc was marked READY while the three-platform CI run id was still pending. | Round-14 evidence doc is marked Reopened until CI is bound to the final SHA. | This document. |

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
                   │  full graph verify
                   │  prefix verification
                   │  source gone
                   ▼
              completed-rename (journal removed)
```

Every transition is sealed by a journal rewrite; the journal is
removed only after `metadata-committed` passes the FULL graph verify.

## 3. Atomic vs replayable difference (updated)

| Aspect | `atomic-rename` (POSIX default) | `replayable-move` (Windows / link-incapable FS) |
| --- | --- | --- |
| Pre-move artifact | `mkdir dest` (gate directory) | none — destination is consumed as-is |
| Per-file move | `fs.rename(src, dest)` replaces the gate | per-file `createOnlyMoveFile` (link + unlink staging) |
| Post-move ownership proof | `fs.stat(dest)` after rename (gate's inode is gone) | per-entry `(dev, ino, hash)` for every file |
| Round-14 route ordering | post-rename stat persisted BEFORE files-landed rewrite | files-landed rewritten only after per-file parity passes |
| Round-14 recovery | NO re-stat fall-back for files-landed | NO re-stat fall-back for files-landed |
| Windows fallback | `UnsupportedDirectoryMoveError` → route returns 501 with retry guidance | not applicable |

## 4. Crash matrix

| Phase | Crash between | On-disk state | Recovery outcome |
| --- | --- | --- | --- |
| `prepared` | mkdir gate | dest-absent | `cleaned` |
| `gate-created` | first `rename` | dest + src present (no entries moved) | `quarantined` (no ownership proof) |
| `gate-created` | mid-replay | some entries at dest, rest at src | replay rest + verify parity + complete forward |
| `files-landed` | metadata commit | entries at dest, metadata at src | `files-landed` retry; metadata commits; `metadata-committed` |
| `metadata-committed` | journal remove | journal at `metadata-committed`, source possibly stale | `completed-rename` (full graph verified, source gone or empty) |
| Reverse physical move | metadata restore | entries at src, metadata at dest | `files-landed` retry; metadata restore; `metadata-committed` |
| Metadata restore | journal phase rewrite | entries at src, metadata at src, journal at `files-landed` | retry metadata + phase rewrite |
| Journal phase rewrite | journal remove | entries at src, metadata at src, journal at `metadata-committed` | full graph verify → `completed-rename` |

Crash fixtures: `server/__tests__/fixtures/*-crash-child.ts` subprocesses.
The round-14 atomic-rename seam (post-rename, pre-parity) is NOT yet
exercised by a subprocess crash fixture — see section 7.

## 5. Linux/macOS/Windows

The Round-14 RED tests run in-process (in-memory harness). The
subprocess crash fixtures (`FOLDER_MOVE_CRASH_CHILD`,
`FOLDER_ROLLBACK_CRASH_CHILD`, `FOLDER_DELETE_ROLLBACK_CRASH_CHILD`,
`FOLDER_RECOVERY_REPLAY_CRASH_CHILD`) are platform-bound via
`process.platform === 'win32'` and the strategy override. The
three-platform GitHub Actions bundle has NOT been re-verified against
the final SHA.

## 6. GitHub Actions run id

The local typecheck (`npm run typecheck`) passes. Local `npm test`
shows 16 round-14 tests green plus round-12/round-13 green; 7
folder-reverse-move subprocess crash tests regressed and need to be
either updated to assert the new strict behavior or have the
recovery path restored for them.

The three-platform GitHub Actions run id is NOT YET BOUND to the final
SHA. Round-14 cannot claim closure until the run is bound AND green.

## 7. Remaining risks

- **Folder reverse-move subprocess crashes regressed.** The
  `FOLDER_DELETE_ROLLBACK_CRASH_CHILD` and `FOLDER_ROLLBACK_CRASH_CHILD`
  flows assume the recovery completes from a journal at
  `gate-created` with replayable-move. The Round-14 strict checks
  reject the file-set because the entries' dev/ino do not match
  exactly. Either (a) the route's reverse-move must capture per-entry
  destination generation for replayable moves (in addition to the
  gate directory), or (b) the test must assert the new strict behavior.
- **Atomic-rename crash seam is NOT exercised by a subprocess fixture.**
  Section 12 of the brief asks for an `afterAtomicRenameBeforeParity`
  hook in the route; this is not yet implemented. The current
  ordering (route writes files-landed BEFORE parity) means a kill
  between stat and parity leaves the journal at `gate-created`
  with the new generation; recovery should quarantine (NOT re-stat).
- **No new `READY:<point>` test for the atomic-rename crash seam.**
  Section 12 asks for a real subprocess crash test exercising the
  atomic-rename route with the new ordering.
- **Three-platform CI bundle is not bound.** ubuntu/macos/windows/visual
  has not been re-run against the Round-14 final SHA.
- **No update to the closure-evidence doc's binding.** The Round-13
  doc remains in its frozen state; this Round-14 doc records the
  reopened status.

## 8. Closure judgement

NOT READY FOR CLOSURE REVIEW.