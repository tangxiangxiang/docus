# Vault Git History — Implementation Record

## 1. Record Status

```text
Retrospective implementation record
Code baseline reviewed: 00b17359d151bbdbe56115ed992700ecbb5e1ca1 (2026-07-30, tip of main at documentation time)
Record date: 2026-07-30
Source: tangxiangxiang/docus
Branch: main
```

This document is a snapshot of what the implementation actually
delivered at the time of the documentation reconstruction. It is not
a forward-looking roadmap; forward-looking tasks live in the
Implementation Plan Part B and the Final Closure §4.

Closure is **not** declared here. The companion document
[`vault-git-history-final-closure.md`](vault-git-history-final-closure.md)
defines what evidence would be required to close the feature and
records what evidence is currently missing.

## 2. Architecture Overview

```text
                         Browser (Vue 3 + Monaco)
                                  │
   ┌──────────────────────────────┼────────────────────────────────┐
   │                              │                                │
   ▼                              ▼                                ▼
HistoryPanel.vue      HistoryChangesPanel.vue       HistorySnapshotPane.vue
HistoryComparisonPane.vue
   │                       │                │                │
   │ composables           │                │                │
   ▼                       ▼                ▼                ▼
useHistory          useHistoryCommit     useHistorySnapshots  useHistoryComparisons
   │   │                    │                  │                  │
   │   │ useHistoryTimeline │ useHistoryRestore                    │ useHistoryWithdraw
   │   │ pathMutationLock   │
   │   ▼                    ▼                  ▼                  ▼
useHistoryTimeline  useHistoryWithdraw    useHistoryRestore  useHistoryCommit (Register Repair)
   │                       │                  │                  │
   │                       ▼                  ▼                  ▼
   │                  useHistorySnapshots.useHistorySnapshots.openRevision → restore
   │                                                                   → withdraw
   ▼
src/lib/history-api.ts   (typed fetch wrappers, share types with server)
                                  │
                                  ▼  fetch /api/history/*
                     server/index.ts: app.route('/api/history', historyRoutes)
                                  │
                                  ▼
                         server/history/routes.ts   (Hono sub-router, 12 endpoints)
                                  │
              ┌───────────────────┼────────────────────────────┐
              │                   │                            │
              ▼                   ▼                            ▼
        routes.ts         server/history/validation.ts   server/history/diff.ts
        ensureRepo                                                │
              │                                          computeFileDiff (re-export)
              ▼                                                   │
   server/history/repo.ts                                       server/history/
              │                                                  routes.ts: GET /diff
              ▼
   server/history/git.ts                          ──────────────┘
              │
   spawn('git', args, ...)
              │
              ▼
   git CLI (PATH-resolved)
```

Layering per the source comment in `server/history/git.ts`:

- **L0**: `git.ts` — only module that runs `git`.
- **L1**: `diff.ts` — `computeFileDiff` re-export.
- **L2**: `routes.ts` + `repo.ts` — HTTP and bootstrap.
- **L3**: client UI — out of scope for the server module.

## 3. Module Responsibilities

| Module | File | Role |
|--------|------|------|
| **L0 git wrapper** | `server/history/git.ts` | Spawn-only module. Encapsulates every `git` invocation, the per-vault mutation mutex (`withRepoMutation`), the repository-idle guard, the temporary-index mechanics for Create Version, the CAS update-ref, the Real-Index synchronization and Repair system, the Index Repair JSON store, the worktree-only Restore, the Withdraw (two-phase), and the WORKTREE sentinel. Also owns `parsePorcelain`, `parseLog`, `findHeaderEnd`, `ensureAuthorIdentity`, `captureExpectedFiles`, `getAbsoluteGitDir`. |
| **Path / Ref / SHA validation** | `server/history/validation.ts` | Defines `isValidHistoryPath`, `isValidHistoryRef`, `isValidCommitSha`, `validateHistoryPaths`, `MANAGED_HISTORY_DOTFILES`, and the SHA regexes (incl. `SHA_ANCESTOR_RE`). |
| **Repo bootstrap** | `server/history/repo.ts` | `ensureRepo(repoRoot)`. Idempotent first-touch setup of `.gitignore`, `.gitattributes`, `git init`, `core.autocrlf=false`. |
| **Diff bridge** | `server/history/diff.ts` | Re-exports `computeFileDiff` from `src/lib/file-diff.js`. |
| **L2 HTTP** | `server/history/routes.ts` | Hono sub-router mounted at `/api/history`. Houses the 12 endpoints, the `bad(c, msg, code)` helper, capability caching (`_gitAvailable`), per-request `probeGit()` + `ensureRepo(repoRoot())`, and the validation ladder for every entry point. |
| **Test mount** | `server/index.ts:23` | `app.route('/api/history', historyRoutes)`. |
| **Wire types** | `src/lib/history-api.ts` | `Capability`, `StatusEntry`, `CommitRecord`, `WORKTREE_REF`, `DiffOp`, `FileDiff`, `HistoryApiError`, `CommitResult`, `IndexEntryFingerprint`, `IndexRepairTransaction`, `ContentHashes`, `RepairIndexResult`, `DropCommitResult`, `RestoreFileResult`. Typed fetch wrappers for every endpoint. |
| **Per-vault state** | `src/composables/vault/useHistory.ts` | `HistoryState` facade: capability / status / log / dirtyCount, and refresh helpers. `useHistory(context)` is the only way to get a `HistoryState`; it owns the WeakMap per `VaultContext`. |
| **Mutation lock** | `src/composables/vault/pathMutationLock.ts` | `createPathMutationLock()` returning `{ paths, global, canAcquire, canAcquireAll, acquire, acquireAll, has }`. Used by Create Version, Restore, and Withdraw. |
| **Create flow** | `src/composables/vault/useHistoryCommit.ts` | Selection state, `submit()`, register/settle Repair transactions, retry/discard Repair UI. |
| **Timeline aggregation** | `src/composables/vault/useHistoryTimeline.ts` | `toHistoryRevisionSelection`, `groupTimelineItems` (Today/Yesterday/weekday/Last Week/Month/Earlier), per-document fetch with request-id guards. |
| **Snapshot pane state** | `src/composables/vault/useHistorySnapshots.ts` | `openRevision`, `openCachedRevision`, `selectSnapshot`, `retrySnapshot`, `viewCurrent`, `closeSnapshot`, `closeSnapshots`. Tri-state `loading|ready|error`. |
| **Comparison pane state** | `src/composables/vault/useHistoryComparisons.ts` | `getLoadedEditorDocument`, `useHistoryComparisons`, current-side resolution (live editor raw → saved-document API fallback). |
| **Restore flow** | `src/composables/vault/useHistoryRestore.ts` | `restore()` with capture-at-confirmation semantics, Mutation Lock, Document Save Barrier integration, conflict callback, partial-failure reporting. |
| **Withdraw flow** | `src/composables/vault/useHistoryWithdraw.ts` | `withdraw(sha)`, lock acquisition (vault-wide), 409 conflict classification, post-withdraw refresh bundle, repair register/settle. |
| **History panel** | `src/components/vault/HistoryPanel.vue` | Top-level view; emptiness states, capability-driven rendering, Timeline listbox, Revision context menu, focus restoration. |
| **Changes composer** | `src/components/vault/HistoryChangesPanel.vue` | Checkbox list, version-message textarea (Ctrl/Cmd+Enter submit), Repair banner with retry / discard. |
| **Snapshot pane** | `src/components/vault/HistorySnapshotPane.vue` | Read-only viewer, restore / open-diff / view-current / close toolbar, busy / loading / error states, `focusViewer` exposed for host. |
| **Comparison pane** | `src/components/vault/HistoryComparisonPane.vue` | Side-by-side via `<SideBySideDiff>`, restore / view-historical / view-current / close toolbar, identical-state badge. |
| **Timeline rows** | `src/components/vault/TimelineDocumentRow.vue`, `TimelineRevisionRow.vue`, `TimelineGroup.vue` | Pure presentational; `role="option"` rows. |
| **Diff renderer** | `src/components/vault/SideBySideDiff.vue` | Pairs equal+remove+add ops into rows; syncs vertical scroll between the two panes. |
| **Shared diff algorithm** | `src/lib/file-diff.ts` | `computeFileDiff(old, new)` — line + optional word breakdown for edit-shaped pairs. |
| **Date formatter** | `src/lib/history-date.ts` | `historyLocale()`, `formatHistoryDate(timestamp, locale)` — uses `Intl.DateTimeFormat`. |

## 4. HTTP API Inventory

API base: `/api/history`. All bodies are JSON. Error bodies are
`{ error: <string> }`.

| Method | Path | Request | Success | Failure modes |
|--------|------|---------|---------|---------------|
| GET | `/capability` | — | `{ gitAvailable, repoInitialized, initError? }` | never non-200 (always 200; failure surfaces in body) |
| GET | `/status` | — | `{ dirty: StatusEntry[], available: true }` | 503 `{ dirty: [], available: false }` (graceful); 5xx (need to add a real-error path; see H-C1) |
| POST | `/content-hashes` | `{ paths: string[] }` | `{ hashes: Record<path, sha256 | null> }` | 400, 500, 503 |
| GET | `/log` | `?path=<opt>&limit=<opt, default 200>` | `{ commits: CommitRecord[] }` | 400, 500, 503 |
| GET | `/file` | `?path=<req>&ref=<req>` (default `HEAD`) | `{ path, ref, content }` | 400, 404, 500, 503 |
| GET | `/diff` | `?path=<req>&old=<req>&new=<req>` | `{ path, oldRef, newRef, diff: FileDiff }` | 400, 500, 503 |
| POST | `/commits` | `{ paths, message, expected }` | 201 `{ sha, filesCommitted, indexRefreshFailed?, indexRepair?, repairStatePersistenceFailed? }` | 400, 409, 500, 503 |
| GET | `/repair-status` | — | `{ transactions: IndexRepairTransaction[] }` | 500, 503 |
| POST | `/repair-index` | `{ token }` | `{ repaired: true, repairStatePersistenceFailed? }` | 400, 409, 500, 503 |
| POST | `/repair-index/discard` | `{ token }` | `{ discarded: true }` | 400, 409, 500, 503 |
| POST | `/drop` | `{ sha }` | 200 `{ sha, droppedSha, filesChanged, indexRefreshFailed, indexRepair?, repairStatePersistenceFailed }` | 400, 404, 409, 500, 503 |
| POST | `/restore` | `{ path, ref }` | 200 `{ path, ref, raw, mtime }` | 400 (WORKTREE refused), 404 (file/ref missing), 500, 503 |

**Side effects** of note:

- `/commits` may create one commit, may push CAS-updates through
  `HEAD`, and may persist or clear an Index Repair Transaction.
- `/restore` mutates the Working Tree only (no `update-ref`, no
  Real-Index manipulation, no commit creation).
- `/drop` mutates `HEAD` only (no Working Tree, may emit an Index
  Repair Transaction).
- `/repair-index` writes to the Real Index by hand via
  `.git/index.lock` + temp-file + `fs.rename`. Always inside
  `withRepoMutation`.
- `/repair-index/discard` does **not** touch the Real Index; it
  edits the JSON metadata only.

`ensureRepo` runs in **every** route handler (except
`/capability`). First-touch side effects include `.gitignore`
creation (overwriting is forbidden), `.gitattributes` creation
(also non-overwriting), `git init`, and `core.autocrlf false`.

## 5. Git Command Inventory

Every CLI invocation the server makes, with the exact arguments and
the site that uses it.

| Command (exact args) | Site (file) | Purpose |
|---|---|---|
| `['--version']` | `routes.ts:103` | Capability probe. |
| `['rev-parse', '--is-inside-work-tree']` | `git.ts:145` | `isRepo`. |
| `['init', '--initial-branch=main']` → `['init', '--initial-branch=master']` → `['init']` | `git.ts:159-161` | `initRepo` 3-step fallback. |
| `['config', 'core.autocrlf', 'false']` | `git.ts:168` | Byte stability. |
| `['config', '--local', '--get', 'user.name' \| 'user.email']` | `git.ts:460, 467` | Identity presence probe. |
| `['config', '--local', 'user.name' \| 'user.email', <value>]` | `git.ts:462, 469` | Identity write (env-var or fallback). |
| `['status', '--porcelain', '--untracked-files=all']` | `git.ts:220` | Status. |
| `['log', '--pretty=format:…', '--name-only', '-n<limit>']` + `['--', path]` | `git.ts:266-279` | Log (with/without path filter). |
| `['show', '<ref>:<path>']` | `git.ts:393` | `rawAt`. |
| `['rev-parse', '--absolute-git-dir']` | `git.ts:548, 576` | Git dir for repair metadata. |
| `['rev-parse', '--verify', 'HEAD']` | `git.ts:571, 927, 936, 1111` | HEAD value (CAS expectation). |
| `['rev-parse', '<head>^{tree}']` | `git.ts:1155` | Empty-tree guard before `write-tree`. |
| `['rev-parse', '<sha>^']` | `git.ts:1302` | Withdraw parent resolution. |
| `['ls-files', '--stage', '--', <path>]` | `git.ts:718, 1123, 1142` | Real-Index fingerprint / staged-blob verification. |
| `['read-tree', '--empty']` | `git.ts:849, 1114, 1241` | Empty temp-index seed. |
| `['read-tree', '<headSha>']` | `git.ts:1113` | HEAD-seeded temp index. |
| `['hash-object', '-w', '--path=<p>', '--stdin']` | `git.ts:1131` | Blob from captured Working Tree bytes. |
| `['update-index', '--add', '--cacheinfo', '100644', <oid>, <path>]` | `git.ts:1138` | Stage blob. |
| `['update-index', '--force-remove', '--', …paths]` | `git.ts:855, 1121, 1247` | Stage deletion in temp index. |
| `['add', '--', …paths]` | `git.ts:1148` | Fallback Real-Index stage (no expected). |
| `['write-tree']` | `git.ts:1151` | Tree from temp index. |
| `['commit-tree', <tree>, ('-p', <parent>), '-m', <message>]` | `git.ts:1165-1168` | Commit object (no hooks; verified plumbing). |
| `['update-ref', 'HEAD', <commitSha>, <expectedOld>]` | `git.ts:1177` | CAS commit. |
| `['update-ref', 'HEAD', <parent>, <sha>]` | `git.ts:1309` | CAS withdraw (non-root). |
| `['update-ref', '-d', 'HEAD', <sha>]` | `git.ts:1308` | CAS withdraw (root). |
| `['show', '--name-only', '--pretty=', <commitSha>]` | `git.ts:1181` | Files committed. |
| `['show', '--no-renames', '--name-only', '--pretty=', <sha>]` | `git.ts:1296` | Files in withdrawn commit. |
| `['reset', '-q', <head>, '--', …paths]` | `git.ts:856, 934, 1248` | Real-Index sync (single path) — Create, Repair, Drop. |
| `['diff', '--cached', '--quiet', <head>, '--', …paths]` | `git.ts:867, 937, 1257` | Sync verification. |
| `['merge-base', '--is-ancestor', <txHead>, <currentHead>]` | `git.ts:968` | Repair compatibility gate. |
| `['restore', '--source=<ref>', '--worktree', '--', <path>]` | `git.ts:1366` | Restore — no Index involvement. |

Note that **`log --follow` is deliberately not used**:

```text
// git.ts:273-279
// No `--follow` for now: on a vanilla "create new file" commit,
// `--follow` falsely attributes earlier commits of unrelated files
// to this path.
```

Renames therefore get a fresh `DocumentHistory` entry under the new
path; the old-path history is not merged in. See Plan §15 H-K9.

## 6. Create Version Sequence

The complete end-to-end Create Version sequence, as it actually
executes at the time of this record:

```text
HistoryChangesPanel emits 'submit'
        │
        ▼
useHistoryCommit.submit():
   1. busy = true, busyPaths = Set(paths)
   2. releaseMutation = acquireMutation(paths)           // pathMutationLock
   3. releaseBarrier = await saveSelected(paths)         // DocumentMutationBarrier
   4. expected = await getContentHashes(paths)           // sha256 of bytes on disk
   5. result = await createCommit(paths, message, expected)
        │
        ▼  fetch POST /api/history/commits
   server/history/routes.ts :
   6.  ensureRepo(repoRoot())                            // first-touch side effects
   7.  probeGit()                                        // 503 graceful if missing
   8.  validate { paths, message, expected }             // 400 on shape errors
   9.  withRepoMutation(repoRoot, async () => {
   10.   assertRepositoryIdle(repoRoot)                   // MERGE_HEAD / CHERRY_PICK / REVERT / REBASE / rebase-merge / rebase-apply / sequencer
   11.   ensureIndexRepairStorageReady(repoRoot)         // open + writeFile + sync probe
   12.   captureExpectedFiles(repoRoot, paths, expected) // sha256 + buffers; mismatch ⇒ 409
   13.   re-read Status; selected-path-not-dirty ⇒ 409 'selection is stale'
   14.   ensureAuthorIdentity(repoRoot)                  // env-var > fallback > existing
   15.   tempDir = mkdtemp('docus-history-index-…'); indexPath = tempDir/index
   16.   indexEnv = { GIT_INDEX_FILE: indexPath }
   17.   seed:
        - non-empty repo: read-tree <headSha>          // git.ts:1113
        - empty repo:    read-tree --empty              // git.ts:1114
   18.   for each selected path:
        - deleted:   update-index --force-remove       // git.ts:1121
        - present:   hash-object -w + update-index --add --cacheinfo 100644
   19.   verify = ls-files --stage -- <p> in temp index // commit
                                                                  rejected if oid missing
   20.   if new tree === HEAD^{tree} ⇒ 409 'nothing to commit'
   21.   write-tree ⇒ <treeSha>
   22.   commit-tree <treeSha> (-p <parent>) -m <message>
   23.   expectedOld = HEAD.value or '0'×40
   24.   assertRepositoryIdle(repoRoot)                  // second idle check
   25.   update-ref HEAD <newSha> <expectedOld>          // CAS
   26.   syncIndexPaths(repoRoot, <newSha>, paths) :
        - 3 attempts, 25/50/75 ms backoff
        - reset -q <newSha> -- <paths>; verify HEAD + diff-cached --quiet
        - on success ⇒ settleIndexRepairPaths(paths)
        - on failure ⇒ recordIndexRepair(repoRoot, <newSha>, paths, fingerprintedRealIndex)
                       inside withRepoMutation + hand-taken index.lock
   27.   show --name-only --pretty= <newSha>            // filesCommitted
   28.   return { sha, filesCommitted, indexRefreshFailed?, indexRepair?, repairStatePersistenceFailed? }
        })
        │
        ▼  fetch response
   useHistoryCommit.submit():
   29.   refreshStatus(); refreshLog()                   // Promise.all
   30.   refreshComparisons(filesCommitted)              // Promise.allSettled
   31.   busy = false; busyPaths = Set(); releaseMutation()
   32.   refreshIndexRepairStatus()
   33.   toast.success(...) OR toast.info(...) for degraded success
```

Failure-path mapping:

- `captureExpectedFiles` mismatch → 409 `'content changed before commit'`.
- Status re-read shows selected path no longer dirty → 409 `'selection is stale'`.
- Repository operation conflict at any idle check → 409 `'repository operation in progress'`.
- `update-ref` non-zero exit → 409 `'repository changed before commit'`.
- Index Repair persistence failure → 200 with `repairStatePersistenceFailed: true`, toast `commit_repair_state_persistence_failed`, not a failure toast.
- Index Repair captured and persisted → 200 with `indexRepair` payload, surface the Repair banner in `HistoryChangesPanel`.

## 7. Index Synchronization and Repair

**File**: `<absolute-git-dir>/docus/index-repair.json`.

**Schema (version 2)**:

```ts
{
  version: 2,
  transactions: Array<{
    token: string         // /^[0-9a-f]{32}$/
    status: 'pending' | 'superseded'
    head: string | null    // 40–64 hex, or null
    paths: string[]        // non-empty, .md only, no leading slashes
    expectedIndex: Record<string, Array<{
      mode: string         // /^\d{6}$/
      oid: string          // /^[0-9a-f]{40,64}$/
      stage: number        // 0–3 integer
    }>>
  }>
}
```

**Schema migration (v1 → v2)**: drops `expectedIndexHash`,
defaults `status: 'pending'`. The original commit that introduced
the schema (`098d997`) wrote v1; the current source is v2 with v1
migration (`e4db65c`).

**Corrupt / unparseable input**: quarantined to
`<file>.corrupt-<ts>-<uuid>.json`; never deleted.

**Atomic replacement**: writes to a temp file, then
`fs.rename` to the final path. Empty transaction list **removes**
the file.

**Pre-flight (`ensureIndexRepairStorageReady`)**: opens the target
path, writes a probe byte, syncs. Failure ⇒ the commit attempts
HEAD anyway but the route response carries
`repairStatePersistenceFailed: true`.

**Real-Index manipulation (`repairIndexWithLock`)**:

- Takes `.git/index.lock` by hand (`open(lockPath, 'wx')`); EEXIST
  ⇒ throws `'git index is locked'`.
- Works in a temp index via `GIT_INDEX_FILE` and renames on
  success.
- Re-checks fingerprint **before and after** the staged reset.
- On mismatch: throws `'index changed after repair was requested'`
  and marks transaction `superseded`.
- Compatibility gate: `merge-base --is-ancestor txHead currentHead`.

**Discard** (`discardIndexRepair`): removes the metadata entry
**without** touching the Real Index. Surfaced in UI as
"Keep staged changes and dismiss".

## 8. Withdraw Sequence

```text
HistoryPanel right-click on latest revision (or Shift+F10)
        │
        ▼
HistoryPanel.showRevisionMenu → Confirmation dialog (ConfirmHost)
        │
        ▼
useHistoryWithdraw.withdraw(sha):
   1.  pending = true
   2.  confirmed = await options.confirm()
   3.  releaseMutation = acquireMutation()           // pathMutationLock.acquireAll
   4.  result = await dropCommit(sha)                 // POST /api/history/drop
        │
        ▼  server:
   routes.ts:
   5.  validate sha (isValidCommitSha)
   6.  ensureRepo + probeGit
   7.  withRepoMutation(repoRoot, async () => {
   8.    assertRepositoryIdle                         // 409 if mid-merge/cherry-pick/rebase/revert
   9.    HEAD = rev-parse --verify HEAD
   10.   if HEAD !== sha ⇒ 409 'only the latest version can be withdrawn'
   11.   parent = rev-parse <sha>^                    // null for root
   12.   assertRepositoryIdle                         // second check, immediately before ref move
   13.   if parent === null:                          // ROOT
            update-ref -d HEAD <expectedSha>          // CAS delete
         else:
            update-ref HEAD <parent> <expectedSha>    // CAS move
   14.   filesChanged = show --no-renames --name-only <sha>  // filtered to .md in route
   15.   syncDroppedIndexPaths(repoRoot, sha, filesChanged):
         - for each .md path: same lock-and-rename Reset + Verify pattern as Create
         - failure: persist Repair transaction
   16.   return { sha, droppedSha, filesChanged, indexRefreshFailed, ... }
        })
        │
        ▼
   17. options.closeDroppedRevision(droppedSha)        // close snapshot/diff tabs
   18. Promise.allSettled([refreshStatus, refreshLog, refreshComparisons(filesChanged)])
   19. await refreshIndexRepairStatus()
   20. lastDroppedSha, lastChangedPaths, completionId set
   21. toast.success / toast.info (degraded success)
   22. busy = false; releaseMutation()
```

## 9. Restore Sequence

```text
HistorySnapshotPane / HistoryComparisonPane 'Restore this version'
        │
        ▼
useHistoryRestore.restore(source):
   1. pending = true
   2. request = buildRequest({ ...source })            // captures revisionA and dirty-state at gesture time
   3. confirmed = await options.confirm(request)      // Capture every mutable value
   4. releaseMutation = acquireMutation([path])       // pathMutationLock
   5. editorBarrier = await options.prepareEditorRestore(path)
   6. preparedTab = tabs.find(tab => tab.path === path); preparedRevision = tab?.revision
   7. result = await restoreFile(path, revisionId)     // POST /api/history/restore
        │
        ▼  server:
   routes.ts:
   8.  validate { path, ref }
   9.  if ref === WORKTREE ⇒ 400 'cannot restore to the working tree'
   10. ensureRepo + probeGit
   11. exists = rawAt(repoRoot, ref, path)             // [OUTSIDE withRepoMutation — known H-K5]
   12. if exists === null ⇒ 404 'file does not exist at ref <ref>'
   13. withRepoMutation(repoRoot, async () => {
   14.   restoreFile(repoRoot, ref, path)             // git restore --source=<ref> --worktree -- <path>
   15.   stat(repoRoot/<path>) → mtime
   16.   return { path, ref, raw: <pre-restore bytes from step 11>, mtime }
        })
        │
        ▼
   8. tab = tabs.find(tab => tab.path === path)
   9. if preparedRevision != null && tab.revision !== preparedRevision:
        applyRestoreWithoutOverwritingNewerEdit(...)  // preserve newer edit
      else:
        applyRestoredContent(...)                     // overwrite
   10. editorBarrier.commit([path])
   11. fileChanges.publish({ kind: 'write', newRaw, source: 'history-restore', newMtime })
   12. Promise.allSettled([refreshVault, refreshComparison(path)])
   13. onSuccess(request, { refreshFailed })           // partial-failure reports success
```

**Known divergence (H-C5 / H-K5)** — the `rawAt` existence check at
step 8 runs **outside** `withRepoMutation`. The route's returned
`raw` field carries the **pre-restore** bytes read by `rawAt`
(step 8), not a post-restore re-read. See Plan §15 History-C5 for
the required resolution.

## 10. Client State Lifecycles

**Per-vault `HistoryState` (`useHistory.ts`)**:

- One `HistoryInstance` per `VaultContext` (`WeakMap`).
- Legacy fallback keyed by `getFallbackVaultFileChanges()`.
- Lazily hydrates: capability → status → log.
- Subscribes to `VaultFileChanges.events` and refreshes Status on
  every monotonic seq.
- `reset()` clears all refs and cancels in-flight requests via
  request-ID guards.

**Mutation lock (`pathMutationLock.ts`)**:

- Per-vault in-memory exclusion.
- Two modes: per-path (`acquire(paths)`) and vault-wide
  (`acquireAll()`).
- Held through Create + Refresh bundle, Restore + Barrier lifetime,
  Withdraw through the post-withdraw refresh.

**Document Save Barrier (`useDocumentSave` → `prepareEditorRestore`)**:

- Acquired by Restore just before the network call.
- Committed on success (`editorBarrier.commit([path])`).
- Rolled back on failure (`editorBarrier.rollback()`).
- An editor save is blocked while the barrier is open.

**Snapshot / Comparison request IDs** (`useHistorySnapshots.ts`,
`useHistoryComparisons.ts`):

- Per-`(tabId)` counter increments on every `(re)open`.
- A late response that arrives after the counter has advanced is
  dropped.

**Status / Log request IDs** (`useHistory.ts`):

- Per-composable counters that bump on each refresh; stale
  responses are dropped.

**Initial-selection semantics** (`useHistoryCommit.ts`):

- First time `options.history.status` becomes non-empty, the entire
  set is selected (`initializedSelection = true`).
- Subsequent status updates prune the selection to paths that are
  still dirty.

**Repository operation conflicts**:

- `addAndCommit` and `dropHeadCommit` check idle at entry **and**
  immediately before moving HEAD. Either side firing returns
  `409 'repository operation in progress'`; the UI surfaces
  `history.repository_operation_in_progress` or
  `history.withdraw_repository_operation`.

## 11. UI Behavior

**HistoryPanel** (`HistoryPanel.vue`):

- `aria-label="History"` on the root section.
- Capability-driven branches: `git_unavailable` /
  `vault_git_unavailable` (with `initError`) / normal.
- `<HistoryChangesPanel>` always above the timeline.
- `role="listbox"` for the timeline; `role="option"` rows.
- ArrowUp / ArrowDown / Enter / Escape keyboard nav.
- Revision menu (`role="menu"`) on right-click or Shift+F10 /
  ContextMenu key. Closes on outside pointerdown or Escape (focus
  restored to the row).
- After withdraw completion (`watch(withdraw.completionId)`): close
  the menu, refresh the document, fall back to the document list if
  the document has no revisions left, focus the timeline heading.

**HistoryChangesPanel** (`HistoryChangesPanel.vue`):

- Header with the count of dirty files; select-all / clear-selection
  toggle.
- Per-row `<label>` with checkbox, title, status badge (new /
  modified / deleted, from porcelain letters).
- Disabled checkboxes during busy / mutationLocked.
- Version-message textarea (`Ctrl`/`Cmd`+Enter submits).
- Create Version button reflects busy state with an `aria-busy`
  parent and a `role="status"` overlay.
- Index Repair banner appears when
  `commit.indexRepairPaths.length > 0`. Two modes: ordinary Retry,
  or Discard on a conflict.

**HistorySnapshotPane** (`HistorySnapshotPane.vue`):

- Read-only badge in the header.
- Toolbar: Restore, Open Diff, View Current, Close.
- Restore disabled while Create Version owns the document mutation
  lock OR the snapshot is not yet ready OR a restore is already in
  flight.
- `aria-busy` on the section during a Restore.
- `<h2 tabindex="-1">` focus target exposed via `focusViewer`.
- Loading / error inline states with Retry button.

**HistoryComparisonPane** (`HistoryComparisonPane.vue`):

- Toolbar: Restore this version, View historical, View current,
  Close.
- Current-side dirty badge.
- Identical → "identical" empty state.

**Timeline components**:

- `TimelineGroup` is a `<section role="group" aria-label="<label>">`
  with a heading.
- `TimelineDocumentRow` and `TimelineRevisionRow` are
  `role="option"` buttons with `aria-selected`.
- `HistoryComparisonPane` and `HistorySnapshotPane` both expose
  `focusViewer` via `defineExpose`.

**Context menu**:

- Single-item: "Withdraw the latest version".
- Disabled unless the row is the latest commit **and**
  `canWithdraw` is true **and** not currently busy.

## 12. Test Evidence Map

Behavior → test matrix. The tests are real vitest cases; the names
are quoted verbatim.

| Behavior | Test file | Test name |
|---|---|---|
| Repo init idempotent + autocrlf | `server/__tests__/history-git.test.ts` | `'reports true after initRepo and disables autocrlf'` |
| `.gitignore` non-overwrite | `server/__tests__/history-git.test.ts` | `'does not overwrite existing .gitignore on second call'` |
| Nested vault repo | `server/__tests__/history-git.test.ts` | `'initializes a nested vault repo when one is requested inside another'` |
| Status filters to managed paths | `server/__tests__/history-git.test.ts` | `'returns [] when the working tree is clean (ignoring the seeded dotfiles)'`, `'reports modified, new, and untracked files'` |
| Log newest-first | `server/__tests__/history-git.test.ts` | `'returns commits newest-first'` |
| Log path filter | `server/__tests__/history-git.test.ts` | `'with path filter, only returns commits touching that file'` |
| Empty-repo log | `server/__tests__/history-git.test.ts` | `'returns [] for a freshly-initialized repo with no commits'` |
| No `--follow` for rename | `server/__tests__/history-git.test.ts` | `'logs a renamed file under its new path (no follow, so old-path commit is not pulled in)'` |
| Temp-index staged blob verification | `server/__tests__/history-git.test.ts` | `'commits the validated snapshot when the worktree changes before staging'` |
| HEAD CAS conflict on commit | `server/__tests__/history-git.test.ts` | `'rejects with CAS conflict when HEAD changes before update-ref'` |
| External git add does not enter commit | `server/__tests__/history-git.test.ts` | `'commits only selected paths when an unrelated file is already staged'` |
| Index Refresh degradation on commit | `server/__tests__/history-git.test.ts` | `'reports index refresh degradation after a successful CAS commit'` |
| Repair preserves user content | `server/__tests__/history-git.test.ts` | `'repairs A after unrelated B is staged and preserves B in the index'`, `'repairs A after Docus successfully commits unrelated B'` |
| Repair rejects external index change | `server/__tests__/history-git.test.ts` | `'refuses repair after the user changes the real index entry'` |
| Hand-taken `.git/index.lock` | `server/__tests__/history-git.test.ts` | `'holds index.lock across validation and atomic replacement'` |
| Repair persists on HEAD change immediately before replace | `server/__tests__/history-git.test.ts` | `'keeps a repair transaction when HEAD changes immediately before index replacement'` |
| Repair-state persistence failure | `server/__tests__/history-git.test.ts` | `'reports degraded success when repaired Index metadata cannot be cleared'`, `'reports repair-state persistence degradation without failing an existing commit'`, `'does not fail a commit when clearing old repair state cannot be persisted'` |
| Corrupt repair quarantine | `server/__tests__/history-git.test.ts` | `'quarantines corrupt repair state before committing'` |
| v1 → v2 migration | `server/__tests__/history-git.test.ts` | `'migrates a valid version 1 repair file to version 2 without quarantine'` |
| Storage preflight fails before HEAD move | `server/__tests__/history-git.test.ts` | `'fails the repair-storage preflight before moving HEAD'` |
| Repository-operation markers | `server/__tests__/history-git.test.ts` | parametrized loop `'rejects Create Version while ${marker} is present'` (covers `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `rebase-merge`) |
| Repository operation mid-flight | `server/__tests__/history-git.test.ts` | `'rejects when a repository operation starts after snapshot capture'` |
| Author identity fallback | `server/__tests__/history-git.test.ts` | `'writes a default user.name + user.email when none is configured'` |
| Author identity env var | `server/__tests__/history-git.test.ts` | `'uses GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL env vars when set'` |
| Author identity no-overwrite | `server/__tests__/history-git.test.ts` | `'does not overwrite an already-configured identity'` |
| parseLog multi-line body | `server/__tests__/history-git.test.ts` | `'extracts the full multi-line body and only the file paths in files[]'`, `'still parses correctly when the body is a single line'` |
| WORKTREE rawAt | `server/__tests__/history-git.test.ts` | `'returns the on-disk content for the WORKTREE sentinel'`, `'returns null for WORKTREE when the file does not exist on disk'` |
| rawAt ref types | `server/__tests__/history-git.test.ts` | `'returns the file content at HEAD'`, `'returns null when the file did not exist at the ref'`, `'returns null for HEAD~1 on an empty repo (no commits yet)'`, `'returns null for an unknown symbolic ref'` |
| CRLF byte round-trip | `server/__tests__/history-git.test.ts` | `'round-trips CRLF line endings byte-for-byte'` |
| Restore happy path | `server/__tests__/history-git.test.ts` | `'overwrites the working-tree copy with the old ref\\'s content'`, `'is a no-op when the file is already at that ref (idempotent)'`, `'throws when the ref does not exist (bad revision)'`, `'throws when the file does not exist at that ref'` |
| Withdraw preserves Worktree + unrelated staged | `server/__tests__/history-git.test.ts` | `'withdraws only the latest version, preserves Worktree bytes, and keeps unrelated staged entries'` |
| Root-commit withdraw | `server/__tests__/history-git.test.ts` | `'withdraws the first version without deleting files or unrelated staged entries'` |
| Older commit reject (CAS) | `server/__tests__/history-git.test.ts` | `'rejects an older version and uses CAS without overwriting an external version'` |
| Withdraw index degradation | `server/__tests__/history-git.test.ts` | `'returns degraded success and a persistent Repair transaction after Index synchronization fails'`, `'repairs a failed Index synchronization after withdrawing the first version'`, `'repairs a withdrawn-root transaction after an unrelated new version is created'`, `'does not report failure after withdrawal when Repair metadata cannot be persisted'` |
| Capability cached | `server/__tests__/history-routes.test.ts` | `'reports gitAvailable=true and repoInitialized=true after first call'`, `'is idempotent on a second call'` |
| Status routes | `server/__tests__/history-routes.test.ts` | `'returns empty dirty list when the working tree is clean'`, `'reports new and modified files'`, `'hides non-Markdown files that the commit contract cannot accept'` |
| Log routes | `server/__tests__/history-routes.test.ts` | `'returns commits newest-first across multiple /commits calls'`, `'filters by path'`, `'rejects invalid path filters'`, `'returns an empty list (not 500) on a freshly-initialized repo with no commits'`, `'returns an empty diff (not 500) when both refs are HEAD~1/HEAD on an empty repo'` |
| File routes | `server/__tests__/history-routes.test.ts` | `'returns raw content of HEAD'`, `'returns raw content of a specific sha'`, `'returns 404 when the file did not exist at the ref'`, `'returns 400 when path is missing'`, `'rejects path traversal for WORKTREE reads'`, `'rejects invalid refs'` |
| Diff routes | `server/__tests__/history-routes.test.ts` | `'returns line-level ops between two refs'`, `'handles a file that did not exist on the old side'`, `'handles a root commit diff via sha~1 without rejecting the ref'`, `'returns 400 when refs are missing'`, `'returns the worktree-vs-HEAD diff via the WORKTREE sentinel'`, `'represents a deleted working-tree file as removals from HEAD'`, `'rejects invalid diff paths and refs'` |
| Commits validation ladder | `server/__tests__/history-routes.test.ts` | `'creates a commit and returns its sha + filesCommitted'`, `'returns 400 on empty paths'`, `'returns 400 on empty message'`, `'returns 400 on non-string path entry'`, `'returns 400 on unsafe or non-note paths'`, `'returns a clear 409 when the selected path is no longer dirty'`, `'requires expected content hashes for every commit request'`, `'returns 409 without committing when content changes after hash capture'`, `'rejects the whole batch when one selected path became clean'`, `'commits an externally deleted selected file'`, `'commits both sides of an externally moved file'`, `'commits a multi-file batch in one commit'` |
| Repair routes | `server/__tests__/history-routes.test.ts` | `'restores persisted repair status and repairs by opaque transaction token'`, `'returns degraded success when the Index was repaired but its record was not cleared'`, `'returns 409 instead of clearing index content staged after the failure'` |
| Drop routes | `server/__tests__/history-routes.test.ts` | `'removes the latest commit while keeping its changes in the working tree'`, `'rejects dropping an older commit'`, `'can drop the root commit and leave its files untracked'`, `'keeps unrelated staged files staged when dropping the root commit'`, `'rejects unsupported sha syntax'`, `'maps a CAS conflict and repository operation state to 409'`, `'returns Index degradation as a successful withdrawal response'` |
| Git unavailable (graceful) | `server/__tests__/history-routes.test.ts` | `'returns 503 on /status when git cannot be spawned'` |
| Restore routes | `server/__tests__/history-routes.test.ts` | `'overwrites the working-tree file with the content at ref'`, `'returns 400 when path is missing'`, `'returns 400 when ref is missing'`, `'returns 400 on unsafe path or unsupported ref syntax'`, `'returns 400 when ref is the WORKTREE sentinel'`, `'returns 404 when the file does not exist at the requested ref'`, `'returns 404 for a bad revision'`, `'returns 503 when git is unavailable'` |
| Client `getStatus` graceful-unavailable | `src/lib/__tests__/history-api.test.ts` | `'resolves with { available: false } on a 503 (graceful unavailable, not an error)'` |
| Client error pass-through | `src/lib/__tests__/history-api.test.ts` | `'throws the server error message on a 4xx'`, `'falls back to "<endpoint> failed: <status>" when the body has no error field'` |
| Create body shape | `src/lib/__tests__/history-api.test.ts` | `'captures and sends expected working-tree content hashes'` |
| Repair token opaque | `src/lib/__tests__/history-api.test.ts` | `'loads persisted repair transactions and posts the opaque token'` |
| 409 preserved | `src/lib/__tests__/history-api.test.ts` | `'preserves the HTTP status for stale-selection handling'` |
| Drop body shape | `src/lib/__tests__/history-api.test.ts` | `'withdraws the requested latest version and parses the complete result'` |
| Restore body shape | `src/lib/__tests__/history-api.test.ts` | `'posts one document path and revision and returns restored bytes'` |
| Locale formatting | `src/lib/__tests__/history-date.test.ts` | `'uses the application locale instead of the browser default'` |
| Per-vault instance + stale-response | `src/__tests__/useHistory.test.ts` | `'ignores stale Status and Timeline responses after a newer refresh completes'`, `'shares state within the same vault owner'`, `'rebinds when the provider-less vault owner changes'` |
| Single hydration | `src/__tests__/useHistory.test.ts` | `'hydrates capability, status, and log only once'` |
| File-change subscription | `src/__tests__/useHistory.test.ts` | `'refreshes Git status after a vault file-change event'`, `'exposes Git dirty independently from editor save state'` |
| Retry-with-error retention | `src/__tests__/useHistory.test.ts` | `'retains the existing Timeline and exposes an error when refresh fails'` |
| Path lock semantics | `src/composables/vault/__tests__/pathMutationLock.test.ts` | `'atomically excludes overlapping Vault mutations and releases exact paths'`, `'uses a Vault-wide lock to exclude Create Version and Restore mutations'` |
| Commit state – sibling workflows | `src/composables/vault/__tests__/useHistoryCommit.test.ts` | `'registers and settles Repair transactions synchronously for sibling workflows'`, `'clears a replaced superseded token when the status refresh fails'`, `'clears the conflict token when settling its superseded transaction'` |
| Commit state – selection | `src/composables/vault/__tests__/useHistoryCommit.test.ts` | `'selects the initial changed set, supports partial selection, and preserves exact .md paths'`, `'supports select all and clear selection without auto-selecting later status additions'` |
| Commit – repair UX | `src/composables/vault/__tests__/useHistoryCommit.test.ts` | `'repairs a degraded real index and refreshes Changes'`, `'warns without reporting failure when repaired Index metadata cannot be cleared'`, `'removes a repaired transaction locally when the status refresh fails'`, `'keeps a repaired transaction locally when its metadata cannot be cleared'`, `'restores persisted repair transactions when the Vault is recreated'`, `'restores a superseded transaction directly as a dismissible conflict'`, `'keeps the repair transaction and explains a newer staged-index conflict'`, `'removes a discarded transaction locally when the status refresh fails'`, `'keeps older pending repair paths after a later successful commit'` |
| Commit – conflict | `src/composables/vault/__tests__/useHistoryCommit.test.ts` | `'reports a repository operation conflict without attempting a commit retry'`, `'reports an external HEAD CAS conflict and refreshes status and Timeline'` |
| Commit – input guards | `src/composables/vault/__tests__/useHistoryCommit.test.ts` | `'rejects empty and whitespace-only messages and prevents duplicate requests'`, `'does not commit when save fails and preserves selection and message'`, `'preserves input on commit failure and refreshes stale selections without retrying'`, `'keeps the message, selection, and workspace content after a normal commit failure'` |
| Commit – refresh and dirty | `src/composables/vault/__tests__/useHistoryCommit.test.ts` | `'updates the shared dirty count while leaving uncommitted files dirty'`, `'refreshes existing comparisons after a successful commit'` |
| Commit – mutation lock + barrier | `src/composables/vault/__tests__/useHistoryCommit.test.ts` | `'keeps the barrier through commit and releases it before post-commit refreshes'`, `'disables submission and reports a mutation-lock conflict'` |
| Commit – degraded success | `src/composables/vault/__tests__/useHistoryCommit.test.ts` | `'treats index refresh degradation as a successful version with a warning'`, `'reports repair-state persistence failure as a degraded successful version'` |
| Withdraw single-flight + refresh | `src/composables/vault/__tests__/useHistoryWithdraw.test.ts` | `'is single-flight and refreshes Status, Timeline, revisions, comparisons, and repair state'`, `'does not clear or refresh the current UI when withdrawal fails'`, `'does not open confirmation while another Vault mutation owns the lock'`, `'refreshes repository state after a latest-version conflict'`, `'reports Index and repair-record degradation as successful withdrawals'`, `'registers a returned Repair transaction before a failed server-status refresh'` |
| Restore confirmation + captured revision | `src/composables/vault/__tests__/useHistoryRestore.test.ts` | `'requires confirmation and performs no work when cancelled'`, `'captures revision A even if the mutable viewer source changes before confirmation resolves'` |
| Restore + tab interaction | `src/composables/vault/__tests__/useHistoryRestore.test.ts` | `'restores exactly one file and updates the existing editor tab without duplicating it'`, `'restores a closed document and refreshes vault state without opening a tab'`, `'leaves editor and history navigation state untouched when the API fails'`, `'prevents duplicate requests while a restore is in flight'`, `'preserves edits made while restore is pending and resumes saving after commit'`, `'rolls back the editor save barrier when restore fails'`, `'holds the real save barrier for the entire restore and saves a newer edit afterward'`, `'allows manual save after restore when editing returned to the old baseline'`, `'does not restore a document locked by Create Version'`, `'does not treat loading or failed editor tabs as valid dirty current state'`, `'reports partial refresh failure without treating a completed restore as failed'` |
| Snapshot / Comparison tabs | `src/composables/vault/__tests__/useHistorySnapshots.test.ts`, `useHistoryComparisons.test.ts` | `'loads exact Git content lazily and caches the active revision'`, `'reuses one history tab per document when another revision is selected'`, `'keeps the history tab open with an inline error when loading fails'`, `'retries in the same tab without changing the selected revision'`, `'reopens cached historical content without another Git request'`, `'compares the Git snapshot against unsaved in-memory editor content'`, `'falls back to the saved document API when the document is not open'`, `'replaces discarded editor content with saved content after the Current tab closes'`, `'falls back to the saved document API while the editor tab is still loading'`, `'does not trust an editor tab whose initial load failed'`, `'reuses one comparison tab and ignores a slower obsolete request'`, `'invalidates an in-flight request when its tab closes'`, `'refreshes the current side when a comparison tab is selected again'`, `'keeps comparison tabs isolated by document path'`, `'keeps errors inline and supports retrying the current side'` |
| Timeline grouping | `src/composables/vault/__tests__/useHistoryTimeline.test.ts` | `'groups Today, Yesterday, weekdays, and Last Week in display order'` |
| HistoryPanel – withdrawal | `src/components/vault/__tests__/HistoryPanel.test.ts` | `'offers withdrawal only for the latest version and confirms, single-flights, and restores focus'`, `'closes the revision menu outside and on Escape, restoring row focus for Escape'` |
| HistoryPanel – state across remount | `src/components/vault/__tests__/HistoryPanel.test.ts` | `'preserves message, selection, and single-flight state across sidebar remounts'` |
| HistoryPanel – selection | `src/components/vault/__tests__/HistoryPanel.test.ts` | `'creates a version from only selected exact status paths after save coordination'`, `'shows a newly created version in Timeline and refreshes an open document revision list'`, `'groups recent documents and opens one document revision list'`, `'refreshes the selected document revisions after an external HEAD conflict'` |
| HistoryPanel – single-revision / Created | `src/components/vault/__tests__/HistoryPanel.test.ts` | `'shows Created for a document with one revision'` |
| HistoryPanel – stale-response guard | `src/components/vault/__tests__/HistoryPanel.test.ts` | `'ignores a stale revision response after navigating from document A to B'` |
| HistoryPanel – empty / error / loading | `src/components/vault/__tests__/HistoryPanel.test.ts` | `'renders an empty state when a document history request has no revisions'`, `'uses an i18n fallback when revision loading throws a non-Error value'`, `'distinguishes an initial Timeline failure from an empty repository and retries'`, `'renders translated empty and loading states'` |
| HistoryPanel – keyboard nav | `src/components/vault/__tests__/HistoryPanel.test.ts` | `'supports arrow navigation, Enter selection, and Escape back navigation'` |
| HistoryChangesPanel | `src/components/vault/__tests__/HistoryChangesPanel.test.ts` | `'renders understandable statuses and accessible selection controls'`, `'shows document titles and falls back to file names'`, `'toggles the single selection action and emits message and keyboard submission intents'`, `'exposes localized busy and error states and disables mutation controls'`, `'exposes an explicit retry when real-index repair is pending'`, `'offers a metadata-only dismissal after a staged-index conflict'` |
| HistorySnapshotPane | `src/components/vault/__tests__/HistorySnapshotPane.test.ts` | `'disables Restore while Create Version owns the document mutation lock'`, `'renders the banner, read-only toolbar, and exact Markdown through ReadingPane'`, `'disables restore and announces the busy state while restoring'`, `'keeps loading and error states inside the history viewer'`, `'exposes a focus target for the read-only viewer'` |
| HistoryComparisonPane | `src/components/vault/__tests__/HistoryComparisonPane.test.ts` | `'disables Restore while Create Version owns the document mutation lock'`, `'renders a directional read-only comparison and exposes navigation actions'`, `'disables restore and announces the busy state while restoring'`, `'renders loading, error, retry, and identical states inline'`, `'formats the revision date with the application locale'`, `'exposes a focus target for the comparison viewer'` |
| End-to-end Long Flow A | `e2e/edit-program-long-flows.spec.ts` | `'Long Flow A — Recovery → History/Diff → Rename across one document life'` (exercises History in the browser stack without Anthropic round-trip) |

Coverage gaps the matrix above does **not** cover (recorded for
Plan §15 History-C9 to remediate):

- The `GIT_INDEX_FILE`/temp-index contract itself is asserted by
  outcomes only (via `git show --name-only --pretty=`).
- Repository-operation markers: parametrized loop covers
  `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `rebase-merge`. Direct tests
  for `REVERT_HEAD`, `REBASE_HEAD`, `rebase-apply`, `sequencer`
  are not present.
- Path validation: `..` is exercised; backslash, absolute path,
  hidden-dir are not.
- Short SHA at `/drop` boundary: tests use 40-char hex exclusively.
- Multi-vault `withRepoMutation` keying has no dedicated test
  (single global `setRepoRootForTesting` per test file).
- Restore TOCTOU is not raced.
- Timeout / capture-limit behavior is not asserted.

## 13. Implementation Commits

The History feature was implemented across the following commits,
each verified by `git log -- server/history/`
`src/lib/history-api.ts` and the related directories. SHAs are
quoted in full from the local git history.

**Foundation (2026-06-24)**:

- `5e735d1048b9fbb54e6ae7709d2ac36a246d5b1b` — `feat(history): L0
  git wrapper + L1 line/word diff`.
- `6ba0b119b944b5e6e442945b8a389fbfef9af860` — `feat(history): L2
  API routes (status/log/commits/diff/file/capability)`.
- `a735fb89c89f2f56e58fb611604f1c9e227e5897` — `feat(history): L3
  UI — HistoryPanel, DiffView, ActivityBar badge`.

**Restore + WORKTREE (2026-06-24 → 2026-06-25)**:

- `c6d7e37b85dc503a091084a2087cea2e217f3c63` — restore primitive.
- `74245e6799f74071a045c332bd2aba2388460042` — WORKTREE sentinel
  for uncommitted-edit diffing.
- `22eaeab6bd2ebe85ffab1cddedbae9e26a1a5fc0` — VAULT_DIR +
  vault-owned git repo.

**Hardening (2026-06-30 → 2026-07-07)**:

- `2ef94d7f6203cbe6f07f6f665dd6f914e12bdf94` — empty-repo log.
- `41580795ed3241a8282ddbb003487032f0b4d8c5` — author identity.
- `a889712b2e50fdcbe740aa9e7dd7561e3786b7e7` — empty-repo rawAt.
- `8db1901070a7ab380b9d51b0de554e5278fb9ac6` — untracked dirs in
  status (`-uall`).
- `af5b62208f223d5e0a323eb5c251bb9a19b55c2f` — Input validation
  (validation.ts).

**Withdraw + AI hint (2026-07-08)**:

- `925829f0ae0ffdd9583ac7102d98e9b4f616091a` — AI commit-message
  helper + `sha~N` ref validation.
- `85206d0eda2f5151d99a19a4bbeee0bac3830106` — Drop commit + POST
  /drop.

**Polish / i18n (2026-07-10)**:

- `8aabc35528512b736e7686e53be586218444faa7` — History polish + AI
  tool-card extraction.
- `6fd5bbe38dc846a39a992f1d834bda4b4fe1ecb8` — split error into
  diff / action channels.
- `ff19820cbb61d433c04a2f3a756cc15780c9e988` — reject stale
  selections + reconcile after 409.
- `2ecca79a628a3468bc0bdca4e124d5e7f415e457` — i18n for History +
  Diff workspace (zh/en).

**Vault context (2026-07-14)**:

- `1d730aa241bb06cdf3f1968d3605003d4a0135c7` — move module
  singletons into VaultContext.
- `72834ab34b14d1cb84a8b32ee6929e101b04c0fe` — context-leak fixes.

**Timeline / Snapshot / Comparison / Restore (2026-07-15)**:

- `3882be58e13d8d978707151b48ab379ddd390dad` — document timeline +
  HistoryPanel rewrite.
- `55908c95b791db4df17ae059136d24e9e95c3413` — HistoryPanel error
  handling + i18n.
- `32eabb1f04fa55986b44cd948bd1321dc0e3a9b0` — Snapshot pane.
- `add3b9b1d8d70eac439d16e2a45ffbd078c91cf7` — Comparison pane.
- `416f73a35ff997bcec872adf5de7e64632fd846e` — full Restore flow.
- `662b6b50ddab771593a9dc08f74db2516a1342d3` — Restore state
  management refinements.
- `69edcd2fa7b35ad916fda3fcff2a920631291082` — history-comparison
  UX improvements; `src/lib/history-date.ts` added.
- `f29386cabc63de4636619bf9e33aa15b843d9576` — HistoryChangesPanel
  + useHistoryCommit.
- `f4ceea74f16c11b025d3cf183649b3384777bed4` — non-Markdown filter.

**Path-lock / Conflict / Repair chain (2026-07-16)**:

- `16db6bd86395aeb792fc701625c24f099c19b509` — first path-mutation
  lock layer.
- `f9c57380465deaee0b70e1c0f996c0487ce4fd00` — strengthen
  path-mutation lock.
- `014231bd2423b3385b4bb8a1f82fc8a5f9b9e973` — conflict detection
  + index refresh failure reporting.
- `9ea5dc0c2b3ba94c22fc1a0e42a918fd143951ee` — initial Index Repair
  (post-commit repair of stale index entries).
- `098d9979369b89fbe3d65bac74afac906163713b` — durable repair
  transactions (token + JSON).
- `a96888d6ee456a5ad3659617eab00154e1dc4100` — discard conflicted
  transactions.
- `e4db65c7b757324c0e23c1a6febf896972c8b38c` — repair schema v2.
- `fc90ed6f8e535409afabd551481866779adec2eb` — repair persistence-
  failure path.
- `61ba2da9ab2592fc0e2c8395aa81893f12b085fb` — Withdraw feature.
- `c56f92dd84c4c26490eb12bbc89565fdca520da3` — repair register +
  settle on Withdraw.
- `b8ce45df244fe0c729cdb0272fd5aaf2864e5f69` — repair transaction
  management UI.
- `f2614ef28e2c6621f3a1a09e50a3ec9892146d88` — local-remove of
  repair transactions.

**Withdrawal context menu (2026-07-16 evening)**:

- `5aba80aaa900fbe8c64e0637436d222fc2cfa6c6` — version-operations
  context menu.

**Test infra**:

- `bf280782566a7f3825484550797bd1660c3b17ea` (2026-07-23) —
  explicit timeouts for slow real-git history tests (no production
  behavior change).

## 14. Deviations From Intended Contract

The following are **observed** behaviors in the current code that
either:

(a) **intentionally** trade off something the user might naively
expect in exchange for a stronger invariant, **or**
(b) are **known divergences** that future closure work should
address.

### 14.1 Intended design choices

| Behavior | Why |
|---|---|
| `git log --follow` is **not** used | Comment in `git.ts:273-279`: a vanilla "create new file" commit makes `--follow` falsely attribute earlier unrelated commits. |
| Commit is a plumbing commit (no hooks, no signing) | Source comment in `git.ts:1162-1164`: explicitly a plumbing commit for deterministic snapshot/CAS; honors no `commit-msg` / `pre-commit` hooks. |
| Repair-handling uses a hand-taken `.git/index.lock` | Comment in `git.ts:844-845`: external `git add` cannot enter between validation and atomic replacement. |
| Restore uses `--worktree` only (no `--staged`) | Comment in `git.ts`: checkout-style restore would silently stage a destructive restore. |
| Tab id `history:<path>` (Snapshot) and `diff:<path>` (Comparison) are namespaced | History tabs are not Editor tabs; AI / Document mutation tools that target the editor surface cannot reach them. |
| Status returns 503 `{ available: false }` instead of 4xx/5xx | One graceful signal surface for "git not installed"; consumed by `getStatus` to flip `available`. |
| Repository-operation markers are checked twice (entry + pre-HEAD-move) | Defends against a merge/rebase/cherry-pick/revert starting between the entry check and the ref update. |
| `'-0'×40` is the empty-repo CAS sentinel | 40-zero SHA-1 form; the validators accept 40–64 hex to leave room for SHA-256 vaults. |
| `WORKTREE` allowed only on `/file` and `/diff`; explicitly rejected on `/restore` | Comment: `WORKTREE` is "NOT a valid ref for `git checkout`" — it bypasses git and reads disk directly. |
| Multi-vault isolation is a `WeakMap` of `VaultContext` | Module singletons were migrated from a singleton `useHistory` (a735fb8) into `VaultContext` WeakMap on 2026-07-14. Legacy fallback kept for tests. |

### 14.2 Known divergences from intended contract

These are open / not fixed at the time of this record. Plan §15
records the remediation tasks.

| ID | Description | Plan reference |
|----|-------------|----------------|
| H-C1 | `getStatus` swallows genuine 5xx because `allowNonOkJson: true` is unconditional. | Plan History-C1 |
| H-C2 | Commit / Withdraw success state vs post-success refresh error split is per-test verified but not formally written as a contract. | Plan History-C2 |
| H-C3 | Real-Index sync resets + verifies, with fingerprint capture after the failure — race with external `git add` possible. | Plan History-C3 |
| H-C4 | Withdraw has no Docus commit ownership check; any commit at HEAD (including external) is withdrawable. | Plan History-C4 |
| H-C5 | Restore: `rawAt` existence check outside `withRepoMutation`; returned `raw` is pre-restore bytes. | Plan History-C5 |
| H-K6 | `isValidCommitSha` accepts 7–40 hex; `HEAD === sha` compares two 40-char SHAs; short SHAs can never match. | Plan History-C6 |
| H-K7 | Local-calendar bucket for `groupTimelineItems` uses `Date` arithmetic; DST forward-day may bucket to "Yesterday". | Plan History-C7 (documentation-only) |
| H-K9 | Rename lines filtered out of `/status` because path shape fails; rename history not `--follow`-merged. | Spec H-K9 |
| H-K10 | No pagination on Timeline or Log. | Spec H-K10 |
| H-K11 | Docus commit-trailer scheme proposed (Plan History-C4) but not implemented; owner sign-off required. | Plan History-C4 |
| H-K13 | SHA-256 vault repositories are not supported; `'0'×40` is hardcoded. Repair validator already accepts 40–64 hex. | Spec H-K13 |

## 15. Current Open Findings

### 15.1 P1 (Closure Blockers)

| ID | Finding | Closure task |
|----|---------|--------------|
| H-C1 | `/status` response contract treats genuine 5xx as graceful unavailable | Plan History-C1 |
| H-C2 | Commit success vs post-success refresh failure classification | Plan History-C2 |
| H-C3 | Real-Index synchronization race with external `git add` | Plan History-C3 |
| H-C4 | Withdraw lacks Docus commit ownership verification | Plan History-C4 |
| H-C5 | Restore uses a mutable ref + pre-restore `raw` outside the mutex | Plan History-C5 |
| H-C8 | Three-platform CI verification has not been re-run for this reconstruction | Plan History-C8 |

### 15.2 P2 (Severe UX warts / non-trivial but not blockers)

| ID | Finding | Closure task |
|----|---------|--------------|
| H-K6 | Short SHA at `/drop` never matches full HEAD | Plan History-C6 |
| H-K7 | DST bucket edge in `groupTimelineItems` | Plan History-C7 (doc-only) |
| H-K8 | Rename history not `--follow`-merged | None planned |
| H-K9 | Symlink containment not applied to History paths | None planned |
| H-K10 | No Timeline / Log pagination | None planned |

### 15.3 Accepted / non-blocking

| ID | Finding | Note |
|----|---------|------|
| — | Status uses `git status --porcelain --untracked-files=all` (slower than default) | Trade-off for untracked-dir visibility. Recorded as designed. |
| — | `MAX_CAPTURE_BYTES = 10 * 1024 * 1024` is compared against JS string UTF-16 units | Means non-ASCII output caps sooner. Recorded; not on closure path. |
| — | Side-effect every route: `ensureRepo` may write `.gitignore` and `.gitattributes` on first touch | First-touch only; non-overwriting. |
| — | Status returns non-`error` body shape (`{dirty:[],available:false}`) for 503 | Required for graceful "git missing" rendering. |
| — | `useHistory` keeps a legacy fallback for provider-less Vault | Test-only legacy. |
| — | `useHistoryTimeline` splits the global log per-document by `commit.files` membership | Files outside the path are silently ignored per-document; global log still includes them. |
| — | `aiHistoryComposer` AI commit-message helper makes one Anthropic call; not auto-applied | User button only. |
| — | `HistoryApiError` constructor leaks `r.status` only on non-2xx | Standard fetch error handling. |

### 15.4 Needs verification

| ID | Finding | Verification |
|----|---------|--------------|
| H-C8 | Three-platform CI (Windows / macOS / Linux) passing for the current `main` tip | Plan History-C8 |
| H-K1 | The repository-operation marker list is implemented in `git.ts` but only three of seven markers are exercised by the parametrized test | Plan History-C9 |
| H-K11 | Whether forward-migration (existing Docus versions without `Docus-Version` trailer) should refuse to withdraw | Owner decision during Plan History-C4 |
| H-K12 | Whether `MAX_CAPTURE_BYTES` should be measured in bytes not UTF-16 units | Out of scope (Spec §21) |
| H-K14 | Whether the AI tool-card contract explicitly excludes `history:` / `diff:` tab IDs | Out of scope for this closure |
