# Docus Folder Move Round-14 / Round-15 Closure Evidence

**Status:** Reopened
**Branch:** codex/round15-folder-move-recovery-closure
**Current closure commit:** not assigned

This document records both the reopened Round-14 attempt and the
Round-15 recovery closure work. Sections 1–8 retain the historical
Round-14 evidence. Sections 9 onward are authoritative for Round-15.
The document does not claim closure until the final pushed SHA has a
successful Ubuntu, macOS, Windows, and visual GitHub Actions bundle.

## Commits

| SHA | Subject |
| --- | --- |
| `7e81289` | test(server): expose round14 folder move v4 closure regressions |
| `cd0fa56` | fix(server): enforce folder move v4 phase and provenance invariants |
| `1401b43` | test(server): expose round15 folder move recovery closure gaps |
| `32e9371` | fix(server): recover landed atomic folder moves from gate-created journals |
| `c502124` | fix(server): enforce exact metadata snapshot ownership before restore |
| `cdf774e` | fix(server): run all recovery folder companions through the v4 executor |

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

## 9. Round-15 findings and fixes

| ID | Finding | Round-15 resolution | Evidence |
| --- | --- | --- | --- |
| P0-1 | Atomic rename could land while the journal remained `gate-created` with the old gate inode. Recovery treated the correct destination source generation as foreign. | `resolveAtomicGateCreatedState` distinguishes an intact empty gate from a landed original-source generation. Only those two ownership proofs proceed. | Round-14 corrected test; Round-15 real atomic subprocess crash test. |
| P0-2 | A post-rename destination `stat` failure deleted the only recovery journal. | The shared executor throws `AtomicRenameLandedGenerationReadError` and never deletes the gate-created journal. The route returns 500 without entering rollback. | Round-15 injected post-rename stat failure test. |
| P0-3 | `metadata-committed` cleanup verified generation and metadata but not the complete physical tree. | Cleanup now verifies directory generation plus exact files, file dev/ino/hash, directories, and absence of undeclared content before journal removal. | Missing file, extra file, replaced inode, missing directory, and extra directory tests. |
| P1-1 | A root-level `a.md` with `directories=[]` was rejected before recovery reached the intended branch. | The invalid blanket rule was removed. Parent closure starts at path segment 1, so root files require no directory entry and nested files still require every parent. | Round-15 root/nested manifest tests. |
| P1-2 | Broad `some(action === "quarantined")` assertions could pass for provenance instead of the target invariant. | New Round-15 parity tests bind to the exact `metadata-committed destination exact parity failed` detail; the landed atomic test requires `completed-rename`. | `round15FolderMoveRecoveryClosure.test.ts`. |
| P1-3 | Recovery-created v4 companions still ran the legacy gate-token executor and removed the journal before metadata. | `executeFolderMoveV4Physical` is the only physical executor for the route, rename reverse rollback, delete rollback, and recovery-created reference companion. | Shared executor call-site audit and crash suite. |
| P1-4 | Snapshot CAS compared only selected identity columns. | Every live row in documents, tags, document_tags, document_embeddings, and metadata_migrations must be a canonical, full-column match for an expected snapshot row. Binary values compare by base64. | Round-15 full-row drift matrix. |
| P1-5 | Seven reverse-move subprocess scenarios regressed under the Round-14 strict validator. | Reverse folder-rename filenames are accepted only when bound to one of the same-parent transaction endpoints, companion document paths bind to their current physical source, and all reverse moves use durable v4 phases. | `crashRecovery.test.ts`: 125/125, including all reverse subprocess cases. |
| P1-6 | No real subprocess seam existed after atomic `fs.rename` and before stat/parity/files-landed. | `afterAtomicRenameBeforeParity` fires at that exact location. The child emits `READY:ATOMIC_RENAME_LANDED`, exits 92, and startup recovery completes twice idempotently. | `folder-atomic-after-rename-crash-child.ts`. |

## 10. Atomic gate-created decision table

| Source | Destination | Proof | Outcome |
| --- | --- | --- | --- |
| Original source generation | Empty recorded gate generation | Rename not landed | Atomic rename, require destination = original source generation, exact parity, continue. |
| Absent | Original source generation | Rename landed | Exact parity, rewrite `files-landed` with final generation, continue. |
| Any other state | Gate/source proof fails | Ownership ambiguous or external | Quarantine; retain journal; do not mutate metadata. |

## 11. Round-15 v4 phase state machine

```text
prepared
  -> create destination gate
  -> durable gate-created
  -> atomic rename OR replayable entry moves
  -> exact physical parity
  -> durable files-landed
  -> prefix metadata move OR snapshot CAS restore
  -> durable metadata-committed
  -> final generation + physical parity + metadata graph + source check
  -> journal removal
```

Every executor error retains its journal. Only verified stale
`prepared` recovery and verified `metadata-committed` finalization
remove a v4 journal.

## 12. Shared executor call sites

| Call site | Physical direction | Metadata disposition |
| --- | --- | --- |
| Folder rename route | old path -> new path | prefix move |
| Folder rename compensation | new path -> old path | prefix move back |
| Folder delete rollback | delete staging -> public path | snapshot restore |
| Rename-reference recovery companion | rename destination -> original source | prefix move back |

## 13. Snapshot CAS matrix

Round-15 rejects external drift in:

- document title, summary, created_at, and updated_at;
- tag name and normalized_name;
- document_tags row replacement;
- embedding content_hash, model, binary embedding, and indexed_at;
- migration original_path, status, source_hash, error, and updated_at.

Missing expected rows remain recoverable: rollback may restore them.
Any live row in the owned footprint must otherwise match all columns.

## 14. Local Round-15 verification

Verification against code commit `cdf774e1b13a3a44bcd7446a505f1f1e06ae3f8c`:

| Command | Result |
| --- | --- |
| `npm run typecheck` | success |
| `npm run build` | success |
| `npm test` | 146 files passed; 2259 tests passed |
| `npx vitest run server/__tests__/round14FolderMoveClosure.test.ts server/__tests__/round15FolderMoveRecoveryClosure.test.ts` | 2 files; 40 tests passed before the added stat-failure case, then Round-15 alone 25/25 |
| `npx vitest run server/__tests__/crashRecovery.test.ts` | 125/125 |

The initial RED run produced 22 failures across the Round-14/15 target
set. It showed provenance short-circuiting the landed atomic branch,
metadata-committed cleanup removing journals for missing/extra tree
content, and CAS accepting full-row drift.

## 15. Round-15 CI binding

Final SHA: not assigned.

Workflow run ID: not assigned.

| Job | Job ID | Conclusion |
| --- | --- | --- |
| Ubuntu | not assigned | pending |
| macOS | not assigned | pending |
| Windows | not assigned | pending |
| visual | not assigned | pending |

## 16. Round-15 remaining risks and judgement

- GitHub Actions has not yet been run against the final documentation
  commit, so platform and visual evidence is still pending.
- The build reports existing bundle-size and third-party PURE annotation
  warnings; neither warning fails the build or touches folder recovery.

NOT READY FOR CLOSURE REVIEW.
