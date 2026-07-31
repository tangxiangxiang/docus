# Vault Git History — Final Closure

```text
Status: DRAFT — CLOSURE IN PROGRESS
Owner Approval: PENDING / BLOCKED
Final Production Baseline: NOT YET CAPTURED
Maintenance Mode: NOT ENTERED
```

This document is a live Closure record, not a closure declaration.
Production remediation has not started. Future contracts in the
[Spec](superpowers/specs/2026-07-30-vault-git-history-design.md) and
[Plan](superpowers/plans/2026-07-30-vault-git-history-implementation-plan.md)
are **not implemented on the reviewed production baseline**.

## 1. Current Baseline and Audit Chain

### Production-code review baseline

```text
00b17359d151bbdbe56115ed992700ecbb5e1ca1
```

This is the source-review baseline only. It is not the Final
Production Baseline.

No History production or test file changed between that SHA and the
starting point of this consolidation.

### Documentation audit chain observed in Git history

| SHA | Purpose |
|---|---|
| `ff2f992eb809af091bb9260846aef02ebee8519a` | reconstruct Vault Git History documentation chain |
| `adfc4d733efdf990d413022d5aa36433da4db356` | correct reconstruction review findings |
| `7b1bb2c7912869a1e8faf8c3ac40346696d99682` | correct second-round review findings |
| `de85039d01c44e1b6cc80d8baa3cc5dd2ad69d2e` | correct third-round review findings |
| `2d5ce3f8a388e957d83195a73acdc3b73dd03aaa` | record final Round 3 SHA |
| `8d6f71aba406b4e96123ddecd70b9c1d1001e17b` | update Index synchronization and Repair documentation |
| `234bbdee10734b86d5f35ef7557f073dfc376327` | finalize reconstruction review contract |
| `856f310951d95c0c97fe7883b5323e88e6b60077` | record Round 5 correction SHA |
| `d054b3c1c183694eaaa4aa80b21a40a3cd6996d7` | align final reconstruction contracts |
| `b33fbfe351bce23d69e76e564e73f4a7dc605800` | record Round 6 correction SHA |
| `15104e23c3df2a8caa18ab10ebe1f05714cc1b64` | consolidate final documentation review findings |

The Final Documentation Consolidation correction SHA above is added
by a later bookkeeping commit. A commit never records its own
not-yet-known SHA; the bookkeeping commit is therefore reported at
handoff rather than written into itself.

## 2. Current Status

| Area | State |
|---|---|
| Documentation Contract Completion | COMPLETE after the substantive and bookkeeping commits |
| Production remediation | NOT STARTED |
| Final production verification | NOT RUN |
| Owner Approval | PENDING |
| Closure | DRAFT |
| Maintenance Mode | NOT ENTERED |

The reviewed implementation remains usable but is not closable because
the findings in §4 remain open.

## 3. Delivered Scope

Everything in this section is **Observed on production-code review
baseline**.

### 3.1 Repository and read surfaces

- Git capability and first-touch Vault repository setup;
- Status, Log, Snapshot, WORKTREE, and Diff endpoints;
- logical path and ref allowlists;
- empty-repository handling;
- client History state and read-only panes.

### 3.2 Create Version

- client save and path-mutation barriers;
- exact Working Tree hash capture;
- server status re-read before byte capture;
- Temporary Commit Index seeded from old HEAD;
- plumbing tree/commit creation;
- second repository-idle check;
- CAS HEAD movement;
- immutable commit-file query before Real-Index sync;
- auxiliary sync and Repair response.

Create routine sync still uses up to three Real-Index resets and does
not implement F0/F1 path outcomes.

### 3.3 Index Repair and Withdraw

- schema-v2 Repair metadata with v1 migration and corrupt quarantine;
- normal-restart persistence;
- hand-taken `.git/index.lock` Repair;
- Repair and Withdraw synchronization publish via
  `fsync → close → rename`;
- pre-rename failure cleanup removes lock and Temporary Index;
- Withdraw preserves Working Tree bytes and uses CAS.

Repair metadata has no cross-process lost-update protection. Withdraw
has no marker check and does not fail closed on parent-resolution
errors.

### 3.4 Restore and client reconciliation

- `git restore --worktree` without `--staged`;
- one server mutation transaction inside `restoreFile`;
- client confirmation snapshot, save barrier, newer-edit
  preservation, and settled refreshes.

The route pre-reads outside the transaction and the client trusts
gesture-time `historicalRaw`, so the intended atomic snapshot contract
is not delivered.

### 3.5 Test source

History Git, route, API, composable, component, and e2e test files
exist. Their presence is not a claim that they passed for this
Closure. The Implementation Record §12 distinguishes current source
coverage from missing scenarios.

## 4. Open Closure Findings

This table is canonical across all five documents.

| ID | Finding | Severity | Status | Closure Blocker |
|---|---|---|---|---|
| H-C1 | `/status` genuine server failures are swallowed as graceful unavailable | P1 | Open | Yes |
| H-C2 | Create Version can report a successful commit as failure after refresh | P1 | Open | Yes |
| H-C3 | Routine Real-Index sync can overwrite target-path staged intent | P1 | Open | Yes |
| H-C4 | Withdraw lacks valid canonical same-vault marker enforcement | P1 | Open | Yes |
| H-C5 | Restore ref/read/write/result are not one atomic observed snapshot | P1 | Open | Yes |
| H-C6 | Short Withdraw SHA is accepted but never equals full HEAD | P2 | Open | Yes |
| H-C7 | Timeline grouping uses fixed-duration day arithmetic across DST | P2 | Open | Yes |
| H-C8 | Three-platform full-suite verification is missing | P1 (Verification) | Open | Yes |
| H-C9 | Required History regression coverage is incomplete | P1 (Verification) | Open | Yes |
| H-C10 | History filesystem reads/writes lack symlink-safe Vault containment | P1 | Open | Yes |
| H-C11 | HEAD and Withdraw parent resolution do not fail closed | P1 | Open | Yes |
| H-C12 | Cross-process History mutation and Repair metadata serialization is incomplete | P1 | Open | Yes |
| H-C13 | `ensureRepo` bootstrap is not atomically serialized and its non-overwrite check has TOCTOU | P2 | Open | Yes |
| H-C14 | Textual Git-log separator is injectable through commit messages | P2 | Open | Yes |
| H-K8 | Rename history is not `--follow`-merged | P2 | Open | No |
| H-K10 | Timeline and Log have no pagination | P2 | Open | No |
| H-K13 | SHA-256 Vault repositories are unsupported by the 40-zero CAS sentinel | P2 | Open | No |

## 5. Candidate Final Invariants

No group below is a final-baseline verification claim.

### 5.1 Verified individually on review baseline

These have direct existing test-source cases, though the full suite was
not rerun for this consolidation:

1. Create commits selected captured bytes through a Temporary Commit
   Index.
2. Create and Withdraw use CAS HEAD movement.
3. Withdraw leaves Working Tree bytes unchanged.
4. Repair takes `.git/index.lock`, verifies fingerprints, writes,
   fsyncs, closes, and renames.
5. Restore uses `--worktree`, not `--staged`.
6. newer editor edits are preserved during a pending Restore.
7. client path/Vault mutation barriers exclude overlapping in-app
   workflows.

### 5.2 Source-traceable but incompletely tested

1. all seven repository-operation markers are present in source;
   direct Create parametrization covers only `MERGE_HEAD` and
   `CHERRY_PICK_HEAD`;
2. server `withRepoMutation` is keyed by resolved Vault path, but
   same-Vault serialization plus different-Vault parallelism lacks a
   dedicated test;
3. Repair v1 migration and quarantine branches exist, but there is no
   cross-process lock or lost-update test;
4. plumbing commits bypass ordinary commit hooks and signing;
5. bootstrap intends non-overwrite behavior, but concurrent first
   touch is not protected.

### 5.3 Unimplemented closure candidates

1. symlink-safe filesystem containment;
2. fail-closed HEAD/full-commit/parent resolution;
3. atomic Vault identity and exactly one valid canonical same-vault
   marker;
4. F0/F1 path-selective routine Index synchronization;
5. complete, ordered, pairwise-disjoint Index terminal outcomes plus
   `replacementApplied`, `finalHead`, and `reconciliationRequired`;
6. F0-bound failed-path Repair and a separate persisted
   post-replacement HEAD reconciliation transaction;
7. whole-Vault cross-process mutation locking, fixed lock hierarchy,
   Repair lost-update protection, and stale-owner recovery;
8. existing-file, missing-leaf, deleted-path, and pathname-identity
   resolver modes;
9. one-entry `restoreFileAtomic` and authoritative `result.raw`;
10. Create success settlement before save-barrier release and all
    refreshes;
11. shared fail-closed ref resolvers and stable structured History
    errors;
12. marker-specific Withdraw client errors selected by code;
13. one serialized `ensureRepo` first-touch transaction;
14. machine-safe NUL-framed Log parser;
15. DST-safe grouping and explicit child-process TZ tests;
16. three-platform full-suite evidence.

The canonical marker is an accidental-withdrawal guard, not
cryptographic provenance proof.

## 6. Closure Gate

Every item must be complete on one immutable Final Production
Baseline.

### 6.1 Governance and findings

```text
[ ] Owner approves Spec and Plan
[ ] H-C1 through H-C14 are closed
[ ] H-K8, H-K10, and H-K13 are either retained as non-blocking scope
    or changed only with Owner approval
[ ] Final Production Baseline SHA is captured
```

### 6.2 Required regression evidence

```text
[ ] F0 captured before HEAD move
[ ] pre-staged and F0→F1 changed paths preserved
[ ] mixed safe/preserved path classification
[ ] complete pairwise-disjoint path partition in request order
[ ] Repair created only for failedPaths and bound to F0
[ ] no-lock/no-write/all-preserved branches
[ ] index.lock cleanup after Temporary Index and verification failure
[ ] close-before-rename and external git add after each failure
[ ] no rename after fingerprint mismatch
[ ] no Temporary-Index-only or pre-rename partial synchronized result
[ ] post-rename HEAD recheck and truthful replacementApplied result
[ ] persisted post-replacement reconciliation can be retried/discarded
[ ] no F0-bound Repair after an already-published replacement

[ ] symlink leaf and directory-segment rejection
[ ] no outside-Vault hash, commit, WORKTREE file/diff, or Restore
[ ] selected deletion without realpath of an absent leaf
[ ] verified untracked/missing-leaf Create and initially absent Restore
[ ] parent and pathname identity rechecked around the final operation
[ ] replaced pathname never returns unreachable-inode bytes

[ ] unborn HEAD distinguished from operational failure
[ ] 7–40 hex request resolved to one full immutable SHA
[ ] C6 adapts to the single shared C11 resolver
[ ] strict root/one-parent/merge parsing
[ ] no HEAD move on command failure or malformed output
[ ] stable marker/ref/parent HistoryErrorCode responses
[ ] HistoryApiError preserves status, code, message, and details
[ ] client chooses conflict UX by code with a generic legacy fallback

[ ] atomic Vault-id first touch and locked malformed-ID quarantine
[ ] exact final canonical marker block
[ ] user-body fake trailers are not authoritative
[ ] unmarked, malformed, ambiguous and cross-vault marker rejection
[ ] merge and invalid-changed-path rejection
[ ] marker-specific client UX

[ ] concurrent Repair record/settle serialization
[ ] no migration/quarantine lost update
[ ] Repair metadata lock cleanup
[ ] repair-status performs no unlocked mutation

[ ] two-process Create/Withdraw and Create/Restore serialization
[ ] older post-CAS Index publication cannot follow a newer HEAD move
[ ] fixed Vault-id/Repair/Index nested lock order and no deadlock
[ ] live Vault lock retained; positively dead owner safely recovered
[ ] indeterminate stale-lock ownership fails closed
[ ] ordinary exception cleanup and different-Vault parallelism

[ ] Restore uses one immutable SHA for read and write
[ ] post-restore observed raw/mtime identity
[ ] client uses result.raw in editor and VaultFileChanges
[ ] newer editor edits preserved
[ ] no double repository mutex
[ ] completed Restore stays successful on refresh failure

[ ] Create stays successful on Status, Log, or Comparison refresh failure
[ ] composer settles before refresh and retry cannot duplicate
[ ] Create stays successful when save-barrier release rejects
[ ] result/completion/Repair/composer settle before barrier release
[ ] barrier release runs once and cannot retain the path mutation lock
[ ] multiple auxiliary failures produce one informational warning
[ ] Withdraw stays successful on Repair-status or local cleanup failure

[ ] DST spring/fall cases under explicit child-process TZ
[ ] Log delimiter/control/multiline cases produce no phantom record
[ ] serialized bootstrap; one git init; all callers see one valid repo
[ ] bootstrap dotfile non-overwrite and safe partial-init retry
[ ] in-lock repository recheck and different-Vault init parallelism
[ ] all seven repository-operation markers
[ ] direct logical path-shape cases
[ ] same-Vault serialization and different-Vault parallelism
```

### 6.3 Final commands and platform matrix

```text
[ ] npm run typecheck
[ ] npm run build
[ ] npm test -- --run
[ ] approved History Long Flow
[ ] git diff --check
[ ] Linux full suite
[ ] macOS full suite
[ ] Windows full suite
```

## 7. Verification Evidence

### 7.1 Documentation Contract Completion

The following evidence is for documentation only and does not satisfy
the Final Production Baseline gate:

| Check | Result |
|---|---|
| source review for the seven affected contracts | PASS — current behavior remains separated from intended remediation |
| only the five authorized Markdown files changed | PASS in the worktree — `git diff --name-only 7908f3b5c296ac1223bb3ee5df7086d0f44dc9a1` listed README, Spec, Plan, Implementation Record, and Draft Closure only; the required `...HEAD` recheck remains pending until the substantive commit exists |
| `git diff --check` | PASS — exit 0, no output |
| code-fence-aware relative Markdown links | PASS — 43 relative links resolved across the five documents; fenced code ignored |
| prohibited stale terminology scan | PASS — the required stale-contract expression set returned no matches (exit 1) |
| finding-ID/title/severity/blocker consistency | PASS — 17 canonical findings matched in all four finding tables; all 14 blockers matched in README |

### 7.2 Production verification

```text
npm test -- --run: NOT RUN
npm run typecheck: NOT RUN
npm run build: NOT RUN
History Long Flow: NOT RUN
Linux/macOS/Windows matrix: NOT RUN
```

No CI result is asserted. Existing CI configuration is not a completed
verification run.

## 8. Accepted Risks

No Accepted Risk has Owner Approval.

These items may not be accepted or downgraded:

- symlink escape;
- staged-intent loss;
- fail-open HEAD or parent resolution;
- cross-process mutation interleaving or Repair lost update;
- successful commit reported as failure;
- invalid-marker withdrawal;
- silent editor/disk divergence;
- any unverified power-loss durability claim.

Only these current non-blocking candidates may be considered later:

- H-K8 rename history not `--follow`-merged;
- H-K10 no Timeline/Log pagination;
- H-K13 no SHA-256 Vault support.

## 9. Maintenance-Mode Rules (Candidate)

These rules are inactive until Closure is CLOSED and Owner Approval is
recorded.

1. Every server-side mutation enters exactly one repository mutation
   transaction and applies the operation-state check appropriate to
   that operation.
2. Every HEAD-moving mutation performs a second repository-idle check
   immediately before CAS `update-ref`.
3. Restore and Repair are not HEAD-moving mutations and are not
   described as requiring that second pre-`update-ref` check.
4. Create uses a Temporary Commit Index and never stages a version
   through the Real Index.
5. Routine Index sync preserves pre-existing and concurrent staged
   intent path by path.
6. Only Failed Sync Paths can create a Repair Transaction.
7. Restore changes Working Tree only and returns the post-restore
   snapshot observed in its transaction.
8. Withdraw requires exactly one valid canonical same-vault marker.
9. The marker remains an accidental-withdrawal guard, not
   cryptographic provenance proof.
10. Every mutating History operation enters one cross-process Vault
    mutation lock exactly once.
11. Nested locks always follow: Vault mutation, Vault-id creation,
    Repair metadata, then Git `index.lock`.
12. Live or indeterminate Vault-lock ownership is never removed;
    recovery requires positive same-host dead-owner proof and nonce
    comparison.
13. All migration, quarantine, and Repair read-modify-write metadata
    operations hold the dedicated metadata lock under the Vault lock.
14. Regression tests and the approved verification matrix accompany
    every safety-contract change.

## 10. Final Closure Procedure

1. Implement C1–C7 and C10–C14 in dependency order.
2. Complete and pass the C9 aggregate regression gate.
3. Run C15 once on one immutable candidate SHA.
4. Use C15 evidence to close H-C8.
5. Capture the Final Production Baseline through C16.
6. Obtain Owner Approval.
7. Close or explicitly retain only approved non-blocking H-K risks.
8. Enter CLOSED / Maintenance Mode through C17.

Until every step is complete:

```text
Status: DRAFT — CLOSURE IN PROGRESS
Owner Approval: PENDING / BLOCKED
Final Production Baseline: NOT YET CAPTURED
Maintenance Mode: NOT ENTERED
```
