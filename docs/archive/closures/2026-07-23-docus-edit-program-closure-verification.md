# Docus Edit Program — Closure Verification Evidence

**Date:** 2026-07-23  
**Reviewed baseline:** `c21c957000c20fea2cec24328d36097122e1e2ad`  
**Closure status:** Reopened; this file is verification evidence, not a seal.

## State-machine audit

Legend: `P` public path, `S` staging, `Q` permanent quarantine, `J` journal/manifest, `M:s|d|—` metadata at source/destination/detached. “Re-crash” describes the next startup, not an in-process retry.

| Protocol / phase | P | S / Q / payload | J phase | Metadata | First Recovery | Re-crash behavior / reverse-check test |
|---|---|---|---|---|---|---|
| replace: prepared | old | save | none | unchanged | journal-less save is removed only if P exists; otherwise retained | stable; orphan rules |
| replace: journaled, pre-takeover | old | save | replace | unchanged | hashes/paths validate; stale intent cleaned | idempotent; subprocess `journal` point |
| replace: takeover | missing | staged old + save | replace | unchanged | both hashes match → publish save create-only; mismatch/missing → restore staged and quarantine uncertain save | repeatable pending/manual phases; subprocess `takeover` point |
| replace: external P wins | external | staged old + save | replace | unchanged | never overwrite P; retain staged; save becomes quarantine; J becomes manual | second/third runs report only |
| replace: cleanup | new/old | partial quarantine | pending/manual | unchanged | pending accepts either old/new payload name; manual never deletes | multi-run tests |
| file rename: journaled | source | none | file-rename | M:s | validate source-bound J, documentId and sourceHash | invalid artifacts untouched |
| file rename: takeover | missing | rename staging | file-rename | M:s | matching S restores source create-only | subprocess `takeover` |
| file rename: destination linked | destination (+ S until unlink) | optional S | file-rename | M:s | matching destination completes M:s→d; cleans S/J | both pre/post staging-removal subprocess points |
| file rename: source reused | external source + owned destination/S | S or none | file/reference J | M:d or CAS-reconciled | external source wins; old ID remains with owned destination; references finish forward | source-reuse tests |
| folder rename: pre-move | source generation | optional gate | folder-rename | M:s | inode/dev source proof; reverse premature M:d→s | repeated startup stable |
| folder rename: post-move | destination generation | none | folder-rename | M:s/d | inode/dev destination proof; finish M:s→d | parent fsync precedes metadata; replay idempotent |
| folder rename: external destination | external destination | none | folder/reference J | stale M:d possible | inode mismatch: do not move refs/prefix; identity-list CAS detaches old rows | external-generation regression |
| rename refs: preparing | main rename not authoritative yet | zero/partial/all declared payloads | preparing | unchanged | remove only declared payloads; J removed last | 5 exact SIGKILL payload points; 3 runs stable |
| rename refs: roll-forward, main pending | source/staging/destination per main J | full payload set | roll-forward | M:s/d | main J category runs first, then references | both lexical journal orders |
| rename refs: roll-forward, partial refs | owned destination; optional external source | full payload set | roll-forward | M:d | afterHash skips; beforeHash CAS-writes; third-party hash stops with evidence | deterministic + random-state tests |
| rename refs: roll-back, main at destination | destination | full payload set | roll-back | M:d | refs after→before, create-only destination→source, M:d→s, cleanup | reproduced red on baseline; fixed regression |
| rename refs: roll-back, source reused | external source + owned destination | full payload set | roll-back | M:d | durably switch forward; finish refs without touching external source | 3-run source-reuse regression |
| rename refs: rollback source restored | source | full/partial payload | roll-back | M:s or M:d | finish refs; if needed M:d→s; cleanup | repeated startup stable |
| rename refs: cleanup | final source/destination | partial/missing payload | cleanup | final | missing is idempotent; delete remaining payloads; J last; real removal error retains J | exact cleanup SIGKILL points |
| file delete: in-flight | missing | inflight file | none | old/— | detach metadata first, then delete last bytes | crash between steps replays from inflight |
| folder delete: in-flight | missing | inflight tree | none | old/— | detach prefix first, then delete tree | repeatable until tree removal succeeds |
| delete path reuse | external P | inflight→Q | delete manifest with old IDs | stale old possible | fsync Q, documentId-CAS detach only old identities, remove manifest | new identity never deleted |
| metadata-less delete reuse | external P | Q | no empty manifest | none | no identity replay required; migration creates fresh ID | empty forged manifests are invalid |
| legacy quarantine | empty/external P | legacy→Q | permanent legacy manifest | stale old possible | conservative Q; documentId-CAS detach; keep association manifest | never auto-delete Q |

## Invariant reverse-check

1. Unique content: create-only publication/restoration or retained staging/quarantine; ambiguous generations are never auto-deleted.
2. Identity follows generation: rename journals bind `documentId`; path reuse uses ID-CAS detach; folder reference journals carry the subtree identity set.
3. First startup: main rename journals are categorized before reference journals; interrupted reference rollback now moves the main generation and metadata in the same run.
4. Repeatability: pending/manual/cleanup phases are replayable; deterministic tests run Recovery three times.
5. External priority: content writes use ownership takeover + create-only commit; unsupported hard-link behavior now fails closed rather than falling back to check-then-rename.
6. Direction agreement: reference direction is durable before compensation; source reuse switches durably to forward; evidence remains on conflict.
7. Artifact trust: source directory/basename, Vault syntax/containment, SHA-256 shape, identity scope, unique paths and payload names are validated before referenced paths are touched.

## Baseline failures reproduced

- `roll-back` + main file still at destination was left ambiguous on first startup.
- externally replaced document/folder destinations retained old SQLite identities.
- unsupported hard-link fallback overwrote a destination created after its existence check.
- malformed replace hashes, empty delete identities, missing file-rename documentId, duplicate reference paths and malformed hashes caused artifact deletion or state transitions instead of quarantine.

Closure remains Reopened until the committed production SHA has independent Linux/macOS/Windows Actions results and the complete browser/test matrix is green.

## Cross-platform verification result

GitHub Actions run [`29974478406`](https://github.com/tangxiangxiang/docus/actions/runs/29974478406)
proved the Linux and macOS matrices green, but produced a Windows safety
counterexample. Node's Windows `rename()` replaced an occupied destination
instead of providing create-only directory-move semantics. The failing tests
showed an external destination file/tree disappearing. That implementation was
removed in `b932e3726fb42bbb54b606fcbc03dd8b19d17a2d`; Windows folder moves now
fail closed through the existing mkdir-gate path rather than risk user data.

This is a real remaining product limitation, not a skipped test: Windows needs
a replayable create-only folder-move protocol before the cross-platform matrix
can pass. The final Closure document therefore remains `Reopened` with no
closure commit assigned.

## Round-6 remediation and full-matrix verification

Production commits: `3f50343` (replayable move + handshake + containment +
content proof), `fe01c60` (deterministic models + CI bundle),
`3eff1d5` (Windows large-file-ID parser fix + platform-correct delete-rollback
injections).

The Windows blocker above is resolved by a replayable create-only directory
move: the durable folder-rename journal (with every entry's content hash) is
written first, files then move one at a time via create-only `link(2)` under
relative paths behind a `mkdir` gate, an end-to-end parity check runs before
source pruning, and any crash leaves a SPLIT tree that startup recovery always
completes forward. Any symlink/junction/special entry fails closed with a typed
501; any external writer winning a destination path rolls the whole move back.
The crash tests now prove the kill itself: children announce `READY:<point>` at
their hook, the parent force-kills only after that line, and the exact
crash-state on disk is asserted BEFORE recovery runs — the old harness accepted
any non-zero exit, which on Windows would have let a normally-completing child
pass as "crashed". Also fixed: legacy metadata-less delete artifacts no longer
write unparseable `{identities:[]}` manifests; journal provenance is physically
contained (lstat ancestor walk + leaf, so vault-relative symlinks/junctions
cannot route a reference path outside); folder reference journals carry
per-identity content hashes verified at recovery; three new deterministic
models (1100 seeds, in the three-platform CI crash bundle) randomize
replayable folder-move splits, folder-reference content proof, and legacy
delete promotion — the folder-move model caught and fixed a real gap
(all-entries-at-source recovery skipped the destination→source metadata
rollback). Fixes carry mutation checks M11–M17, each verified RED then
restored.

The CI run bound to `3f50343`/`fe01c60` (run `29979470511`) failed ONLY on
Windows and exposed a Windows-native production bug invisible to the local
POSIX matrix: the folder journal parsers required `Number.isSafeInteger`
dev/ino, but Windows volumes with large file records (NTFS extended IDs,
ReFS/Dev Drive) report file IDs beyond 2**53, orphaning every production folder
journal on such volumes; the parsers now accept any finite number, with
platform-independent regression tests forging beyond-2**53 IDs. Two
Windows-only test-harness gaps were fixed with it (basename-scoped removal
injection; mkdir-gate contention injection shared by both platforms).

GitHub Actions run [`29980532044`](https://github.com/tangxiangxiang/docus/actions/runs/29980532044)
on `3eff1d5dad87105dd627131b76e034d970f7e9c8` is the first fully green
three-platform run since the reopening: `verify (ubuntu-latest)` success,
`verify (macos-latest)` success, `verify (windows-latest)` success, `visual`
success. Local gates at the same tree: typecheck clean; vitest 141 files /
2141 tests; crash bundle ×2 at 132 tests each; cross-platform browser E2E 20;
Draft Store E2E 38; app E2E 22; vault debris scan clean; zero mutation markers.

This is verification evidence, NOT a new seal: the program verdict stays
`Reopened / fixes implemented; fresh closure verification pending` until the
reviewer confirms the closure round.

## Round-7 remediation (source-composition review) and verification

Production commits: `bafe32e` (fix), `9b9c2ae` (tests).

The reviewer's source-composition audit of the round-6 tree found five issues;
all are fixed in `bafe32e` with mutation-verified tests (M18–M25):

1. **Strategy schema drift (P0).** The route persisted `strategy:
   'replayable-move'` / `'atomic-rename'` (the runtime enum), while the
   recovery parser only accepted `'replayable'` / `'atomic'` — every real
   folder-rename journal would have been rejected as unrecognized after a
   crash. Both sides now share one `FolderMoveJournalStrategy` type
   (`server/documentFileLifecycle.ts`); the parser accepts the canonical
   values and normalizes the legacy short spellings; a tying test asserts the
   parser accepts every value `platformDirectoryMoveStrategy` can emit.
2. **Journal covers every physical file (P1).** `listPhysicalMoveEntries`
   enumerates every regular file (markdown AND attachments, buffer-hashed
   with `sha256HexBuffer`), with `documentId`/`documentPath` attached only to
   markdown documents; recovery replays `relativeFilePath` verbatim and never
   appends `.md`. Empty trees carry `emptyTree: true` with `entries: []` and a
   dedicated recovery path (stale gate prune vs. completed-forward) instead of
   an unparseable empty entries array.
3. **Every replayable reverse move is journaled (P1).** Rename rollback
   durably flips the main journal's direction (srcRel↔destRel) BEFORE the
   first reverse file moves, so a mid-rollback crash replays to completion
   instead of stranding a split tree no journal describes. Reference-recovery
   rollback and folder-delete rollback each write their own folder-move
   journal first (delete rollback persists the metadata snapshot, so recovery
   re-installs the full graph); the delete-inflight orphan rule stands down
   while a companion journal exists. Real SIGKILL crash children cover:
   rollback after the first file, mid-rollback, after-all-files-before-
   metadata, delete-rollback mid-move, and recovery itself killed mid-replay.
4. **Self-reference generation proof (P1).** `folderGenerationMatches` now
   looks up an internal backlink document's after-hash by its DESTINATION
   identity path (`destRel + suffix`), not the source path, so an
   already-rewritten internal document is recognized as ours instead of being
   quarantined as an external generation with its identity detached.
5. **Mixed hash coverage rejected (P2).** A folder-reference journal with
   some identities hashed and some not no longer parses — a stripped hash can
   no longer silently downgrade the whole tree to the weak dev/ino+existence
   proof.

The crash children now drive the REAL HTTP route (`app.fetch(PATCH
/api/folders/...)` with a test-only strategy override to force the replayable
protocol on any platform) instead of hand-copying the journal JSON, so the
fixture can no longer drift from production.

GitHub Actions run [`29988809662`](https://github.com/tangxiangxiang/docus/actions/runs/29988809662)
on `9b9c2ae0d665d7c9f91ef7555edfce09d74a25cd` (contains production tree
`bafe32e`): `verify (ubuntu-latest)` success, `verify (macos-latest)` success,
`verify (windows-latest)` success, `visual` success — the first green
three-platform run including all round-7 fixes. Local gates at the same tree:
typecheck clean; vitest 141 files / 2156 tests; crash bundle ×2 at 147 tests
each; cross-platform browser E2E 20; Draft Store E2E 38; app E2E 22; vault
debris scan clean; zero mutation markers.

This is verification evidence, NOT a new seal: the program verdict stays
`Reopened / fixes implemented; fresh closure verification pending` until the
reviewer confirms the closure round.

## Round-8 remediation (source-composition review) and verification

Production commits: `e5bea53` (snapshot trust + containment + destination
merge + directories + reverse-move durability), `c61737c` (recovery
multi-pass bound); tests `438af88`; CI-stabilization `b8a7483`, `5b211a5`,
`bf28078`, `c87802f`, `81b49e8`, `9e0d501`.

The reviewer's next source-composition audit found six further issues in the
v2 folder-move journal; all are fixed with mutation-verified tests (M26–M32):

1. **snapshot-restore trust boundary (P0/P1).** A persisted delete-rollback
   snapshot is now scoped at parse time (`isValidDeleteRollbackSnapshot`):
   every path inside the restored folder's subtree, `documents[].path`/`id`
   cross-referencing the declared paths/ids exactly, `document_tags`/
   `embeddings` referencing only those ids, `tags` matching the declared
   tagIds, `migrations` referencing only the transaction's paths/ids, and
   every row carrying exactly its table's columns — so a forged journal can
   no longer delete or replace unrelated metadata (a malicious-journal test
   proves `unrelated/*` rows are untouched). `preexistingTagIds` is
   recomputed against the live DB at restore so the orphan-tag cleanup
   cannot be weaponized.
2. **Nested symlink/junction containment (P0/P1).** Recovery
   containment-checks every folder-move entry's source AND destination
   path (lstat walk of existing ancestors, rejecting any symlink — Windows
   junctions report as symlinks) before hash/mkdir/rename/link, so a
   symlinked subdir planted after the journal was written cannot route a
   touch outside the vault (shared with the mover; not-yet-created
   ancestors are skipped and made as real directories).
3. **Destination generation merge (P1).** Recovery inventories the
   destination before replaying: every present file must be a hash-matched
   landed entry, every directory a declared one, the only other allowed
   entry the mover's hidden gate token; any undeclared file/symlink/special
   entry quarantines instead of merging, and an otherwise-empty destination
   is provably ours only via its gate token, never by emptiness alone.
4. **Nested empty directories (P1).** The journal records `directories[]`
   (every subdir including empty ones); the mover and recovery recreate and
   parity-check the set, so empty directory nodes survive Windows replayable
   moves.
5. **Reverse-move durability (P1).** For the replayable protocol the journal
   direction flip is a hard precondition of the reverse move: if it cannot
   be persisted, not one file moves (the tree stays forward-consistent with
   both journals preserved for recovery); atomic moves — a single rename,
   never split — still proceed.
6. **Recovery pass bound (P1/P2).** `recoverInterruptedOperations` loops
   until a pass makes no NEW DISTINCT progress (a re-noted retained journal
   is not progress), capped by the startup artifact count plus headroom
   (hard ceiling 64), so arbitrarily deep crash-dependency chains (inner
   `.docus-rename-*` staging → companion folder-move journal → reference
   journal) close in one startup instead of stranding behind a fixed
   two-pass scan (a three-layer chain test proves it).

The bound CI runs additionally exposed platform-specific test-harness issues
(no production-behavior change beyond efficiency): the multi-pass loop's
separate pre-scan walk was the dominant cost on slow Windows fs (folded into
the first pass); the deterministic models compared trees in NTFS-unstable
readdir order, tore down with a Windows-transient `fs.rm`, and ran to the
120s ceiling (sorted comparison, a retrying teardown, 240s ceilings); a
cold-cache flake in an unrelated markdown-render smoke test (waits on the
render condition); slow real-git tests hitting the 5s default on Windows
(explicit ceilings, matching their siblings); and a draft-store IndexedDB
blocked-open test whose late version-change resume stalls under CI load
(every step bounded, with the deletion assertion as arbiter — a real leak
still fails).

GitHub Actions run [`30002043137`](https://github.com/tangxiangxiang/docus/actions/runs/30002043137)
on `9e0d501944302f219d1c5a846a07341293e92094`: `verify (ubuntu-latest)`
success, `verify (macos-latest)` success, `verify (windows-latest)` success,
`visual` success — the first green three-platform run including all round-8
fixes. Local gates at the same tree: typecheck clean; build clean; vitest
141 files / 2164 tests; crash bundle ×2 at 154 tests each; cross-platform
browser E2E 20; Draft Store E2E 38; app E2E 22; vault debris scan clean;
zero mutation markers.

This is verification evidence, NOT a new seal: the program verdict stays
`Reopened / fixes implemented; fresh closure verification pending` until the
reviewer confirms the closure round.
