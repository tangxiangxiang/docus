# Vault Git History — Final Closure

**Status:** DRAFT — CLOSURE IN PROGRESS

> This is a draft closure record. It defines the evidence required
> to close the Vault Git History feature, but the feature is **not**
> yet declared closed. Maintenance-mode rules in §9 do not take
> effect until this document is upgraded to **CLOSED** status.

---

## 1. Current Baseline

```text
Repository:           tangxiangxiang/docus
Branch:               main
Documentation Review Baseline (tip of main at reconstruction):
                      00b17359d151bbdbe56115ed992700ecbb5e1ca1

Spec:                 docs/superpowers/specs/2026-07-30-vault-git-history-design.md
Plan:                 docs/superpowers/plans/2026-07-30-vault-git-history-implementation-plan.md
Implementation:       docs/vault-git-history-implementation-record.md
Closure (this file):  docs/vault-git-history-final-closure.md
```

The Documentation Review Baseline is **not** the Final Production
Code Baseline. The Final Production Code SHA is the SHA recorded
under Plan History-C11 after the closure verification (see §3 of the
Plan). Marking this document as CLOSED before that SHA is recorded
is not allowed.

Production Code Review Baseline (the commit on `main` whose
production code was reviewed for this documentation chain):

`00b17359d151bbdbe56115ed992700ecbb5e1ca1`

Documentation Reconstruction Commit (first round of retrospective docs):

`ff2f992eb809af091bb9260846aef02ebee8519a` (Spec, Plan, Implementation Record, Draft Closure, README)

Documentation Correction Commits:

`adfc4d733efdf990d413022d5aa36433da4db356` (Round 1 — 14 findings)
`7b1bb2c7912869a1e8faf8c3ac40346696d99682` (Round 2 — 13 findings)
`de85039d01c44e1b6cc80d8baa3cc5dd2ad69d2e` (Round 3 — 8 findings)

Documentation Bookkeeping Commit:

`2d5ce3f8a388e957d83195a73acdc3b73dd03aaa`

Documentation Correction Commit — Round 4:

`8d6f71aba406b4e96123ddecd70b9c1d1001e17b`

Documentation Correction Commit — Round 5:

`PENDING — record the actual full SHA in a bookkeeping commit`

## 2. Current Status

```text
VAULT GIT HISTORY:           CLOSURE IN PROGRESS
RETROSPECTIVE SPEC:          COMPLETE — PENDING OWNER APPROVAL
RETROSPECTIVE PLAN:          COMPLETE
IMPLEMENTATION RECORD:       COMPLETE FOR DOCUMENTATION REVIEW BASELINE
FINAL PRODUCTION BASELINE:   NOT YET CAPTURED
DOCUMENTATION CHAIN:         RECONSTRUCTED
OPEN P1 FINDINGS:            PRESENT
OPEN P2 FINDINGS:            PRESENT
FINAL VERIFICATION:          NOT COMPLETE
CI THREE-PLATFORM:           NOT RE-RUN DURING RECONSTRUCTION
MAINTENANCE MODE:            NOT ENTERED
```

## 3. Delivered Scope (Observed on `main`)

The following is what is actually implemented on the
Documentation Review Baseline. It is **not** a claim that every
function is bug-free or verified end-to-end — see §4 for the open
findings.

### 3.1 Capability and bootstrap

- `GET /api/history/capability` — `gitAvailable`, `repoInitialized`,
  `initError?`. Capability cached for process lifetime.
- `ensureRepo(repoRoot)` — writes `.gitignore` and `.gitattributes`
  once (never overwriting), `git init` (3-step fallback), and
  `core.autocrlf false`.
- `ensureAuthorIdentity` — local-config probe; env-var precedence
  over fallback (`docus` / `docus@localhost`).
- Capability cached; per-request `probeGit()`.

### 3.2 Read-only state

- `GET /api/history/status` — porcelain `--untracked-files=all`,
  filtered to managed Markdown paths.
- `GET /api/history/log?path=&limit=` — newest-first, limit 200.
- `GET /api/history/file?path=&ref=` — ref defaults `HEAD`;
  `WORKTREE` allowed.
- `GET /api/history/diff?path=&old=&new=` — line + optional word
  breakdown.

### 3.3 Mutating operations

- `POST /api/history/commits` — temporary Git Index,
  `hash-object` + `update-index` + `write-tree` + `commit-tree`
  (plumbing), CAS `update-ref HEAD`, Real-Index sync with retry.
- `POST /api/history/restore` — `git restore --source=<ref>
  --worktree -- <path>`. WORKTREE rejected.
- `POST /api/history/drop` — two-phase: non-root `update-ref HEAD
  <parent> <expected>`, root `update-ref -d HEAD <expected>`.

### 3.4 Index repair

- `GET /api/history/repair-status` — `{ transactions: [...] }`.
- `POST /api/history/repair-index` — opaque 32-hex token,
  hand-taken `.git/index.lock`, atomic repair.
- `POST /api/history/repair-index/discard` — selective metadata
  removal.

### 3.5 Client surface

- `HistoryPanel.vue` — emptiness / capability / withdraw menu.
- `HistoryChangesPanel.vue` — selection + version-message
  composer + Repair banner.
- `HistorySnapshotPane.vue` — read-only snapshot view.
- `HistoryComparisonPane.vue` — read-only side-by-side diff.
- `TimelineDocumentRow.vue`, `TimelineRevisionRow.vue`,
  `TimelineGroup.vue`, `SideBySideDiff.vue`.
- Composable layer: `useHistory`, `useHistoryCommit`,
  `useHistoryTimeline`, `useHistorySnapshots`, `useHistoryComparisons`,
  `useHistoryRestore`, `useHistoryWithdraw`.
- Mutation lock: `pathMutationLock.createPathMutationLock`.

### 3.6 Test coverage (observed)

Real-git tests (no mocks, per the source comment "Mocks would test
the mock."):

- `server/__tests__/history-git.test.ts` — 50+ cases covering L0
  spawn, parsing, repository ops, addAndCommit, dropHeadCommit,
  author identity, restoreFile, CRLF safety.
- `server/__tests__/history-routes.test.ts` — 40+ cases covering
  every endpoint's happy path, validation, conflict mapping, 503
  graceful.
- `server/__tests__/history-diff.test.ts` — pure-function tests of
  `computeFileDiff`.
- `src/lib/__tests__/history-api.test.ts` — wire-level fetch
  wrappers.
- `src/lib/__tests__/history-date.test.ts` — locale formatter.
- `src/composables/vault/__tests__/pathMutationLock.test.ts` —
  per-path and vault-wide locks.
- `src/composables/vault/__tests__/useHistoryCommit.test.ts` —
  24 cases.
- `src/composables/vault/__tests__/useHistoryWithdraw.test.ts` —
  6 cases.
- `src/composables/vault/__tests__/useHistoryRestore.test.ts` —
  12 cases.
- `src/composables/vault/__tests__/useHistorySnapshots.test.ts` —
  5 cases.
- `src/composables/vault/__tests__/useHistoryComparisons.test.ts` —
  10 cases.
- `src/composables/vault/__tests__/useHistoryTimeline.test.ts` —
  1 case (grouping).
- `src/__tests__/useHistory.test.ts` — 7 cases.
- `src/components/vault/__tests__/HistoryPanel.test.ts` — 12
  cases.
- `src/components/vault/__tests__/HistoryChangesPanel.test.ts` —
  6 cases.
- `src/components/vault/__tests__/HistorySnapshotPane.test.ts` —
  5 cases.
- `src/components/vault/__tests__/HistoryComparisonPane.test.ts` —
  5 cases.
- `e2e/edit-program-long-flows.spec.ts` — Long Flow A exercises
  History in the browser stack.

## 4. Open Closure Findings

These are the items that must be **resolved or explicitly
accepted** before this document may be flipped to **CLOSED**.

| ID | Finding | Severity | Status | Closure blocker |
|----|---------|----------|--------|-----------------|
| H-C1 | `/status` response contract — `getStatus` swallows genuine 5xx because `allowNonOkJson: true` is unconditional | P1 | Open | **Yes** |
| H-C2 | Commit success vs post-success refresh failure classification | P1 | Open | **Yes** |
| H-C3 | Routine Real-Index synchronization can overwrite target-path staged intent in two cases: the target path was already staged before Create Version or Withdraw began; or an external Git writer changes the target path during the current reset / verify retry window. Working Tree bytes may remain intact, but the user's exact staged state can be lost. | P1 | Open | **Yes** |
| H-C4 | Withdraw lacks canonical same-vault Docus commit marker verification (also depends on Owner choice for legacy-marker migration; default Option A — fail closed) | P1 | Open | **Yes** |
| H-C5 | Restore reads a mutable ref outside the repository mutation transaction, returns pre-restore source bytes, and the current client writes `request.historicalRaw` into the editor tab and the file-change event. | P1 | Open | **Yes** |
| H-C6 | Short SHA at `/drop` never matches full HEAD | P2 | Open | Yes (UX) |
| H-C7 | Timeline date grouping uses an 86_400_000 ms window between local-midnight `startOfDay` timestamps; across a DST transition the bucket does not match the local-calendar day boundary. | P2 | Open | **Yes** |
| H-C8 | Three-platform CI verification not re-run for this reconstruction | P1 (Verification) | Open | **Yes** |
| H-C9 | Missing regression tests (markers, path shape, multi-vault keying, Restore race) | P1 | Open | **Yes** |
| H-K8 | Rename history not `--follow`-merged | P2 | Open | No |
| H-K9 | Symlink containment check missing on History paths | P2 | Open | No |
| H-K10 | No Timeline / Log pagination | P2 | Open | No |
| H-K13 | SHA-256 vault compatibility (40-zero CAS sentinel) | P2 | Open | No |

The full descriptions for each item live in
[`Implementation Record §14.2`](vault-git-history-implementation-record.md#142-known-divergences-from-intended-contract)
and [`Spec §25`](superpowers/specs/2026-07-30-vault-git-history-design.md#25-known-risks-and-open-questions).
The remediation tasks live in
[`Plan Part B`](superpowers/plans/2026-07-30-vault-git-history-implementation-plan.md#part-b--closure-remediation-tasks).

## 5. Candidate Final Invariants

The following invariants have been verified individually during
implementation or via the test suite, but have **not** been verified
as a complete set under the final closure gate. They are recorded
here as **Candidate invariant — pending verification** until each
gets explicit owner sign-off.

1. **Create Version commits only the selected paths**.
   - Verified by `server/__tests__/history-git.test.ts > 'commits only
     selected paths when an unrelated file is already staged'` and
     `'commits both sides of an externally moved file'`.
2. **HEAD moves only via CAS**. `git update-ref HEAD <new>
   <expected>` with an `expectedOld` of `'0'×40` for the empty-repo
   case. Second `assertRepositoryIdle` runs immediately before
   `update-ref`.
   - Verified by `'rejects with CAS conflict when HEAD changes
     before update-ref'`.
3. **Plumbing commit, no hooks, no signing**. The Commit record is
   always produced via `git commit-tree` with a fixed-tree temp
   index; no `commit-msg` / `pre-commit` hooks run.
   - Source-traceable; behavior captured in repository-level commit
     objects.
4. **Working Tree bytes are preserved by Withdraw**. `dropHeadCommit`
   never mutates the Worktree.
   - Verified by `'withdraws only the latest version, preserves
     Worktree bytes, and keeps unrelated staged entries'`.
5. **Latest version only can be Withdrawn**. Withdraw rejects any
   commit that is not at HEAD with
   `'only the latest version can be withdrawn'`.
   - Verified by `'rejects an older version and uses CAS without
     overwriting an external version'`. **Note**: this
   verification is about HEAD identity, **not** about a canonical
   same-vault Docus marker — see H-C4.
6. **Index Repair is durable + atomic**. JSON file at
   `<git-dir>/docus/index-repair.json`, schema version 2, v1→v2
   migration, corrupt quarantine, temp-file + `fs.rename`,
   empty-list removal.
   - Verified by a cluster of tests including `'migrates a valid
     version 1 repair file to version 2 without quarantine'`,
     `'quarantines corrupt repair state before committing'`.
7. **Index Repair is CAS-protected**. Repair takes
   `.git/index.lock` by hand; re-checks fingerprint **before and
   after**; mismatch throws `'index changed after repair was
   requested'`.
   - Verified by `'holds index.lock across validation and atomic
     replacement'`, `'refuses repair after the user changes the real
     index entry'`.
8. **Restore mutates only the Working Tree**. `git restore
   --source=<ref> --worktree`; `--staged` is never used.
   - Verified by `'overwrites the working-tree copy with the old
     ref\'s content'` and the route's 503 path.
   **Note**: the returned `raw` is currently the **pre-restore**
   bytes; see H-C5.
9. **Newer in-editor edits survive a concurrent Restore**.
   - Verified by `'preserves edits made while restore is pending and
     resumes saving after commit'`.
10. **Repository-operation markers are checked**. Merge / cherry-pick
    / revert / rebase / rebase-merge / rebase-apply / sequencer all
    reject Create and Withdraw.
    - Verified by `'rejects Create Version while ${marker} is
      present'` (parametrized for three markers) and
      `'rejects when a repository operation starts after snapshot
      capture'`. **Note**: only three of seven markers are
      parametrized; see H-C9.
11. **Multi-vault isolation** on the client (`useHistory` per
    `VaultContext`) and on the server (`withRepoMutation` keyed by
    `path.resolve(repoRoot)`).
    - Verified by `useHistory.test.ts > 'shares state within the
      same vault owner'` / `'rebinds when the provider-less vault
      owner changes'`. **Note**: multi-vault server-side keying has
      no dedicated test; see H-C9.
12. **Path-mutation lock** excludes overlapping vault mutations
    (Create ↔ Restore ↔ Withdraw ↔ editor save).
    - Verified by `pathMutationLock.test.ts` (2 cases).
13. **Canonical same-vault Docus marker** for commits.
    - **Not yet verified**; the marker is an accidental-withdrawal
      guard, not cryptographic ownership proof. See H-C4.

Each invariant moves from "Candidate" to "Verified" only after the
closure verification (Section §7) reproduces it on the Final
Production Code Baseline.

## 6. Closure Gate

The Vault Git History feature is closable when **all** of the
following are true. None of these are currently satisfied (status
in brackets):

```text
[ ] Spec reviewed and approved by owner                            [NOT DONE]
[ ] Implementation plan approved                                    [OWNER PENDING]
[ ] Implementation record matches current main                      [DRAFT]
[ ] All P1 code/data-safety findings closed
    (H-C1, H-C2, H-C3, H-C4, H-C5)                                  [OPEN]
[ ] All P1 verification findings closed
    (H-C8, H-C9)                                                     [OPEN]
[ ] H-C6 (short SHA boundary) closed or owner-accepted as P2 UX     [OPEN]
[ ] H-C7 (DST-safe local-calendar grouping) implementation
    and deterministic TZ tests completed                             [OPEN]
[ ] H-C8 (three-platform CI) green run captured                     [NOT RUN]
[ ] H-C9 (missing regression tests) written                         [OPEN]
[ ] 500-regression test added for /status                           [OPEN]
[ ] Commit-then-refresh-failure test added                          [OPEN]
[ ] External-staged-Index race test added                           [OPEN]
[ ] Non-Docus-commit withdraw rejection test added                  [OPEN]
[ ] Restore mutable-ref / ref-resolution test added                 [OPEN]
[ ] History unit tests pass                                         [NOT RUN THIS BASELINE]
[ ] History route tests pass                                        [NOT RUN THIS BASELINE]
[ ] History component / composable tests pass                       [NOT RUN THIS BASELINE]
[ ] Long Flow A e2e passes                                          [NOT RUN THIS BASELINE]
[ ] No History-related test timeout                                [NOT VERIFIED]
[ ] No History-related EBUSY / EPERM cleanup failure                [NOT VERIFIED]
[ ] npm run typecheck passes                                        [NOT RUN THIS BASELINE]
[ ] npm run build passes                                            [NOT RUN THIS BASELINE]
[ ] npm test -- --run passes                                        [NOT RUN THIS BASELINE]
[ ] git diff --check passes                                         [NOT RUN THIS BASELINE]
[ ] Final immutable production baseline SHA recorded                 [NOT YET]
[ ] README updated to reflect closed state                          [NOT YET]
[ ] Maintenance-mode rules approved                                 [PENDING]
```

## 7. Verification Evidence

For each command in the verification list, mark the status.

### 7.1 Local / on-this-baseline verifications

| Command | Status | Notes |
|---------|--------|-------|
| `git log -- server/history/` | **Done** | Captured Implementation Record §13 commit list. |
| `git log -- src/lib/history-api.ts src/composables/vault/useHistory*.ts src/components/vault/History*.vue src/components/vault/Timeline*.vue` | **Done** | Captured Implementation Record §13 commit list. |
| `grep -rn 'WORKTREE' server/history src/lib/history-api.ts src/composables/vault/` | **Done** | Identified READ-ONLY usages and the single 400-rejection on `/restore`. |
| `grep -rn 'git update-ref' server/history/` | **Done** | Confirmed CAS use on commit, withdraw non-root, withdraw root (`-d`). |
| `grep -rn 'GIT_INDEX_FILE' server/history/` | **Done** | Confirmed temp index flow for Create Version. |
| Source review of `server/history/git.ts` | **Done** | Mapped every function and side effect (agent output committed to research). |
| Source review of `server/history/routes.ts` | **Done** | Mapped every endpoint, every validation, every 503 path (agent output committed to research). |
| `npm test -- --run` | **NOT RUN DURING DOCUMENTATION RECONSTRUCTION** | Last local-run evidence is from the Tags closure (`tags-query-index-refactor-final-closure.md`); not re-run for this History reconstruction. |
| `npm run typecheck` | **NOT RUN DURING DOCUMENTATION RECONSTRUCTION** | Same. |
| `npm run build` | **NOT RUN DURING DOCUMENTATION RECONSTRUCTION** | Same. |
| `git diff --check` | **PASS on documentation commits** | Ran on `ff2f992` (reconstruction), `adfc4d7` (Round 1), `7b1bb2c` (Round 2), `de85039` (Round 3), and `2d5ce3f` (bookkeeping) — exit 0 each time. This is documentation-only verification and does **not** substitute for the Final Production Baseline `git diff --check` required by the Closure Gate. |

### 7.2 Cross-platform CI

```text
GitHub CI: NOT INDEPENDENTLY VERIFIED FOR THIS BASELINE.
```

No CI workflow run was located for the Documentation Review
Baseline `00b17359d151bbdbe56115ed992700ecbb5e1ca1`. The previous
History-feature CI evidence (if any) is not asserted for this
reconstruction.

### 7.3 Test timeouts / resource leaks

```text
NOT INDEPENDENTLY VERIFIED FOR THIS BASELINE.
```

The Windows-timeout mitigation for slow real-git history tests
landed in `bf28078` (2026-07-23). The reconstruction did not
re-run the Windows suite to confirm.

## 8. Accepted Risks

**None** are currently approved for acceptance. Risks below the
"Closure Blocker" line in §4 are the only candidates; they have not
been reviewed by the owner.

The risks below are **explicitly NOT acceptable** as Accepted Risks
and must be resolved as Closure Blockers rather than downgraded:

- Any path that would let Docus overwrite the user's externally
  staged content.
- Any path that would let Docus withdraw a non-Docus commit.
- Any path that would cause a successful commit to be reported as
  a failure.
- Any path that would let Editor Buffer and disk diverge silently.
- Any data-loss scenario.
- Any path that would clear the Real Index unintentionally.
- Any Windows stability gap with documented failure evidence.

Risks that **may** be acceptable as non-blocking once the closure
gate has run end-to-end on a Final Production Baseline:

- None for H-C7: DST-safe local-calendar grouping and deterministic TZ
  tests remain a Closure Blocker until completed.
- No Timeline / Log pagination (H-K10) — known design tradeoff
  for vaults of expected size; recorded but not a blocker.
- Rename history not `--follow`-merged (H-K8) — product scope
  limitation.
- Symlink containment check absent on History paths (H-K9) —
  consistent with the rest of History's surface, not with the rest
  of the codebase.
- SHA-256 vault support (H-K13) — out-of-scope, no current user.

## 9. Maintenance-Mode Rules (Candidate)

The following rules are recorded as **candidates**. They do **not**
take effect until this document is upgraded to **CLOSED** status
with Owner Approval. Until then, all History changes must reopen
this closure.

1. Any change touching `server/history/*`, `src/lib/history-api.ts`,
   `src/lib/history-date.ts`, `src/lib/file-diff.ts`,
   `src/composables/vault/useHistory*.ts`,
   `src/composables/vault/pathMutationLock.ts`, the four History
   `*.vue` components, or the four Timeline components must:
   - Update or create a Spec describing the change.
   - Create a Plan documenting the change sequence.
   - Preserve the documented invariants (Section §5 once
     finalized).
2. The **authority model** (§6 of the Spec) is the binding contract:
   Editor ↔ Working Tree ↔ Real Index ↔ HEAD. Any change that moves
   state across these boundaries must respect the source-of-truth
   ordering.
3. **Docus commits never go through the Real Index directly**.
   Every Create Version must build its commit from a Temporary Git
   Index.
4. **HEAD is updated only via CAS**. `update-ref HEAD <new>
   <expected>`. A non-CAS HEAD update is a Closure violation.
5. **External staged content is preserved**. The Real-Index sync
   path must not clear or alter entries that were not part of the
   commit / withdraw.
6. **Restore does not touch HEAD or the Real Index**. Restore is
   strictly Working-Tree-only via `git restore --source=<ref>
   --worktree`.
7. **Withdraw requires one canonical same-vault Docus marker block**.
   The Docus-Vault trailer scheme (H-C4) — once finalized — must be
   enforced as an accidental-withdrawal guard, not a security
   boundary.
8. **Withdraw runs at a vault-wide lock**; Create and Restore run
   at per-path locks. Cross-workflow exclusion is required.
9. **All mutating routes** must continue to:
   - acquire `withRepoMutation` (in server `git.ts`),
   - check `assertRepositoryIdle` at entry and immediately before
     `update-ref`,
   - return `409` on the repository-operation-in-progress state,
   - distinguish Commit Success / Index Refresh Degraded / Repair
     State Persistence Failed / Post-Success Refresh Error in the
     response shape.
10. **Regression tests** are required for every behavioral change.
    Test fixtures must use real `git` (no mocks of the CLI per the
    repository convention "Mocks would test the mock").
11. **No silent scope expansion**. A change that adds General Git
    Client features (branch UI, merge UI, remote sync, signing,
    hooks) is out of scope here; it requires a new spec and a new
    chain of documents.
12. **No data-safety risk may be downgraded** to non-blocking
    without Owner Approval.
13. **Verification** before any merge to `main`:
    - `npm run typecheck`
    - `npm run build`
    - `npm test -- --run`
    - `git diff --check`
    - Playwright Long Flow A in
      `e2e/edit-program-long-flows.spec.ts` (or its replacement
      History e2e) green

## 10. Final Closure Procedure

When all of §6 are checked, perform the following in order:

1. Run `npm test -- --run`, `npm run typecheck`, `npm run build`,
   and `git diff --check` on the Final Production Baseline SHA.
2. Record the **Final Production Code SHA** in §1 of this
   document.
3. Move every Open Finding from §4 to a **Closed Findings** table
   (or to Accepted Risks in §8, with Owner Approval).
4. For every Candidate Invariant in §5, record its verification
   status and the test(s) that established it.
5. Flip this document's status from **DRAFT — CLOSURE IN PROGRESS**
   to **CLOSED**.
6. Update the README §3 ("Feature Status" or equivalent):
   - Add Vault Git History with the linked Chain of Documents.
   - State the Final Production Baseline SHA.
   - Note Maintenance-Mode is now active.
7. Apply Maintenance-Mode Rules from §9 going forward.

No step in this procedure is allowed without Owner Approval.

---

**Status:** DRAFT — CLOSURE IN PROGRESS
**Next Step:** Owner Review of the documentation chain and the
open P1 findings. No production code change should be attempted
until the Owner has approved the Spec and Plan.
