# Vault Git History — Implementation Plan

**Status:** Retrospective Reconstruction — Closure Work In Progress
**Spec:** [../specs/2026-07-30-vault-git-history-design.md](../specs/2026-07-30-vault-git-history-design.md)

> This plan reconstructs the implementation sequence from repository
> evidence (`git log` + `git blame` + source diffs). It is **not**
> presented as a pre-existing plan. Each task names the implementation
> commit(s) it introduced (where they can be isolated) or marks the
> task as "**Implementation commit: Not isolated; introduced across
> multiple commits**" when the work spread across several SHAs.

The Production Code Review Baseline against which this plan should
be read is the tip of `main` at the time of the documentation
reconstruction (`00b17359d151bbdbe56115ed992700ecbb5e1ca1`).

This document has two parts:

- **Part A** — Retrospective implementation tasks (already landed).
- **Part B** — Closure remediation tasks (open).

---

## Part A — Retrospective Implementation Tasks

### Task 1 — Establish Git Capability and Vault Repository Initialization

- [x] `git --version` capability probe (cached at module load).
- [x] `isRepo` via `git rev-parse --is-inside-work-tree`.
- [x] `initRepo` with 3-step fallback (`--initial-branch=main`, then
      `--initial-branch=master`, then plain `init`).
- [x] `core.autocrlf=false` set on local config.
- [x] `ensureRepo` writes `.gitignore` once, writes `.gitattributes` once
      (empty), then initializes the repo. Idempotent.
- [x] `ensureAuthorIdentity` writes `docus` / `docus@localhost` if
      `user.name` / `user.email` are unset locally, honoring
      `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` env vars.
- [x] Nested-repo detection warns but does not block.

**Files created/modified:**

- `server/history/git.ts` (new, 334 lines in initial commit)
- `server/history/repo.ts` (new, 86 lines in initial commit)
- `server/__tests__/history-git.test.ts` (new, 285 lines)
- `server/__tests__/history-routes.test.ts` (new in next task)

**Implementation commits:**

- `5e735d1048b9fbb54e6ae7709d2ac36a246d5b1b` (2026-06-24) —
  `feat(history): L0 git wrapper + L1 line/word diff` (L0 + repo
  bootstrap + tests for `isRepo`, `initRepo`, autocrlf)
- `41580795ed3241a8282ddbb003487032f0b4d8c5` (2026-06-30) —
  `fix(history): auto-configure git author identity on first commit`
- `22eaeab6bd2ebe85ffab1cddedbae9e26a1a5fc0` (2026-06-25) —
  `refactor(history): vault gets its own git repo + VAULT_DIR env var`

**Deviations:**

- The `--absolute-git-dir` traversal was added later (in the index
  repair chain) to determine the location of the repair JSON file.
- Capability caching is process-wide — `probeGit()` runs once at
  module load. This was always the intent; no deviation.

**Verification evidence:** `server/__tests__/history-git.test.ts`
> describe `isRepo / initRepo` (2 cases) and `describe ensureRepo`
> (4 cases including "initializes a nested vault repo when one is
> requested inside another"). Test
> `'writes a default user.name + user.email when none is configured'`
> in `describe addAndCommit author identity` confirms the env-var
> precedence.

**Residual risks:**

- The user's existing global `user.name` / `user.email` is **not**
  honored — the env var and the fallback are, but a global config
  is intentionally bypassed (the source comment notes that
  `--local --get` is used). Acceptable: keeps History commits
  attributed to the Docus instance, not the host user.

---

### Task 2 — Implement Path and Ref Validation

- [x] `isValidHistoryPath` for the History path contract (§7 of Spec).
- [x] `isValidHistoryRef` accepting only `HEAD`, `HEAD~N`, and
      `^[0-9a-f]{7,40}$`.
- [x] `isValidCommitSha` (same range, used by `/drop`).
- [x] `SHA_ANCESTOR_RE` for `sha~N` references.
- [x] `validateHistoryPaths` (all-or-nothing).
- [x] `MANAGED_HISTORY_DOTFILES` set
      (`{'.gitattributes', '.gitignore'}`).

**Files created/modified:**

- `server/history/validation.ts` (new, 49 lines)
- `server/history/git.ts` (uses `validPathParam` / `validRefParam`
  indirectly via `routes.ts`)
- `server/history/routes.ts` (calls validators per route)

**Implementation commits:**

- `af5b62208f223d5e0a323eb5c251bb9a19b55c2f` (2026-07-07) —
  `fix(history): validate path/ref inputs + cap git output + fix
  file-chip highlight`
- `925829f0ae0ffdd9583ac7102d98e9b4f616091a` (2026-07-08) —
  `feat(ai+history): AI commit message helper + sha~1 ref validation`
  (added `SHA_ANCESTOR_RE` for `sha~1`)

**Verification evidence:** `server/__tests__/history-routes.test.ts`
- `'rejects invalid diff paths and refs'`
- `'rejects unsupported sha syntax'`
- `'rejects path traversal for WORKTREE reads'`
- `'rejects unsafe or non-note paths'`

**Known residual risks (closure blockers — see Part B):**

- H-K6: short SHA boundary.
- H-K9: no symlink containment check (out of scope for this closure).

---

### Task 3 — Implement Git CLI Wrapper (L0)

- [x] `spawn('git', args, { cwd: repoRoot, windowsHide: true })`
      — args array, no shell.
- [x] Per-invocation `SIGKILL` timeout (15 s).
- [x] Output cap (`MAX_CAPTURE_BYTES = 10 * 1024 * 1024`, compared
      against JS string length — see Spec §21 / H-K15 note).
- [x] `GitUnavailableError` is the sole throw (spawn ENOENT etc.).
- [x] `absoluteGitDir` (internal helper) via `rev-parse --absolute-git-dir`.
- [x] `REPOSITORY_OPERATION_MARKERS` enumeration
      (Spec §18) — `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`,
      `REBASE_HEAD`, `rebase-merge`, `rebase-apply`, `sequencer`.
- [x] `assertRepositoryIdle` runs at entry and again before
      `update-ref` for both Create and Withdraw.

**Files created/modified:**

- `server/history/git.ts` (grew from 334 → 1373 lines across the
  feature lifecycle)

**Implementation commits:**

- `5e735d1048b9fbb54e6ae7709d2ac36a246d5b1b` (initial L0)
- `f29386cabc63de4636619bf9e33aa15b843d9576` and onward — incremental
  additions to `git.ts`

**Verification evidence:** `server/__tests__/history-git.test.ts`
- `describe('addAndCommit + log')` runs against **real** git in
  `mkdtemp` repos (not mocks, per the source comment "Mocks would
  test the mock.").
- The full lifecycle test `'rejects Create Version while ${marker} is
  present'` is parametrized across markers
  (Spec §18 — note: `MERGE_HEAD` and `CHERRY_PICK_HEAD` and
  `rebase-merge` are covered; `REVERT_HEAD`, `REBASE_HEAD`,
  `rebase-apply`, and `sequencer` are listed but the parametrized
  loop in the test file is the single source of truth — see Test
  Evidence §12 in the Implementation Record).

---

### Task 4 — Implement Read-Side Operations (Status, Log, File, Diff)

- [x] `parsePorcelain` — `XY_RE = /^([ MADRCU?!])([ MADRCU?!]) (.+)$/`.
- [x] `status` via `git status --porcelain --untracked-files=all`.
- [x] `log` with `--pretty=format:`, `--name-only`, `LOG_SEPARATOR`
      (`\x1e__DOCUS_LOG__\x1e`) and `--`, path; collapse empty-repo
      output to `[]`.
- [x] `parseLog` with `findHeaderEnd` (last `\n` whose line contains
      a NUL, since filename lines never contain NUL).
- [x] `rawAt` — `git show <ref>:<path>`; collapses seven stderr
      patterns to `null`; resolves `WORKTREE` to `fs.readFile` via
      `safeWorktreeFile`.
- [x] `diff` via `computeFileDiff` re-export.
- [x] No `--follow` — by deliberate decision (Spec §12).

**Files created/modified:**

- `server/history/git.ts` (`status`, `log`, `parseLog`, `rawAt`)
- `server/history/routes.ts` (`/status`, `/log`, `/file`, `/diff`)
- `src/lib/file-diff.ts` (new in `add3b9b1`)
- `server/history/diff.ts` (re-export)
- `src/lib/__tests__/history-diff.test.ts` (new, 144 lines)

**Implementation commits:**

- `5e735d1048b9fbb54e6ae7709d2ac36a246d5b1b` (initial)
- `f47b5bdb83173fd7b886293480261731f9f4dc0f` (parseLog multi-line fix)
- `8db1901070a7ab380b9d51b0de554e5278fb9ac6` (`-uall` for untracked dirs)
- `a889712b2e50fdcbe740aa9e7dd7561e3786b7e7` (empty-repo rawAt)

**Verification evidence:**

- `server/__tests__/history-git.test.ts` > `describe parseLog (synthetic input)`: 3 cases (multi-line body, single line, empty body + multi-file).
- `server/__tests__/history-git.test.ts` > `describe rawAt`: 6 cases including `WORKTREE` and the empty-repo ref.
- `server/__tests__/history-git.test.ts` > `describe CRLF safety`: round-trip byte-for-byte.
- `server/__tests__/history-routes.test.ts` > `GET /api/history/status`: 3 cases including `'hides non-Markdown files that the commit contract cannot accept'`.
- `server/__tests__/history-routes.test.ts` > `GET /api/history/log`: 5 cases including the empty-repo path.
- `server/__tests__/history-routes.test.ts` > `GET /api/history/file`: 6 cases including WORKTREE-traversal rejection.
- `server/__tests__/history-routes.test.ts` > `GET /api/history/diff`: 7 cases including WORKTREE-vs-HEAD and `sha~1`.

---

### Task 5 — Implement Deterministic Temporary-Index Commit

- [x] `addAndCommit` builds the commit through a temporary Git Index
      pointed to by `GIT_INDEX_FILE` (`mkdtemp(os.tmpdir(), 'docus-history-index-')`).
- [x] Seed temp index: `read-tree <headSha>` (or `read-tree --empty`
      for empty repo).
- [x] For each selected path:
      - `update-index --force-remove -- <p>` if deleted
      - `hash-object -w --path=<p> --stdin` + `update-index --add --cacheinfo 100644 <oid> <p>` if present
- [x] Verify staged blobs via `ls-files --stage -- <p>` in the temp
      index; reject if not present.
- [x] Empty-tree guard: `rev-parse <headSha>^{tree}` matches new tree
      → 409 `'nothing to commit'`.
- [x] `write-tree` → `commit-tree <tree> (-p <parent>) -m <message>`
      → `update-ref HEAD <new> <expected>` (CAS).
- [x] `assertRepositoryIdle` again, immediately before `update-ref`.
- [x] `show --name-only --pretty= <sha>` returns `filesCommitted[]`.
- [x] Plumbing commit: no hooks, no signing (verified by source
      comments at `git.ts:1162-1164`).

**Files created/modified:**

- `server/history/git.ts` (`addAndCommit`)
- `server/history/routes.ts` (`POST /commits` handler)

**Implementation commits:**

- `5e735d1048b9fbb54e6ae7709d2ac36a246d5b1b` (initial)
- `85206d0eda2f5151d99a19a4bbeee0bac3830106` (Withdraw, parallel addition to `addAndCommit`)

**Verification evidence:**

- `server/__tests__/history-git.test.ts` > `describe addAndCommit + log`:
  - `'creates a commit, returns its sha, and log reports it'`
  - `'commits only selected paths when an unrelated file is already staged'`
    (this is the "Real Index not committed" invariant)
  - `'commits the validated snapshot when the worktree changes before staging'`
  - `'rejects with CAS conflict when HEAD changes before update-ref'`
  - `'reports index refresh degradation after a successful CAS commit'`

**Deviations:** None in this task — the temp-index mechanics landed
intact in `5e735d1` and have not been rewritten.

---

### Task 6 — Content Hash and HEAD CAS Protection

- [x] `captureExpectedFiles` reads + sha256 + captures bytes via
      `readWorkingTreePath`. Mismatch with the client-supplied
      `expected` → 409 `'content changed before commit'`.
- [x] Expected-hash validation ladder in `POST /commits`:
      - exact key parity with `paths`
      - sha256 shape (`/^[0-9a-f]{64}$/`)
- [x] `assertRepositoryIdle` runs both at entry and again before
      `update-ref`.
- [x] `update-ref HEAD <new> <expectedOld>` — expectedOld is `'0'×40`
      for the empty-repo case.
- [x] Repository-operation markers checked both points.
- [x] `merge-base --is-ancestor` for repair compatibility check.

**Files modified:** `server/history/git.ts`, `server/history/routes.ts`.

**Implementation commits:**

- `5e735d1048b9fbb54e6ae7709d2ac36a246d5b1b` (initial)
- `f29386cabc63de4636619bf9e33aa15b843d9576` (Changes/Commit)
- `ff19820cbb61d433c04a2f3a756cc15780c9e988` (stale-selection reject + reconcile after 409)
- `014231bd2423b3385b4bb8a1f82fc8a5f9b9e973` (conflict detection + index refresh failure reporting)

**Verification evidence:**

- `server/__tests__/history-routes.test.ts` > `POST /api/history/commits`:
  - `'returns 409 without committing when content changes after hash capture'`
  - `'returns a clear 409 when the selected path is no longer dirty'`
  - `'rejects the whole batch when one selected path became clean'`
  - `'requires expected content hashes for every commit request'`
  - `'commits an externally deleted selected file'`
  - `'commits both sides of an externally moved file'`
  - `'commits a multi-file batch in one commit'`
- `server/__tests__/history-routes.test.ts` > `POST /api/history/drop`:
  - `'maps a CAS conflict and repository operation state to 409'`

---

### Task 7 — Client History State and Changes Selection

- [x] `src/lib/history-api.ts` (123 lines in initial commit) — wire
      types + typed fetch wrappers.
- [x] `useHistory()` with multi-vault `WeakMap` and a legacy fallback
      keyed by `getFallbackVaultFileChanges()`.
- [x] Vault-scoped: `historyByVault: WeakMap<VaultContext, HistoryInstance>`.
- [x] `refreshCapability`, `refreshStatus`, `refreshLog`.
- [x] `watch(fileChanges.events, …)` to refresh Status on every
      monotonic seq.
- [x] `useHistoryCommit` composable: `selectedPaths`, `message`,
      `busy`, `error`, `canCommit`, `toggle`, `selectAll`,
      `clearSelection`, `submit()`.
- [x] `useHistoryCommit.submit()`:
      - acquire document mutation (via `pathMutationLock`)
      - `saveSelected(paths)` flushes the editor save barrier
      - `getContentHashes(paths)` → `createCommit(paths, msg, expected)`
      - success: refresh status, log, comparison(s)
      - 409 paths classified (`repository changed` /
        `operation in progress` / stale selection)
- [x] `useHistoryCompare.refreshStatus()` returns the dirty `index` /
      `worktree` letters as captured by `parsePorcelain`.

**Files created/modified:**

- `src/lib/history-api.ts` (123 → 275 lines)
- `src/composables/vault/useHistory.ts` (now 180 lines)
- `src/composables/vault/useHistoryCommit.ts` (339 lines)
- `src/composables/vault/pathMutationLock.ts` (58 lines)
- `src/components/vault/HistoryChangesPanel.vue` (145 lines)

**Implementation commits:**

- `a735fb89c89f2f56e58fb611604f1c9e227e5897` (2026-06-24) —
  initial L3 UI with `useHistory` module-singleton shape.
- `1d730aa241bb06cdf3f1968d3605003d4a0135c7` (2026-07-14) —
  module-singleton migration into VaultContext (i.e. WeakMap per vault).
- `f29386cabc63de4636619bf9e33aa15b843d9576` (2026-07-16) —
  HistoryChangesPanel + useHistoryCommit.
- `16db6bd86395aeb792fc701625c24f099c19b509` (2026-07-16) —
  first path-mutation lock layer.
- `f9c57380465deaee0b70e1c0f996c0487ce4fd00` (2026-07-16) —
  strengthened path-mutation lock for commit + restore.
- `ff19820cbb61d433c04a2f3a756cc15780c9e988` (2026-07-10) —
  stale-selection reject + reconcile after 409.
- `72834ab34b14d1cb84a8b32ee6929e101b04c0fe` (2026-07-14) —
  context-leak fixes.

**Verification evidence:**

- `src/composables/vault/__tests__/useHistoryCommit.test.ts` (24 cases)
  covering: parallel workflows, repair register / settle, persisted
  transaction restore, repository-operation conflict, save failure,
  selection modes, barrier hold, refresh-after-commit, lock conflict,
  degraded success.
- `src/composables/vault/__tests__/pathMutationLock.test.ts`
  (2 cases including the vault-wide lock).
- `src/__tests__/useHistory.test.ts` (7 cases: stale-response
  rejection, per-vault sharing, vault-owner rebind, single hydration,
  dirty count, file-change subscription, error retention).
- `src/components/vault/__tests__/HistoryChangesPanel.test.ts`
  (6 cases: localized status + ARIA, titles, selection toggles,
  retry/discard on Index Repair).

---

### Task 8 — Implement Document Timeline

- [x] `useHistoryTimeline` with per-document aggregation.
- [x] `useHistoryTimeline.groupTimelineItems()` producing
      Today / Yesterday / weekday names / Last Week / Month / Earlier
      buckets from local-calendar days.
- [x] One fetch per document (`getLog({path, limit: 200})`) with
      request-id guards.
- [x] `HistoryPanel` wires `selectDocument`, `selectRevision`,
      `retrySelectedDocument`, `showDocuments`.
- [x] `TimelineDocumentRow`, `TimelineRevisionRow`, `TimelineGroup`
      components with `role="option"`, `role="group"`, ArrowUp/Down
      navigation, Enter selection, Escape back navigation.

**Files created/modified:**

- `src/composables/vault/useHistoryTimeline.ts` (255 lines)
- `src/components/vault/TimelineDocumentRow.vue` (32 lines)
- `src/components/vault/TimelineRevisionRow.vue` (32 lines)
- `src/components/vault/TimelineGroup.vue` (18 lines)
- `src/components/vault/HistoryPanel.vue` (rewritten)

**Implementation commits:**

- `3882be58e13d8d978707151b48ab379ddd390dad` (2026-07-15) —
  `feat: implement document timeline and history panel`

**Verification evidence:**

- `src/composables/vault/__tests__/useHistoryTimeline.test.ts`
  (`groups Today, Yesterday, weekdays, and Last Week in display order` — 1 case).
- `src/components/vault/__tests__/HistoryPanel.test.ts` (12 cases
  including `'groups recent documents and opens one document
  revision list'`, `'refreshes the selected document revisions after
  an external HEAD conflict'`, `'ignores a stale revision response
  after navigating from document A to B'`, `'supports arrow
  navigation, Enter selection, and Escape back navigation'`).

---

### Task 9 — Implement Read-Only History Snapshots

- [x] `useHistorySnapshots` with per-tab `(tabId = 'history:<path>')`
      request-id cancellation.
- [x] `openRevision`, `openCachedRevision`, `selectSnapshot`,
      `retrySnapshot`, `viewCurrent`, `closeSnapshot`,
      `closeSnapshots`.
- [x] `HistorySnapshotPane.vue` rendering through `<ReadingPane>`.
- [x] Editor tabs gain a `(History)` tab — read-only, distinct from
      a live document tab.

**Files created/modified:**

- `src/composables/vault/useHistorySnapshots.ts` (166 lines)
- `src/components/vault/HistorySnapshotPane.vue` (104 lines)
- `src/components/vault/EditorTabs.vue` (history-tab integration)

**Implementation commits:**

- `32eabb1f04fa55986b44cd948bd1321dc0e3a9b0` (2026-07-15) —
  `feat: implement history snapshot feature with read-only view`.
- `483ffe439314521813b97916a71ee293e96999ed` (2026-07-15) —
  history-comparison logic refinement.

**Verification evidence:**

- `src/composables/vault/__tests__/useHistorySnapshots.test.ts`
  (5 cases: lazy load + cache, single-tab-per-document,
  inline-error retention, retry, cached open without refetch).
- `src/components/vault/__tests__/HistorySnapshotPane.test.ts`
  (5 cases: mutation-lock aware, banner + read-only toolbar,
  busy state, loading/error state, focus target via
  `defineExpose({ focusViewer })`).

---

### Task 10 — Implement Historical Comparison

- [x] `useHistoryComparisons` with `tabId = 'diff:<path>'`.
- [x] Current side: live editor raw preferred, fallback to saved-doc API.
- [x] `currentDirty = (tab.raw !== tab.originalRaw)` UI badge.
- [x] `refreshComparison`, `openComparison`, `selectComparison`,
      `closeComparison`, `refreshDocumentComparison`.
- [x] `HistoryComparisonPane.vue` (128 lines) + `SideBySideDiff.vue`
      (extracted from DiffView).
- [x] Identical-content state: empty ops → "identical" + "Latest
      version" badge.

**Files created/modified:**

- `src/composables/vault/useHistoryComparisons.ts` (184 lines)
- `src/lib/file-diff.ts` (new, 112 lines)
- `src/components/vault/HistoryComparisonPane.vue` (128 lines)
- `src/components/vault/SideBySideDiff.vue` (128 lines)

**Implementation commits:**

- `add3b9b1d8d70eac439d16e2a45ffbd078c91cf7` (2026-07-15) —
  `feat: add history comparison feature with dedicated tab and pane`.

**Verification evidence:**

- `src/composables/vault/__tests__/useHistoryComparisons.test.ts`
  (10 cases: open-doc raw preferred, fallback path, replace-after-
  tab-close, loading fallback, no-trust-on-failed-load, request-id
  cancellation, refresh-on-reselect, per-document isolation,
  inline-error retry).
- `src/components/vault/__tests__/HistoryComparisonPane.test.ts`
  (5 cases: mutation-lock aware, banner + read-only toolbar,
  busy state, loading/error/identical states, locale-formatted date,
  focus target).

---

### Task 11 — Implement Restore Workflow

- [x] `POST /api/history/restore` runs `git restore --source=<ref>
      --worktree -- <path>` with `WORKTREE` explicitly rejected.
- [x] Returns `{ path, ref, raw, mtime }` where `raw` is currently
      the source bytes obtained by the off-mutex `rawAt` pre-check.
- [ ] Atomic ref resolution to one immutable SHA inside
      `withRepoMutation` and post-restore `result.raw` authority
      are deferred to History-C5.
- [x] `useHistoryRestore` composable with `pathMutationLock`,
      `DocumentMutationBarrier`, captured-at-confirmation semantics
      (`buildRequest({ ...source })`).
- [x] `applyRestoredContent` (no overwrite of newer edits) vs
      `applyRestoreWithoutOverwritingNewerEdit` (preserve newer
      edit).
- [x] `Promise.allSettled` refresh; partial-failure reported via
      `onSuccess(_, { refreshFailed })`, not `onError`.
- [x] Host integration in `VaultView`, `ConfirmHost`, and
      `useDocumentSave` (Restore commits its barrier on success,
      rolls back on failure).

**Files created/modified:**

- `server/history/git.ts` (`restoreFile`)
- `server/history/routes.ts` (POST /restore)
- `src/lib/history-api.ts` (`restoreFile`)
- `src/composables/vault/useHistoryRestore.ts` (175 lines)
- `src/views/VaultView.vue` (host wiring)
- `src/components/ConfirmHost.vue` (destructive-action label)

**Implementation commits:**

- `c6d7e37b85dc503a091084a2087cea2e217f3c63` (2026-06-24) —
  restore-file primitive from diff view.
- `416f73a35ff997bcec872adf5de7e64632fd846e` (2026-07-15) —
  full user-facing restore flow with confirmation.
- `662b6b50ddab771593a9dc08f74db2516a1342d3` (2026-07-15) —
  state-management refinements.
- `f9c57380465deaee0b70e1c0f996c0487ce4fd00` (2026-07-16) —
  path-mutation lock integration.

**Verification evidence:**

- `server/__tests__/history-git.test.ts` > `describe restoreFile`:
  4 cases: overwrites worktree, idempotent, bad revision,
  file-not-at-ref.
- `server/__tests__/history-routes.test.ts` > `POST /api/history/restore`:
  9 cases: success, missing path / ref, unsafe path,
  WORKTREE rejection, 404 on missing file, 404 on bad revision,
  503 graceful.
- `src/composables/vault/__tests__/useHistoryRestore.test.ts`
  (12 cases: confirmation required, single-file restore updates tab,
  closed-doc restore, editor untouched on failure, single-flight,
  preserved-newer-edit, barrier rollback, barrier-vs-real-save
  interaction, manual save after restore, lock conflict, captured
  source freezes at confirmation, no-trust-on-failed-tab,
  partial refresh reports success-with-degradation).

**Known residual risks (closure blockers — see Part B):**

- H-K3 (H-C3) — Retrying Real-Index synchronization can clear newly staged target-path entries created by an external Git operation; Working Tree bytes may remain but staged intent can be lost.
- H-K5 (H-C5) — Restore resolves and reads a mutable ref outside the repository mutation transaction; current response carries pre-restore source bytes; current client writes `request.historicalRaw` into editor tabs and the file-change event.

---

### Task 12 — Implement Persistent Index Repair

The Index Repair feature shipped across six commits in the same day
(2026-07-16 13:56 → 17:07). Tasks within the chain:

- [x] **Initial repair record after a failed Real-Index sync** —
      `9ea5dc0c2b3ba94c22fc1a0e42a918fd143951ee`
- [x] **Repair token + JSON persistence** —
      `098d9979369b89fbe3d65bac74afac906163713b`
- [x] **Discard conflicted repair transactions** —
      `a96888d6ee456a5ad3659617eab00154e1dc4100`
- [x] **Schema version 2 + v1→v2 migration** —
      `e4db65c7b757324c0e23c1a6febf896972c8b38c`
- [x] **Repair-state persistence failure path** —
      `fc90ed6f8e535409afabd551481866779adec2eb`
- [x] **Repair registration on Withdraw** —
      `c56f92dd84c4c26490eb12bbc89565fdca520da3`

Concrete behavior (current source):

- [x] Repair file lives at `<absolute-git-dir>/docus/index-repair.json`.
- [x] Top-level `{ version: 2, transactions: IndexRepairTransaction[] }`.
- [x] Per-transaction: opaque 32-hex `token`, `status: 'pending' |
      'superseded'`, `head: string | null`, `paths: string[]`,
      `expectedIndex: Record<path, IndexEntryFingerprint[]>`.
- [x] Hand-taken `.git/index.lock` (`open(lockPath, 'wx')`); EEXIST →
      `'git index is locked'`.
- [x] Fingerprint checks **before and after** the temp-index reset.
- [x] Compatibility gate: `currentHead === transaction.head ||
      merge-base --is-ancestor`.
- [x] Atomic replacement of repair file: temp file + `fs.rename`.
- [x] Empty transaction list **removes** the file.
- [x] Corrupt parse → quarantine (`<file>.corrupt-<ts>-<uuid>.json`).
- [x] v1 → v2 migration drops `expectedIndexHash` and defaults
      `status: 'pending'`.
- [x] Write-preflight (probe write before any HEAD change).
- [x] Repair-state persistence failure → degraded success, not
      commit failure.

**Files created/modified:**

- `server/history/git.ts` (`recordIndexRepair`, `repairIndexWithLock`,
  `validRepairTransaction`, `validRepairFile`,
  `validLegacyRepairFile`, `ensureIndexRepairStorageReady`,
  `writeIndexRepairFile`, `indexFingerprint`, `captureIndexFingerprints`,
  `sameIndexEntries`)
- `server/history/routes.ts` (`POST /repair-index`,
  `POST /repair-index/discard`, `GET /repair-status`)
- `src/composables/vault/useHistoryCommit.ts`
  (`registerIndexRepair`, `settleIndexRepairPaths`,
  `removeIndexRepairToken`, `refreshIndexRepairStatus`,
  `retryIndexRepair`, `discardConflictingIndexRepair`)
- `src/lib/history-api.ts` (`IndexEntryFingerprint`,
  `IndexRepairTransaction`, `getIndexRepairStatus`,
  `repairIndex`, `discardIndexRepair`)
- `src/views/VaultView.vue` (host wiring)
- `src/components/vault/HistoryChangesPanel.vue` (Repair banner)

**Verification evidence:**

- `server/__tests__/history-git.test.ts` cases pinning repair
  behavior:
  - `'repairs A after unrelated B is staged and preserves B in the index'`
  - `'repairs A after Docus successfully commits unrelated B'`
  - `'refuses repair after the user changes the real index entry'`
  - `'holds index.lock across validation and atomic replacement'`
  - `'keeps a repair transaction when HEAD changes immediately before index replacement'`
  - `'reports degraded success when repaired Index metadata cannot be cleared'`
  - `'discards only repair metadata and preserves newer staged content'`
  - `'reports repair-state persistence degradation without failing an existing commit'`
  - `'does not fail a commit when clearing old repair state cannot be persisted'`
  - `'quarantines corrupt repair state before committing'`
  - `'migrates a valid version 1 repair file to version 2 without quarantine'`
  - `'fails the repair-storage preflight before moving HEAD'`
  - `'does not report index repair success when HEAD changes between check and reset'`
- `src/composables/vault/__tests__/useHistoryCommit.test.ts`
  repair-specific cases including `'restores persisted repair
  transactions when the Vault is recreated'`, `'restores a
  superseded transaction directly as a dismissible conflict'`,
  `'keeps the repair transaction and explains a newer staged-index
  conflict'`, `'removes a discarded transaction locally when the
  status refresh fails'`, `'keeps older pending repair paths after
  a later successful commit'`.

---

### Task 13 — Implement Latest-Version Withdrawal

- [x] `POST /api/history/drop`.
- [x] `dropHeadCommit` two-phase strategy:
      - non-root: `git update-ref HEAD <parent> <expectedSha>`
      - root: `git update-ref -d HEAD <expectedSha>`
- [x] `assertRepositoryIdle` at entry and again before
      `update-ref`.
- [x] Working Tree bytes preserved.
- [x] `filesChanged` filtered to `.md` only.
- [x] `syncDroppedIndexPaths` reuses the same Real-Index-reset +
      lock-and-rename pattern as Create.
- [x] `useHistoryWithdraw` with `pathMutationLock.acquireAll`,
      confirmation, post-withdraw refresh bundle, repair
      register / settle, snapshot/diff tab closure, conflict
      classification (409).
- [x] `HistoryPanel` right-click → context menu → "Withdraw the
      latest version" with Shift+F10 / ContextMenu key, focus
      restored on Escape.

**Files created/modified:**

- `server/history/git.ts` (`dropHeadCommit`, `syncDroppedIndexPaths`)
- `server/history/routes.ts` (POST /drop)
- `src/lib/history-api.ts` (`DropCommitResult`, `dropCommit`)
- `src/composables/vault/useHistoryWithdraw.ts` (125 lines)
- `src/components/vault/HistoryPanel.vue` (revision menu)
- `src/views/VaultView.vue` (host wiring)

**Implementation commits:**

- `85206d0eda2f5151d99a19a4bbeee0bac3830106` (2026-07-08) —
  initial Drop commit (the precursor to the user-facing withdraw).
- `61ba2da9ab2592fc0e2c8395aa81893f12b085fb` (2026-07-16) —
  full Withdraw feature (server `dropHeadCommit`, client
  `useHistoryWithdraw`, route `/drop`, path-mutation lock
  integration, snapshot/diff tab invalidation).
- `c56f92dd84c4c26490eb12bbc89565fdca520da3` (2026-07-16) —
  repair transaction register/settle loop on Withdraw.
- `5aba80aaa900fbe8c64e0637436d222fc2cfa6c6` (2026-07-16) —
  version-operations context menu (withdraw latest revision).

**Verification evidence:**

- `server/__tests__/history-git.test.ts` > `describe dropHeadCommit`:
  - `'withdraws only the latest version, preserves Worktree bytes, and keeps unrelated staged entries'`
  - `'withdraws the first version without deleting files or unrelated staged entries'`
  - `'rejects an older version and uses CAS without overwriting an external version'`
  - `'returns degraded success and a persistent Repair transaction after Index synchronization fails'`
  - `'repairs a failed Index synchronization after withdrawing the first version'`
  - `'repairs a withdrawn-root transaction after an unrelated new version is created'`
  - `'does not report failure after withdrawal when Repair metadata cannot be persisted'`
- `server/__tests__/history-routes.test.ts` > `POST /api/history/drop`:
  - `'removes the latest commit while keeping its changes in the working tree'`
  - `'rejects dropping an older commit'`
  - `'can drop the root commit and leave its files untracked'`
  - `'keeps unrelated staged files staged when dropping the root commit'`
  - `'rejects unsupported sha syntax'`
  - `'maps a CAS conflict and repository operation state to 409'`
  - `'returns Index degradation as a successful withdrawal response'`
- `src/composables/vault/__tests__/useHistoryWithdraw.test.ts`
  (6 cases: single-flight refresh bundle, no UI clear on failure,
  lock-block on entry, refresh on latest-version conflict, repair
  degradation surfaces as success, register before failed refresh).
- `src/components/vault/__tests__/HistoryPanel.test.ts`:
  - `'offers withdrawal only for the latest version and confirms, single-flights, and restores focus'`
  - `'closes the revision menu outside and on Escape, restoring row focus for Escape'`.

**Known residual risks (closure blockers — see Part B):**

- H-K4 (H-C4) — No Docus commit ownership.
- H-K6 — Short SHA never matches the full-SHA HEAD.

---

### Task 14 — Integrate Document Mutation Barriers

- [x] `pathMutationLock.createPathMutationLock` provides per-vault
      exclusion for `inbox/a.md`-shaped paths and a vault-wide mode
      used by Withdraw.
- [x] `useHistoryCommit` invokes `options.acquireMutation(paths)` and
      holds the lock through saveSelected → content-hashes → createCommit → refresh.
- [x] `useHistoryRestore` invokes `options.acquireMutation([path])`
      and integrates with the editor save barrier (`prepareEditorRestore`,
      `commit([path])`, rollback on failure).
- [x] `useHistoryWithdraw` invokes `options.acquireMutation()` (vault-wide mode).

**Implementation commits:**

- `16db6bd86395aeb792fc701625c24f099c19b509` (2026-07-16) —
  first path-change lock layer.
- `f9c57380465deaee0b70e1c0f996c0487ce4fd00` (2026-07-16) —
  hardened across commit + restore.

**Verification evidence:**

- `src/composables/vault/__tests__/pathMutationLock.test.ts` (2 cases).
- `src/composables/vault/__tests__/useHistoryCommit.test.ts`
  - `'disables submission and reports a mutation-lock conflict'`
  - `'keeps the barrier through commit and releases it before post-commit refreshes'`
- `src/composables/vault/__tests__/useHistoryRestore.test.ts`
  - `'does not restore a document locked by Create Version'`
  - `'prevents duplicate requests while a restore is in flight'`
  - `'holds the real save barrier for the entire restore and saves a newer edit afterward'`
  - `'rolls back the editor save barrier when restore fails'`
- `src/composables/vault/__tests__/useHistoryWithdraw.test.ts`
  - `'does not open confirmation while another Vault mutation owns the lock'`.

---

### Task 15 — Add Cross-Feature and Regression Tests

- [x] Long Flow A e2e (`edit-program-long-flows.spec.ts`):
      Recovery → History/Diff → Rename across one document life.
      Asserts History never autosaves the document, opens the
      snapshot pane and comparison pane without disturbing the live
      editor, and the renamed document remains reachable in History.
- [x] AI commit-message helper: `server/ai/commitMessage.ts` +
      `/api/ai/commit-message`; client `suggestCommitMessage`.
- [x] i18n for toasts and prompts (`history` namespace, zh + en).
- [x] Test-infra commit (`bf280782566a7f3825484550797bd1660c3b17ea`,
      2026-07-23): explicit timeouts for slow real-git history tests.

---

## Part B — Closure Remediation Tasks

These tasks define the work remaining before Vault Git History can be
declared CLOSED. They were **not** completed during the original
implementation wave and remain open at the time of this
reconstruction. P1 items are **Closure Blockers**.

### History-C1 — Correct `/status` HTTP response contract

**Goal:** `getStatus` must distinguish the graceful-unavailable
`503 { available: false }` signal from a genuine server failure.

**Involved files:**

- `src/lib/history-api.ts` — `getStatus`, `readJson`.

**Recommended implementation:**

- Drop the unconditional `allowNonOkJson: true` for `/status`. Replace
  with a **specific** check: a 503 whose body parses to
  `{ available: false }` is recovered; any other non-2xx (including
  a 5xx without the graceful body) throws.

**Tests required:**

- `src/lib/__tests__/history-api.test.ts`:
  - existing `'resolves with { available: false } on a 503 (graceful unavailable, not an error)'` still passes.
  - new case: `'throws on a 5xx that does not carry available:false'`.
  - new case: `'throws on a 503 whose body is not {available:false}'` (e.g. a real git spawn failure).

**Definition of Done:** `getStatus` is honest about failures; the
panel does not silently treat a real server fault as
`available: false`.

**Risk:** Low — pure client behavior; no server change.

**Closure Blocker:** **Yes**.

---

### History-C2 — Separate commit success from post-commit refresh failure

**Goal:** A commit must be definitively reported as successful after
the `201` body is acknowledged. Any later refresh error (status,
log, comparison) must NOT downgrade the commit to a failure toast.

**Involved files:**

- `src/composables/vault/useHistoryCommit.ts` —
  `submit()`, `refreshAfterCommit`.
- `src/composables/vault/useHistoryWithdraw.ts` — `withdraw()`.
- `src/components/vault/HistoryChangesPanel.vue` — toasts.

**Recommended implementation:**

- Audit the `Promise.all` / `Promise.allSettled` blocks at the end
  of `submit()` and `withdraw()`. Each refresh call must have a
  dedicated catch. Build an aggregate `refreshFailed` flag. Do not
  invoke `toast.error` for the success path under any refresh
  outcome.
- Add a new `refreshFailure` toast key (e.g.
  `history.commit_refresh_failed`) for the case where the commit
  succeeded but at least one refresh threw; never collapse this into
  `commit_failed`.

**Tests required:**

- `src/composables/vault/__tests__/useHistoryCommit.test.ts`:
  - new case: `'commit succeeds when refreshStatus rejects'`.
  - new case: `'commit succeeds when refreshLog rejects'`.
  - new case: `'commit succeeds when refreshComparison throws but returns false'`.
- `src/composables/vault/__tests__/useHistoryWithdraw.test.ts`:
  - new case: `'withdraw succeeds when post-withdraw refresh throws'`.

**Definition of Done:** All post-success refresh paths are caught;
the toast variant is unambiguous.

**Risk:** Low — affects UX messaging only.

**Closure Blocker:** **Yes**.

---

### History-C3 — Eliminate Real-Index synchronization race

**Goal:** Close the documented race between an external `git add`
and the Docus Index Repair fingerprint capture (Spec §11 / H-K3 /
H-C3). The current implementation runs `git reset -q <target> --
<paths>` directly against the Real Index with up to three retries;
an external `git add <target-path>` that lands during the retry
window can be silently cleared on the next attempt, losing the
user's staged intent even though Working Tree bytes may remain.

**Involved files:**

- `server/history/git.ts` — introduce `syncIndexAtomic(repoRoot,
  targetSha, paths)` modeled on the existing `repairIndexWithLock`;
  rewrite `syncIndexPaths` and `syncDroppedIndexPaths` to delegate
  to it.
- `server/__tests__/history-git.test.ts` — new cases listed below.

**Recommended implementation (Temporary Index + atomic replacement):**

The exact shape of this closure is fixed by two facts about Git:

1. Git itself writes `index.lock` while mutating the Real Index.
   Running `git reset` against the Real Index while Docus already
   holds `.git/index.lock` is a recipe for `ENOTDIR` / `EBUSY` /
   silent no-op behavior, depending on platform. **Docus must NOT
   run `git reset` on the locked Real Index.**
2. The existing Repair flow already takes `.git/index.lock` by
   hand, builds a Temporary Index, and renames the result back
   over `.git/index`. The sync path must adopt the same model.

Concretely:

```text
1. Resolve the absolute Git directory via absoluteGitDir(repoRoot).
2. Acquire `.git/index.lock` exclusively:
       fs.open(path.join(gitDir, 'index.lock'), 'wx')
   EEXIST ⇒ return degraded success with
            indexRefreshFailed: true (NOT an error).
   EAGAIN, EBUSY on Windows ⇒ same degraded-success path.
3. Read the current Real Index bytes into memory
   (`fs.readFile(path.join(gitDir, 'index'))`).
4. Create a Temporary Index under a `mkdtemp` dir and write those
   bytes into it as the seed. If the Real Index does not exist,
   initialize via `git read-tree --empty` (still under the lock).
5. Set `GIT_INDEX_FILE` to the Temporary Index for the scoped
   command.
6. Apply the scoped change against the Temporary Index:
      - non-root target:
            git reset -q <targetSha> -- <paths>
      - path was removed by the commit (root or non-root):
            git update-index --force-remove -- <paths>
7. Verify with `git ls-files --stage -- <paths>` against the
   Temporary Index; compare the entries to the expected commit
   tree's entries for the same paths (fingerprint match).
8. Re-check the repository-idle guard, current HEAD, and any
   Index-Repair fingerprint state. Abort and unlock on any
   inconsistency — DO NOT rename and DO NOT retry the
   destructive reset.
9. Write the Temporary Index bytes into `.git/index.lock`.
10. fsync the lock file.
11. Atomically rename `.git/index.lock` to `.git/index`.
12. In `finally`, close + fsync + atomically release any
    Temporary Index tempdir.
```

Properties this preserves (and the current implementation does
not):

- The Real Index is **never** written while another Git
  process holds `.git/index.lock`; if the lock is held, the
  sync degrades cleanly.
- An external `git add <target-path>` during the sync window
  either lands **before** the temp-dir build (and is preserved
  in the seeded Temporary Index) or **after** the rename (and
  survives the next Git operation). The two paths bracket the
  destructive reset.
- There are **no destructive retries**. The current three-attempt
  retry budget is replaced by: one attempt, one verification, one
  rename.
- The pattern is identical to the existing `repairIndexWithLock`
  critical section, so the single `.git/index.lock` mutex is
  shared between routine sync, repair, and any future reads
  that need index consistency.

**Same-path staged-intent protection (pre-sync CAS):**

Seeding the Temporary Index from a copy of the Real Index
protects **unrelated** paths' staged entries, but it does not,
on its own, protect a **same-path** staged entry from being
overwritten. Example:

```text
HEAD a.md       = A
Real Index a.md = B       ← user staged via git add -p
Working Tree    = C       ← unsaved editor content

Docus Create Version commits C (Working Tree bytes).
Temporary Index is seeded from Real Index copy → initially B.
Then reset newHead -- a.md → a.md becomes C.
Atomic rename → Real Index a.md is now C.
User's staged B is cleared.
```

The closure must therefore add a **pre-sync fingerprint CAS**:

```text
1. Before moving HEAD, capture Real Index fingerprints for
   every selected path.
2. For each selected path, determine whether its Index entry
   equals the old HEAD's tree entry:
   - Equal ⇒ path is safe for Docus to synchronize.
   - Not equal ⇒ an external staged intent exists; Docus must
     NOT synchronize this path.
3. After the HEAD CAS succeeds and index.lock is acquired:
   a. Re-read selected-path fingerprints under the lock.
   b. Only paths whose fingerprint is unchanged from step 1
      AND whose pre-commit entry matched old HEAD are reset
      in the Temporary Index to the new HEAD.
   c. Paths that had external staged intent (step 2 mismatch)
      or whose fingerprint changed (step 3a mismatch) are
      preserved as-is in the Real Index.
4. Return degraded success with a `superseded` / `external
   staged intent preserved` marker for skipped paths.
```

The rule is:

> Docus may synchronize only those target paths whose Real
> Index entry matched the old HEAD tree at the start of the
> operation and whose fingerprint did not change between the
> initial capture and the lock acquisition.

**Tests required (`server/__tests__/history-git.test.ts`):**

- existing test `'holds index.lock across validation and atomic replacement'` — unchanged.
- existing test `'discards only repair metadata and preserves newer staged content'` — unchanged.
- new: `'preserves externally staged target-path entry when external staging predates lock acquisition'` —
  seed the Real Index with a staged entry for a target path
  before the Create Version flow starts; assert the entry
  survives the sync (pre-sync fingerprint CAS detects the
  external staged intent and skips the path).
- new: `'external git add fails with index.lock while Docus holds the lock'` —
  after Docus acquires `.git/index.lock`, spawn an external
  `git add <target-path>`; assert the external add fails with
  a non-zero exit and stderr matching
  `/index.lock|another git process/` (the existing Repair test
  already verifies this for the Repair path).
- new: `'external git add succeeds after atomic rename and its staged state persists'` —
  complete the sync and release the lock, then run external
  `git add <target-path>`; assert the add succeeds and the
  staged entry is visible in `git ls-files --stage`.
- new: `'preserves unrelated staged entries while synchronizing selected paths'` —
  seed the Real Index with an entry for a non-selected path,
  commit, sync, assert the unrelated entry still resolves via
  `git ls-files --stage -- <unrelated-path>`.
- new: `'does not retry destructively after an index fingerprint mismatch'` —
  construct a Verified fingerprint but introduce a mismatch
  between verification step and rename; expect a single rename
  attempt followed by a `superseded` repair, NOT three reset
  attempts.
- new: `'returns degraded success when index.lock is already held'` —
  pre-create `.git/index.lock` from the test; run sync;
  expect `indexRefreshFailed: true` and no destructive Real Index
  mutation.
- new: `'atomically replaces the Real Index only after Temporary Index verification'` —
  verify the temp index entry set matches the expected commit
  tree, then assert the rename happens exactly once.
- new: `'skips target-path sync when pre-existing staged entry differs from old HEAD'` —
  seed Real Index with a staged entry for a target path that
  differs from the old HEAD tree entry; assert the sync skips
  that path and returns `superseded` rather than overwriting
  the external staged intent.

**Definition of Done:** The routine Create / Withdraw Real-Index
sync uses the temp-index + atomic-rename path described above.
Destructive retries are removed. The race window is bounded by
`.git/index.lock` rather than by three independent `git reset`
invocations.

**Risk:** Medium — touches the Index Repair critical section. The
existing `holds index.lock across validation and atomic replacement`
test remains the safety floor.

**Closure Blocker:** **Yes**.

---

### History-C4 — Establish Docus commit ownership

**Goal:** Withdraw must reject any commit not created by Docus.

This closure has two halves:

1. **Vault metadata initialization** — every vault must carry a
   `docus-vault-id`, including **already-existing** vault
   repositories that were initialized before this task lands.
2. **Withdraw commit ownership check** — the trailer on a
   candidate commit must be parsed and verified against the
   vault metadata.

Both halves are required.

**Involved files:**

- `server/history/repo.ts` — introduce
  `ensureDocusHistoryMetadata(repoRoot)`. Do not bury it inside
  `ensureRepo`: existing vaults that already have `.git/` skip
  `ensureRepo` entirely, so a separate helper is the only way
  to land a vault-id on those repos.
- `server/history/git.ts` — `addAndCommit` (writes the trailer),
  `dropHeadCommit` (parses the trailer + reads the local
  vault-id + CAS-mismatch → 409), `ensureAuthorIdentity` is
  unchanged.
- `server/history/routes.ts` — every ownership-sensitive handler
  calls `ensureDocusHistoryMetadata` before work; `/drop` maps
  the ownership failure to 409.
- `server/__tests__/history-git.test.ts`,
  `server/__tests__/history-routes.test.ts` — new cases below.
- `server/history/__tests__/` (or co-located) — a new suite
  pinning `ensureDocusHistoryMetadata` behavior on an
  already-initialized vault.

**Recommended implementation — metadata init:**

The helper `ensureDocusHistoryMetadata` needs the absolute Git
directory. The current `absoluteGitDir` is an internal (non-exported)
helper inside `git.ts`. The closure task must choose one of:

- **Option 1** — Export a public `resolveAbsoluteGitDir(repoRoot)`
  from `git.ts`.
- **Option 2** — Keep `ensureDocusHistoryMetadata` inside `git.ts`
  (where `absoluteGitDir` is already in scope).
- **Option 3** — Introduce a small public Git-dir resolver in
  `repo.ts` without duplicating the spawn logic.

The example below assumes Option 1 or 2 has been applied;
without an export change the example code does not compile.

```ts
// server/history/repo.ts (new export)
export async function ensureDocusHistoryMetadata(
  repoRoot: string,
): Promise<DocusHistoryMetadata> {
  const gitDir = await git.absoluteGitDir(repoRoot)
  const docusDir = path.join(gitDir, 'docus')
  await fs.mkdir(docusDir, { recursive: true })
  const idPath = path.join(docusDir, 'docus-vault-id')

  try {
    // exclusive create — fails with EEXIST if it's already there
    const handle = await fs.open(idPath, 'wx')
    try {
      const id = crypto.randomUUID()
      await handle.writeFile(id, 'utf8')
      await handle.sync()
      return { vaultId: id, created: true }
    } finally {
      await handle.close()
    }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === 'EEXIST') {
      const existing = (await fs.readFile(idPath, 'utf8')).trim()
      // Malformed or missing vault-id: refuse to mint a new one
      // implicitly. Quarantine the bad file and reseed on a
      // subsequent call.
      if (!isValidVaultId(existing)) {
        const quarantine = path.join(
          docusDir,
          `docus-vault-id.corrupt-${Date.now()}-${crypto.randomUUID()}.txt`,
        )
        await fs.rename(idPath, quarantine)
        throw new Error('docus-vault-id is malformed; quarantined')
      }
      return { vaultId: existing, created: false }
    }
    throw cause
  }
}
```

Properties:

- **Idempotent on already-initialized vaults.** Existing
  vaults with a valid `docus-vault-id` get `created: false`
  and read their id back unchanged.
- **First-touch on first Create / Withdraw.** New vaults
  (or vaults whose metadata was never written) get a UUID
  on the first call.
- **Quarantine, never delete, on corrupt id.** A malformed
  file is moved aside with a timestamp + random suffix; the
  next call reseeds.
- **Caller decides when to call.** `addAndCommit` and
  `dropHeadCommit` invoke it before they touch any commit
  object. The route layer also calls it in case the Git
  repository is touched by a read that needs an authoritative
  vault-id.

**Recommended implementation — commit ownership:**

Create Version trailer:

```text
Docus-Version: 1
Docus-Vault-Version: <stable-id>
```

`<stable-id>` is the local `docus-vault-id`.

Withdraw verification:

```text
1. ensureDocusHistoryMetadata → localVaultId
2. read HEAD's commit object
3. parse trailers (last paragraph of the commit message that
   uses the Git convention 'Key: Value')
4. accept if and only if:
      trailers["Docus-Version"] === "1"
      AND trailers["Docus-Vault-Version"] === localVaultId
      AND commit has exactly one parent OR parent === null
        (root commit, allowed)
      AND every changed path is a managed History Markdown path
        (i.e. passes isValidHistoryPath + endsWith('.md'))
      AND commit is NOT a merge commit
5. mismatch or missing trailer ⇒ 409 'commit is not a Docus
   version; cannot withdraw'
```

Short SHAs (`7–40 hex`) are still accepted at the route
boundary; the route resolves them via `rev-parse --verify` to
a full SHA before applying the trailer check (Plan History-C6
under the same fix).

**Tests required:**

- `server/history/__tests__/repo.test.ts` (new, for the helper):
  - new: `'creates docus-vault-id on first call'`.
  - new: `'returns the same id on subsequent calls'`.
  - new: `'preserves an already-initialized vault repository'`
    — seed a real `git init` repo with no `docus/` subdir;
    assert the helper writes the id without clobbering the
    vault's existing dotfiles.
  - new: `'quarantines and refuses to use a malformed id'`.

- `server/__tests__/history-git.test.ts`:
  - new: `'withdraw rejects a non-Docus commit at HEAD'`.
  - new: `'withdraw rejects a Docus commit from a different vault'`.
  - new: `'withdraw accepts a Docus commit whose vault-id matches'`.
  - new: `'withdraw rejects a merge commit even with a valid trailer'`.
  - new: `'withdraw rejects a commit whose change set includes a non-Markdown path'`.

- `server/__tests__/history-routes.test.ts`:
  - new: `'returns 409 when an external commit is at HEAD'`.

**Migration (legacy commits without trailer) — Owner Decision:**

The current implementation already shipped Docus commits without
a vault-id trailer. The closure task cannot unilaterally
rebrand them. Three migration options are recorded below.
**Owner must choose before the closure task lands.**

```text
Option A (recommended, fail closed):
   Old unowned commits cannot be withdrawn. Existing Docus
   users see the 409 message until they recommit through a
   new Create Version (which lands a trailer). The new
   commit becomes withdrawable.

Option B:
   One-time migration marks only the current HEAD through
   an explicit owner-confirmed operation
   (POST /api/history/legacy-claim-current-head). No batch
   migration. Every other old commit is refused.

Option C:
   Legacy ownership is inferred by a strictly documented,
   fail-closed compatibility rule (e.g. "commits authored
   by the local docus identity, after a watermark date, are
   treated as Docus commits"). Rejected by default because
   it expands the closure scope to migration tooling.
```

The default in the absence of an Owner choice is **Option A
— fail closed**. Document this default in the Final
Closure's Known Risks.

**Definition of Done:** Withdraw is restricted to Docus-created
commits from the same vault, AND every active vault has a
`docus-vault-id` file under `<git-dir>/docus/`.

**Risk:** Medium.

**Closure Blocker:** **Yes** (also depends on an Owner choice on
migration).

---

### History-C5 — Make Restore ref resolution atomic
(server + client)

**Goal:** Close the Restore TOCTOU window so the response bytes
reflect what was actually written to disk. The route must resolve
the accepted request ref to one immutable full commit SHA inside
`withRepoMutation`, use that resolved SHA for both the source
read and the restore command, and re-read disk bytes after the
restore. The client must treat the server's post-restore bytes
(`result.raw`) as authoritative over the gesture-time snapshot
(`request.historicalRaw`).

**Involved files:**

- `server/history/routes.ts` — `POST /restore` (resolves to
  immutable SHA inside `withRepoMutation`).
- `server/history/git.ts` — `restoreFile` (route-side invocation
  already passes `--source=<sha>`; no underlying change).
- `src/lib/history-api.ts` — `RestoreFileResult` shape gains
  `requestedRef` and `resolvedRef` fields and renames `ref` →
  `requestedRef` for callers that want to display the
  textual ref (the resolved SHA is the authoritative form).
- `src/composables/vault/useHistoryRestore.ts` — `restore()` uses
  `result.raw` for `tab.raw`, `tab.originalRaw`, and the
  `VaultFileChanges.publish({ newRaw })` event, not
  `request.historicalRaw`. Pass the source view bytes only as
  the diff/comparison context already lives in `comparison.oldRaw`.
- `src/composables/vault/__tests__/useHistoryRestore.test.ts` —
  new cases below.

**Recommended implementation — server:**

Inside one `withRepoMutation(repoRoot)` transaction:

```text
1. Resolve the accepted request ref to a full immutable commit SHA:
       rev-parse --verify <acceptedRef>^{commit}
   Failure ⇒ 404 'cannot resolve ref <acceptedRef>'.
2. Read the source snapshot:
       git show <resolvedSha>:<path>          → source raw
   null ⇒ 404 'file does not exist at ref <acceptedRef>'.
3. Apply the restore:
       git restore --source=<resolvedSha> --worktree -- <path>
4. Re-read the post-restore Working Tree bytes:
       fs.readFile(repoRoot/<path>, 'utf8')   → restored raw
5. Stat for mtime:
       fs.stat(repoRoot/<path>).mtimeMs      → restored mtime
6. Return:
       {
         path,
         requestedRef: acceptedRef,   // textual as the client sent it
         resolvedRef: resolvedSha,    // full 40-char SHA, authoritative
         raw: restored raw,           // post-restore Working Tree bytes
         mtime: restored mtime,
       }
```

`source raw` and `restored raw` are both kept in the local scope
for an optional audit log; only `restored raw` ships in the
response. The client must read `result.raw` and never look back
at the gesture-time snapshot.

**Recommended implementation — client:**

`useHistoryRestore.restore(source)`:

```text
1. Capture the source view (`revisionId`, `historicalRaw`,
   `revisionTime`, `currentDirty`) into a `HistoryRestoreRequest`
   at the moment of the user's gesture. This request is **only**
   used for:
       - the confirmation dialog payload;
       - the `useHistoryComparisons` re-derivation if the user
         later wants the old-vs-now diff (which lives on
         `comparison.oldRaw`, not in `tab.raw`).
2. Acquire the path mutation lock, open the editor save
   barrier, then call `historyApi.restoreFile(path, revisionId)`.
3. The server returns `RestoreFileResult` as defined above;
   treat `result.raw` as the authoritative restored bytes.
4. Update the open editor tab:
       - If `preparedRevision == null` OR `tab.revision ===
         preparedRevision`: apply `result.raw` to both
         `tab.originalRaw` and `tab.raw`, set `savedRevision`,
         advance `revision`, and reset error / loadError.
       - Otherwise: apply `result.raw` to `tab.originalRaw`
         only (the user's typing takes precedence over the
         restored baseline). Mark `saveStatus: 'dirty'`.
5. Publish `VaultFileChanges.publish({
       path,
       kind: 'write',
       newMtime: result.mtime,
       newRaw: result.raw,           ← post-restore bytes
       source: 'history-restore',
   })`.
6. Refresh vault state and comparison. Partial refresh failure
   reports success with `refreshFailed: true`, never an error.
```

If the server contract diverges from the gesture-time snapshot
(server-side normalization, repo re-encoding, etc.), the
client surfaces the discrepancy via `result.raw` and the
mtime; it must not silently trust `request.historicalRaw` for
either the editor tab or the file-change event.

**Tests required:**

Server (`server/__tests__/history-routes.test.ts`):

- existing 9 cases pass.
- new: `'resolves HEAD to one immutable SHA before read and restore'`.
- new: `'returns post-restore Working Tree bytes'` (assert
  `result.raw === fs.readFile(repoRoot/path)`).
- new: `'does not return bytes from a different resolution of a mutable ref'`
  (mutate HEAD between `rev-parse` and `git restore` and assert
  the response resolves both to the same SHA).
- new: `'returns 404 when resolveRev fails'`.
- new: `'uses the resolved SHA for the restore command, not the textual ref'`.

Client (`src/composables/vault/__tests__/useHistoryRestore.test.ts`):

- existing 12 cases pass.
- new: `'uses server returned raw as restored editor content'`
  — `mockRestoreFile` returns a result whose `raw` deliberately
  differs from `historicalRaw`; expect `tab.raw` /
  `tab.originalRaw` to reflect the server bytes.
- new: `'publishes server returned raw in the file-change event'`
  — `expect(publish).toHaveBeenCalledWith({ newRaw: result.raw })`.
- new: `'preserves newer editor edits while updating originalRaw from result.raw'`
  — race a tab edit during pending restore; assert
  `tab.originalRaw === result.raw`, `tab.saveStatus === 'dirty'`,
  and `tab.raw` untouched.
- new: `'reports refresh failure as success without trusting historicalRaw'`
  — `refreshVault` rejects; expect `onSuccess({ refreshFailed: true })`
  not `onError`.

**Definition of Done:**

- The route resolves and uses one full immutable SHA for both
  the read and the write, all inside `withRepoMutation`.
- The route's `raw` field carries post-restore Working Tree
  bytes, not pre-restore source bytes.
- The client writes `result.raw` into the editor tab and the
  file-change event; `request.historicalRaw` is no longer used
  for either, only for the comparison pane's old-side view.
- Newer editor edits are preserved.

**Risk:** Low — net tightening of the contract.

**Closure Blocker:** **Yes**.

---

### History-C6 — Align short-SHA validation and behavior

**Goal:** Either reject short SHAs at the `/drop` boundary or
resolve them to full SHAs.

**Involved files:**

- `server/history/validation.ts` — `isValidCommitSha`.
- `server/history/git.ts` — `dropHeadCommit` (resolve short to full
  SHA via `rev-parse --verify`).
- `server/history/routes.ts` — `/drop`.

**Recommended implementation:**

- Lower bound `isValidCommitSha` to 40 (no 7–40). Or — keep 7–40
  and require the route to call `rev-parse --verify <sha>` before
  `HEAD === sha`.

**Tests required:**

- `server/__tests__/history-git.test.ts`:
  - new: `'withdraws when given a 7-char short SHA that uniquely resolves to a full SHA'`.
  - new: `'withdraws when given a 40-char full SHA'`.

**Definition of Done:** Short SHA boundary is consistent.

**Risk:** Low. UX wart, not a data-correctness issue.

**Closure Blocker:** Yes (named as P2 in Spec §25 H-K6, marked Yes
because it bites every short-SHA withdraw attempt).

---

### History-C7 — Correct DST-safe local-calendar timeline grouping

**Goal:** The current `useHistoryTimeline.groupTimelineItems` buckets
items by `Math.floor((todayStart - itemStart) / 86_400_000)`, where
`todayStart` / `itemStart` are computed via the `Date` constructor
with local-calendar fields. Across a DST transition those buckets
do not correspond to local calendar days; a commit timestamped
00:30 local on a DST forward-fallback day may be classed into the
wrong bucket. Owner Review observed that pinning this behavior
with a regression test would lock in a known-wrong display, so
the closure task is to **fix** the bucketing so it stays
DST-correct, then pin the correct behavior.

**Involved files:**

- `src/composables/vault/useHistoryTimeline.ts` — replace the
  ms-window bucket math with a DST-safe local-calendar ordinal.
  Introduce a single pure helper `localDayOrdinal(timestamp)` and
  use it for both `now` and the item under comparison.

**Recommended implementation:**

Replace

```text
const dayDelta = Math.max(0, Math.floor((today - startOfDay(timestamp)) / 86_400_000))
```

with a DST-safe comparator:

```ts
function localDayOrdinal(timestamp: number): number {
  const date = new Date(timestamp)
  return Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ) / 86_400_000
}

const todayOrdinal = localDayOrdinal(now)
const itemOrdinal  = localDayOrdinal(timestamp)
const dayDelta     = Math.max(0, todayOrdinal - itemOrdinal)
```

The integer ordinal counts local-calendar days from an absolute
epoch (1970-01-01 local), so two timestamps that fall on the
same local calendar day have the same ordinal regardless of how
many real hours lie between them. DST transitions cannot change
the ordinal difference. Bucket labels remain "Today / Yesterday /
weekday-name / Last Week / Month / Earlier".

The pure `localDayOrdinal` must be exported (or at least
re-exported from the test) so that DST cases can be reproduced
in a deterministic test environment.

**Tests required (`src/composables/vault/__tests__/useHistoryTimeline.test.ts`):**

The default Vitest environment inherits the **host** TZ, so a
DST regression test runs against whichever TZ the CI container
is configured with. To make the test deterministic the project
must allow either of:

- an explicit `process.env.TZ` override per test (e.g.
  `beforeEach(() => { process.env.TZ = 'America/Los_Angeles' })`
  with a `vi.resetModules()` plus `vi.useFakeTimers()` around
  the matrix), or
- spawning a Node child process via `child_process.spawnSync`
  with `env: { ...process.env, TZ: 'America/Los_Angeles' }`
  for the DST cases.

Either approach is acceptable; the closing requirement is
**that the DST cases are exercised under a known TZ, not skipped**.

Tests:

- existing case `'groups Today, Yesterday, weekdays, and Last
  Week in display order'` — unchanged.
- new: `'groups correctly across DST spring-forward (23-hour gap)'`
  — TZ `America/Los_Angeles`.
  `now`:    2026-03-09T00:30:00-07:00 (after spring-forward).
  `item`:   2026-03-08T00:30:00-08:00 (before spring-forward).
  Elapsed duration: 23 hours real time.
  Expected bucket: `'yesterday'` (different local calendar day;
  the 23-hour real gap would produce `dayDelta = 0` under the
  old 86_400_000 ms window, but `localDayOrdinal` correctly
  sees the ordinal difference of 1).
- new: `'groups correctly across DST fall-back (25-hour gap)'`
  — TZ `America/Los_Angeles`.
  `now`:    2026-11-02T00:30:00-08:00 (after fall-back).
  `item`:   2026-11-01T00:30:00-07:00 (before fall-back).
  Elapsed duration: 25 hours real time.
  Expected bucket: `'yesterday'` (different local calendar day;
  `localDayOrdinal` correctly sees the ordinal difference of 1).
- new: `'groups today correctly near local midnight'`
  — TZ `Europe/Berlin`, `now` at 00:30 local, item at
  23:30 the previous local day → bucket `'yesterday'`.
- new: `'does not classify future timestamps as earlier buckets'`
  — `now` set, item with `timestamp > now + 90_000` —
  expected bucket key is `'today'` (the cap is `Math.max(0, …)`
  not future-buckets).

**Definition of Done:** `groupTimelineItems` uses
`localDayOrdinal` for the bucket delta, the pure helper is
re-exported for tests, all four new DST cases pass under the
configured TZ, and no future-bucket key is emitted.

**Risk:** Low — pure-function change isolated to one file.

**Closure Blocker:** No (P2 from the prior review; correctness
fix rather than a new feature).

---

### History-C8 — Complete Windows full-suite verification

**Goal:** Re-run the test suites on Windows; confirm the explicit
timeouts added in `bf28078` are sufficient; record any
unrelated-resource-leak / EBUSY / EPERM observations.

**Involved files:** none (test runs).

**Recommended implementation:**

- Run `npm test -- --run` on macOS, Linux, and Windows (CI).
- Capture the platform matrix. Save the green commit SHAs in the
  Final Closure.

**Tests required:** N/A — this is a verification pass.

**Definition of Done:** Three-platform test run is recorded in the
Final Closure.

**Risk:** Variable; Windows file locking has historically been the
sensitive area. Mitigation is the explicit timeouts added in
`bf28078`.

**Closure Blocker:** **Yes**.

---

### History-C9 — Add missing regression tests

**Goal:** Backfill tests for the documented coverage gaps.

Concrete cases (referenced in Implementation Record §12):

- [ ] The `GIT_INDEX_FILE`/temp index contract is asserted by
      outcomes, not by direct instrumentation. Add a test using
      `GIT_INDEX_FILE` monkey-patch or a stream-level probe.
- [ ] Repository-operation markers not all parametrized. Add direct
      tests for `REVERT_HEAD`, `REBASE_HEAD`, `rebase-apply`,
      `sequencer`.
- [ ] Path validation for backslash, absolute, hidden-dir. Add direct
      cases.
- [ ] Short SHA behavior at `/drop`. (Covered by History-C6 tests.)
- [ ] Multi-vault / `withRepoMutation` keying — instrument to
      assert two operations on the same vault serialize and two
      operations on different vaults parallel.
- [ ] Restore race — refer to History-C5 tests.

**Tests required:** listed above.

**Definition of Done:** The coverage map in Implementation Record
§12 has no "Missing" rows for the items above.

**Risk:** Low.

**Closure Blocker:** Yes (combined with H-C1/C2/C3/C4/C5/C8).

---

### History-C10 — Run final closure verification

**Goal:** Execute the full verification list in Spec §24 and
Closure §6.

**Involved files:** none.

**Recommended implementation:**

- Run `npm run typecheck`, `npm run build`,
  `npm test -- --run`, `git diff --check`.
- Capture the baseline SHA, the verification SHA, and the green
  matrix.
- Update the Final Closure with the verified result.

**Risk:** None — verification only.

**Closure Blocker:** **Yes**.

---

### History-C11 — Record immutable final production baseline

**Goal:** Mark the Final Production Code SHA explicitly, separate
from the documentation review baseline.

**Involved files:**

- `docs/vault-git-history-final-closure.md` (Final Closure
  document).

**Recommended implementation:**

- After all C-tasks complete and CI is green, capture the immutable
  SHA. Write it to the Final Closure's §1.

**Risk:** None.

**Closure Blocker:** **Yes**.

---

### History-C12 — Update README and enter maintenance mode

**Goal:** Make the closed feature visible in the README and list
the chain of documents.

**Involved files:**

- `README.md` — Feature Status table.

**Recommended implementation:**

- Add a "Vault Git History" row to the Feature Status table with
  status `Closed (verified in main @ <SHA>)`.
- Add links to Spec / Plan / Implementation Record / Final Closure.

**Risk:** None.

**Closure Blocker:** **Yes** (entry into maintenance mode is the
explicit outcome of closure).

---

## Execution Order

```text
Phase 0  Documentation reconstruction                    [in flight]
Phase 1  API and UI truthfulness fixes
   History-C1, History-C2                                ← client-only
   History-C9 (overlap)
Phase 2  Git ownership and index-safety fixes
   History-C3, History-C4                                ← server-side
Phase 3  Restore + edge-case fixes
   History-C5, History-C6, History-C7                    ← server + client
Phase 4  Verification
   History-C8, History-C10, History-C11                  ← run + record
Phase 5  Final closure
   History-C12                                           ← README + status flip
```

A maintenance-mode declaration is **not** allowed in Phase 0; it
becomes allowable only after Phase 4 closes with green CI on every
platform and every P1 closure blocker is verified.
