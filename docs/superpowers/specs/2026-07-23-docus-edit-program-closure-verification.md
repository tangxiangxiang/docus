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
