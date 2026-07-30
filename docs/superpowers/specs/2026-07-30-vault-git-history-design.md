# Vault Git History — Design

**Date:** 2026-07-30
**Status:** Retrospective Reconstruction — Pending Owner Approval
**Scope:** Docus Vault Git History
**Repository:** tangxiangxiang/docus

> ⚠️ This specification was reconstructed after implementation to restore
> the repository's required spec → plan → implementation → closure chain.
> It does **not** claim that this exact document existed before
> implementation. Sections marked "**observed**" describe what the
> currently-checked-in code in `main` actually does; sections marked
> "**intended**" describe design rules the implementation honors and
> that later closures are expected to verify; deviations between the two
> are listed in §25 (Known Risks and Open Questions) and §15 (Restore).

The Production Code Review Baseline for this retrospective document is
the commit on `main` at the time the documentation was assembled
(`00b17359d151bbdbe56115ed992700ecbb5e1ca1`). Production-code SHAs
referenced in this Spec are the SHAs documented in the
Implementation Record.

This document is the design authority for the Vault Git History feature.
It is read together with the Implementation Plan, the Implementation
Record, and the (Draft) Final Closure for the feature.

---

## 1. Problem

A Docus vault is a directory of plain Markdown files plus a SQLite
metadata database. The user owns both: there is no remote sync, no
background service, and the editor writes to disk directly. The
History feature exists to answer one product question:

> "Show me what changed, let me step through older versions, and let me
> safely put good content back."

That question has to be answered **without** the History feature
becoming either (a) a generic Git client, or (b) a place where Docus
silently overwrites what the user did outside Docus. Concretely:

1. A Markdown file lives on disk. Auto-save is the editor's job, not the
   History feature's. A version is something the user **creates
   intentionally** — entering a version message and pressing a button.
2. The editor buffer is not the only authoritative copy of bytes.
   The Editor Buffer may be ahead of the Working Tree (unsaved typing),
   the Working Tree may be ahead of HEAD, and the Real Git Index may
   carry staged entries created by an external Git process outside of
   Docus. History reads and writes must respect this layered model.
3. Docus must coexist with the user's other Git tooling. Running
   `git add` in a terminal while Docus is committing must not corrupt
   either side, and Docus must not erase staged intent the user
   created outside of Docus.
4. History is **not** a UI for branch management, conflict resolution,
   or remote sync. Those are out of scope (§4).

The problem these sections solve: define what History does, what it
explicitly refuses to do, and what guarantees it makes about the
interaction between Editor / Working Tree / Real Index / HEAD.

## 2. Product Goal

The user-facing goals of Vault Git History are:

1. **See** what files in the current vault have uncommitted changes
   (Changes panel).
2. **Compose** a multi-file version by selecting documents, entering a
   human-readable version message, and confirming a single Create
   Version action.
3. **Browse** every version of the vault in a timeline grouped first by
   document and then by date — recent versions surface first; older
   versions remain reachable.
4. **Read** any historical version of a document in a dedicated, read-
   only pane that cannot be edited by accident or by an AI tool that
   uses the Document mutation surface.
5. **Compare** the historical version of a document against either the
   currently-open editor buffer (preferred) or the on-disk Working Tree
   (fallback), as a side-by-side line + word diff.
6. **Restore** an older version of a single document into the Working
   Tree without creating a commit (the user can then keep or amend).
7. **Withdraw** the most recent version created by Docus, leaving
   Working Tree bytes intact and unrelated Real-Index entries staged.
8. **Survive** an Index Repair: when Docus has committed successfully
   but cannot synchronize the Real Index, the change has happened and
   the visible UI reconciles via a persistent repair transaction the
   user can retry or dismiss.

These goals are the functional surface. The next sections are the
contracts that make them safe.

## 3. Scope

The History feature, **as currently implemented on `main`**, exposes:

| Surface | Behavior |
|---------|----------|
| Git capability detection | `GET /api/history/capability` — tells the client whether `git` is on PATH and whether the vault has been initialized. Cached for process lifetime. |
| Per-vault repo initialization | `ensureRepo` — creates the vault's own `.git/`, writes `.gitignore` and `.gitattributes` once, does not overwrite user customization, surfaces `core.autocrlf=false`. |
| Status (read-only) | `git status --porcelain --untracked-files=all` filtered to managed Markdown paths. Surfaces new (`??`/`A`), modified (`M`), and deleted (`D`). Read-only — never modifies the index, never touches HEAD. |
| Log (read-only) | `git log` for the whole vault (newest first, limit 200) or one document via `-- <path>`. Returns SHA, author, ISO date, subject, body, files-touched. |
| Single-document log | Same as `Log`, scoped to a path — the source for the per-document revision list. |
| Read-only Snapshot | `GET /api/history/file?path=&ref=` (default `HEAD`); `ref=WORKTREE` resolves to the on-disk file. |
| Diff / Comparison | `GET /api/history/diff?path=&old=&new=` — line-level (with optional word-level breakdown on edit-shaped remove+add pairs). Client-side `computeFileDiff` powers the Comparison pane's "current side". |
| Create Version | `POST /api/history/commits` — manages a `Mutation Barrier` (`pathMutationLock`), captures exact Working Tree bytes, runs a temporary Git Index in `GIT_INDEX_FILE`, runs `read-tree` / `hash-object` / `update-index --cacheinfo 100644` / `write-tree` / `commit-tree` (plumbing — no hooks, no signing), CAS-updates `HEAD`, then attempts Real-Index sync. |
| Index Repair (transactional) | `GET /api/history/repair-status`, `POST /api/history/repair-index`, `POST /api/history/repair-index/discard` — opaque token (`/^[0-9a-f]{32}$/`), JSON file at `<git-dir>/docus/index-repair.json` with schema version 2, atomic temp-file + `rename`. |
| Restore | `POST /api/history/restore` — reads the source bytes via `rawAt(requestedRef)` **outside** the repository mutation section, then enters `withRepoMutation` to run `git restore --source=<requestedRef> --worktree -- <path>`. Returns `{ path, ref, raw, mtime }` where `raw` is the source bytes obtained by the off-mutex `rawAt` pre-check (not a post-restore re-read). **No** `--staged`, no `update-ref`, no Real-Index mutation, no automatic commit. The intended contract (Spec §15 / Plan History-C5) requires resolving the ref to one immutable SHA inside the mutation transaction and returning post-restore Working Tree bytes. |
| Withdraw Latest Version | `POST /api/history/drop` — discovers `filesChanged` **before** moving HEAD, filters by `.endsWith('.md')` only (does **not** enforce the full Managed History Path contract; see H-C4), two-phase CAS (non-root: `git update-ref HEAD <parent> <expectedOld>`; root: `git update-ref -d HEAD <expectedOld>`). After HEAD moves, attempts a scoped Real-Index synchronization on the affected paths; failure becomes an Index Repair Transaction, not a withdrawal failure. Working Tree bytes preserved in both branches. |
| File-change Watch | `useHistory` subscribes to `VaultFileChanges.events` and refreshes Status on every `seq` increment. |
| Status refresh after mutation | `useHistoryCommit.submit()` and `useHistoryWithdraw.withdraw()` call `refreshStatus()`, `refreshLog()`, and `refreshComparison` on the changed paths. |
| Multi-vault isolation | Per-VaultContext `WeakMap` of `useHistory` instances; legacy `getFallbackVaultFileChanges` kept for tests. Per-repo `Promise`-chain mutex keyed by `path.resolve(repoRoot)` serializes Create / Withdraw / Restore / Repair. |
| Git-Unavailable state | `GET /api/history/status` returns `503 { dirty: [], available: false }` for graceful "git is not installed" surfaces; the panel renders an EmptyState instead of an error. |
| Empty-repo state | `GET /api/history/log` returns `{ commits: [] }` (not 500) for a vault with no commits yet; `parseLog` matches `/does not have any commits yet/i`. |

## 4. Non-Goals

These are explicitly **not** part of Vault Git History. They are
recorded here so future readers do not assume otherwise.

1. A general-purpose Git UI (no status tab, no branch switcher, no
   graph view, no reflog inspection).
2. Branch creation, deletion, rename, switch, or merge.
3. Push / pull to any remote.
4. Merge, rebase, cherry-pick, revert, interactive rebase.
5. History rewriting (no `git rebase -i`, no `git filter-branch`, no
   BFG, no `git replace`).
6. Withdrawing an arbitrary historic commit. **Only the latest commit
   is withdrawable**, and only if Docus is prepared to recognize it as
   its own (see §16 and Known Risks H-K4).
7. Auto / scheduled / hook-triggered versions. Versions are created
   only by explicit user action.
8. Binary attachment versioning. Only files matched by the History
   path contract (`*.md`, lowercase kebab segments, no hidden dirs) are
   managed.
9. Non-Markdown file management in History. Status filters out anything
   that won't be accepted by the commit contract (§7).
10. GitHub / GitLab / remote sync.
11. Multi-device sync.
12. GPG / SSH commit signing.
13. Execution of Git hooks on Docus commits. Hooks do not run because
    the commit is a plumbing commit (§10). Side effect: user-installed
    `commit-msg` / `pre-commit` hooks are **not** honored by History.
14. A conflict-merge editor.
15. Tag, branch, release management.
16. Server-side tag normalization. (Out of scope here; adjacent to,
    but separate from, the Tags feature.)

## 5. Terminology

The following terms have specific meanings throughout the spec, plan,
implementation record, and closure.

| Term | Definition |
|------|-----------|
| **Editor Buffer** | The mutable text in the current Monaco editor tab for a document. May be ahead of the Working Tree (unsaved typing). |
| **Saved Editor Revision** | The Editor Buffer at the moment the editor flushed to disk via its save flow (`tab.savedRevision`). |
| **Working Tree** | The bytes of a file as they exist on disk under the vault root. The source of truth for uncommitted changes. |
| **Real Git Index** | The `.git/index` file. Reflects staged content. May carry entries the user added outside Docus. |
| **Temporary Git Index** | A `mkdtemp`-created file pointed to by `GIT_INDEX_FILE` while Docus builds a commit. Never co-located with `.git/index`. |
| **HEAD** | The latest commit SHA the vault's `HEAD` ref currently names. Updated only via `git update-ref HEAD <new> <expected>` (CAS). |
| **Commit** | A Git commit object created via `git commit-tree`. For Docus versions only. |
| **History Revision** | A single `CommitRecord` for a single document, surfaced in the Timeline. |
| **Docus Version** | A Commit created by Docus's Create Version flow with the user-provided message. |
| **Mutation Barrier** | Per-vault in-memory exclusion that prevents two workflows (Create Version ↔ Restore ↔ Withdraw ↔ AI edits ↔ editor save) from mutating the same path simultaneously. Implemented by `pathMutationLock.createPathMutationLock`. |
| **CAS** | Compare-And-Swap. `git update-ref` with an explicit expected old value; `git merge-base --is-ancestor` for repair compatibility. |
| **Index Repair Transaction** | A persistent record of a Real-Index-sync failure, identified by a 32-hex token, recoverable via `/repair-index` or dismissable via `/repair-index/discard`. |
| **Pending Repair** | A transaction the user has not yet acted on. |
| **Superseded Repair** | A transaction the user has marked as a conflict (or which auto-detected an external change); UI offers "Keep staged changes and dismiss" rather than retry. |
| **Degraded Success** | The success-shaped HTTP response carries auxiliary flags (`indexRefreshFailed`, `repairStatePersistenceFailed`) that the UI must surface as a toast, **without** flipping the operation to a failure. |
| **Repository Operation In Progress** | The vault is mid-way through an external `git merge` / `cherry-pick` / `revert` / `rebase`, evidenced by one or more sentinel files under the absolute Git dir. Docus commits and withdrawals must reject (409). |
| **Managed History Path** | A path under the vault root that passes `isValidHistoryPath` (§7) and is not a History-managed dotfile (`.gitignore`, `.gitattributes`). |
| **WORKTREE** | The literal sentinel value `'WORKTREE'` (re-exported as `WORKTREE_REF`) meaning "the on-disk file"; resolved server-side to a direct `fs.readFile` and never sent to Git itself. Used by History Snapshot reads for `HEAD..WORKTREE` diffs. |

## 6. Authority Model

The Docus History feature operates across **five** stateful entities
with layered authority. The relationship between them is the core of
the History contract. Editor Buffer and Working Tree are ahead-of-HEAD
risks; Real Git Index is an independent staged-state authority that
may carry entries created outside Docus; the Temporary Git Index is
the staging area Docus builds each commit inside and **never** the
Real Index.

```text
   ┌────────────────────┐
   │   Editor Buffer    │
   └─────────┬──────────┘
             │ editor save (Document Save Barrier)
             ▼
   ┌────────────────────┐
   │    Working Tree    │ ◀── may be ahead of HEAD
   └─────────┬──────────┘
             │ capture exact bytes; sha256 CAS
             ▼
   ┌────────────────────┐
   │  Temporary Index   │  ◀── Docus-only staging
   └─────────┬──────────┘  ─── never the Real Index
             │ write-tree / commit-tree (plumbing;
             │ no hooks, no signing)
             ▼
   ┌────────────────────┐
   │ Commit Graph / HEAD│  ◀── immutable commit objects
   └─────────┬──────────┘
             │ scoped post-commit Real-Index sync
             ▼
   ┌────────────────────┐
   │   Real Git Index   │  ◀── external staged state preserved
   └────────────────────┘
```

Reads go through `git show <ref>:<path>` or, for `WORKTREE`, a
direct `fs.readFile`, into the History Snapshot (read-only),
Comparison, or Restore file-change event.

Rules the implementation honors:

1. **Editor vs Working Tree** — The Editor can be ahead of the Working
   Tree (unsaved typing). A Restore may produce bytes that conflict
   with newer Editor edits; `useHistoryRestore` compares
   `tab.revision` before/after the save barrier to detect that and
   preserves the newer edit instead of overwriting it.
2. **Working Tree vs HEAD** — A Create Version captures the **exact**
   Working Tree bytes via `captureExpectedFiles` (sha256 + buffer
   capture) **after** the editor save barrier flushes. The expected
   SHA-256 hashes ride on the request as `expected`. If the bytes shift
   between capture and commit, the server rejects with
   `409 { error: 'content changed before commit' }`.
3. **Real Index vs HEAD** — The Real Index may contain staged content
   from external `git add`. Docus must **not** commit any of that
   content unless the path is in the user's selection. The Create
   Version flow uses a Temporary Git Index seeded only from HEAD, then
   stages exactly the user's selection.
4. **HEAD vs external commit** — Docus moves HEAD only via CAS. If the
   current HEAD value at the moment of `update-ref` differs from what
   the server expected, the server returns `409 { error: 'repository
   changed before commit' }`. The client then refreshes status + log
   and surfaces the conflict as `commit_repository_changed`.
5. **History Snapshot vs Real Git ref** — A Snapshot reads the bytes at
   a ref via `git show <ref>:<path>` and renders them in a read-only
   pane. The pane does not write to disk.
6. **Comparison Current side** — When the user has the document open
   in the editor (a Tab whose `.path === comparison.path` and which is
   not loading and has no `loadError`), the Current side is read from
   the editor's live raw (`tab.raw`). Otherwise it falls back to
   `loadCurrentDocument(path)` which reads via the saved-document API.
7. **Restore mutates Working Tree, not HEAD** — `git restore
   --source=<ref> --worktree` writes the file to disk and does not
   touch HEAD. There is no automatic `git add` of the restored path.
8. **Withdraw mutates HEAD, preserves Working Tree bytes** — The
   `dropHeadCommit` flow verifies `HEAD === sha`, then moves HEAD to
   the parent (or deletes `HEAD` for root). No worktree-side mutation.

> ⚠️ **Known divergence (H-K5)** — The current `/restore` route
> reads the source ref **outside** `withRepoMutation` and never
> resolves the accepted ref to one immutable SHA. The full
> description lives in §15 and the closure block is H-C5; see
> the long-form note in §15 for the source-byte vs restored-byte
> divergence, the client amplification through
> `request.historicalRaw`, and the closure task that must close
> both halves.

## 7. Managed Path Contract

The History feature only operates on a strictly-validated subset of
paths under the vault root.

A path is a **Managed History Path** iff all of the following hold:

```text
- it is a non-empty string;
- it contains no NUL bytes;
- it does not contain a backslash '\';
- it is not absolute (does not start with '/' on POSIX, or
  'C:\' / '\\\\' on Windows);
- it equals its own POSIX normalization
  (i.e. it cannot contain '.' or '..' segments or '//');
- it does not end with '/';
- none of its directory segments starts with '.' (no hidden dirs,
  no '.git/' traversals);
- the file name segment matches
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.md$/ — lowercase kebab + .md;
- every directory segment matches the project's `SEGMENT_RE`
  (re-used from `server/paths.ts:104`,
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/) — lowercase, no underscores,
  no special characters.
```

Files matched as inputs but **not** surfaced in `/status`:

- `.gitignore`
- `.gitattributes`

These are History-managed dotfiles; they are written by `ensureRepo`
on first touch and never clutter the user-facing Changes list.

What the contract **also** forbids:

- Symbolic links. The validation passes on string shape but no
  symlink resolution / `lstat` containment check runs in the History
  surface (unlike the Folder Move / Edit program's path-resolution
  layers; see §10 Known Risks H-K9 — this is a documented consistency
  gap with the rest of the codebase, **out of scope** for this
  closure).
- Files inside a directory whose name starts with `.`. A user with a
  vault containing `.archive/foo.md` cannot commit it through
  History. This is consistent with the Folder Move contract.

The path `.git/` is implicitly excluded because no Status entry for
it can exist (git porcelain ignores it).

The ref string (used by `/file`, `/diff`, `/drop`, `/restore`) must
match **one** of:

- `HEAD` (optionally followed by `~[1-9][0-9]*`),
- `^[0-9a-f]{7,40}$` (abbreviated or full SHA-1 object id; SHA-256 object ids are not accepted by the current History ref contract),
- `^[0-9a-f]{7,40}~[1-9][0-9]*$` (SHA + ancestor),
- `WORKTREE` (only on `/file` and `/diff` when `allowWorktree`).

Branch names, tags, `@{upstream}`, and `..` ranges are deliberately
rejected — History never talks to anything but `HEAD` and immutable
commit objects.

## 8. Repository Initialization Contract

`ensureRepo(repoRoot)` is the single entry point for first-touch repo
setup. Behavior:

1. **Idempotent**: calling it on a vault that already has a `.git/`
   (detected via `hasOwnGitDir` — either directory or file, to support
   worktrees and submodules) is a no-op.
2. **First-touch sequence** (observed):
   1. `outerRepoRoot` walks ancestors for an external repo. If found,
      a console warn is emitted but the vault is **still
      initialized** — nested vaults are allowed.
   2. `.gitignore` is written **only if missing**. Sample lines
      (observed in source): excludes node_modules, .DS_Store, etc.
   3. `.gitattributes` is written **only if missing**. Content is
      the empty string — this is intentional. Adding any
      `* text=auto` line would override `core.autocrlf=false` and
      silently convert `\r\n` ↔ `\n` on Windows, breaking the CRLF
      round-trip test.
   4. `git init` runs (3-step fallback: `--initial-branch=main`,
      `--initial-branch=master`, then plain init).
3. **Configuration**: `git config core.autocrlf false` is set on the
   vault's local git config. This is what gives the
   `CRLF safety` round-trip test its guarantee.
4. **Author identity**: `git config --local --get user.name` /
   `user.email` is probed. If absent, `docus` / `docus@localhost`
   are written. The env vars `GIT_AUTHOR_NAME` /
   `GIT_AUTHOR_EMAIL` take precedence (verified by test).
5. **Git-Unavailable**: every History route guards with `probeGit()`.
   A failure is surfaced as **503** with the body shape:
   `{ dirty: [], available: false }` on `/status`, or
   `{ error: 'git not available' }` everywhere else.

Initialization is **lazy** — it runs on the first request that
touches a vault via the History router. The client does not block on
init; it surfaces `repoInitialized: false` (and optionally
`initError: <reason>`) on capability checks.

## 9. Status Contract

`GET /api/history/status` is the read-only entry point for "what is
dirty in this vault".

- **Command**: `git status --porcelain --untracked-files=all`. The
  `=all` is deliberate: the default `normal` collapses untracked
  directories to a single line, hiding the individual files a user is
  likely to want to commit.
- **Filter**:
  - reject entries whose path is `.gitignore` or `.gitattributes`
    (`MANAGED_HISTORY_DOTFILES`),
  - reject entries whose path fails `isValidHistoryPath` (which
    means dotfile segments and non-`.md` files are filtered out).
- **Sort**: Status preserves git's own order (path-as-printed).
- **Restoration of rename lines**: `git status` writes `R  old -> new`
  on a rename. The current parser captures `old -> new` as the path,
  which then fails `isValidHistoryPath` (the `->` is not a `.md`
  kebab). **Renames therefore do not surface in the Changes list.**
  This is a documented boundary — see §11 (Log and Timeline) for the
  related `--follow` decision and §25 H-K9.
- **Per-entry shape**:
  ```ts
  interface StatusEntry {
    path: string         // forward-slash, relative to vault root
    index: string        // one porcelain column char (' ', 'M', 'A', 'D', '?', ...)
    worktree: string     // one porcelain column char (' ', 'M', 'A', 'D', '?', ...)
  }
  ```
  Observed `index`/`worktree` values for **untracked** files are
  `?` / `?` (or `?` / `?` with the `index = '?'` first char). The
  **rule of thumb the UI uses**: if either side is `?`, the entry is
  "new"; if either side is `D`, the entry is "deleted"; otherwise
  "modified".
- **Read-only**: Status never modifies anything. It does not
  auto-stage, does not auto-clean, does not clear the Index, and does
  not `update-ref`.
- **503 graceful-unavailable**: Git missing on PATH returns
  `{ dirty: [], available: false }` with HTTP 503. The client uses
  `readJson(r, 'getStatus failed', { allowNonOkJson: true })` to
  recover the body rather than throwing. This is explicitly pinned by
  `history-api.test.ts > getStatus > resolves with { available: false }
  on a 503 (graceful unavailable, not an error)`.
- **Other failure (500)**: A 500 (git crashes mid-call, for example) is
  currently treated as "empty JSON success" by `getStatus`, because
  every non-2xx response is routed through
  `allowNonOkJson: true`. **Known divergence (H-C1)** — §25 calls
  this out as a candidate P1 fix; it is intentional for "git missing"
  but the same code path also swallows genuine server faults.

## 10. Create Version Contract

Create Version is the only History workflow that produces a commit.
The contract is:

```text
User selects changed paths in the Changes panel
   ↓
Editor save barrier flushes (saveSelected resolves; DocumentMutationBarrier)
   ↓
Server: route /api/history/commits
   ↓
   ├─ validate path list and message (400 on shape error)
   ├─ validate expected content hashes (exact-key-parity)
   ├─ acquire withRepoMutation(repoRoot)   (per-vault queue)
   ├─ assertRepositoryIdle                  (no MERGE_HEAD / etc.)
   ├─ ensureIndexRepairStorageReady         (preflight write probe)
   ├─ re-read status; 409 'selection is stale' if any selected path
   │  is no longer dirty
   ├─ captureExpectedFiles
   │  ├─ readWorkingTreePath(filePath)  → sha256 + buffer
   │  └─ abort 409 'content changed before commit' if actual != expected
   ├─ ensureAuthorIdentity
   ├─ mkdtemp → indexPath, set GIT_INDEX_FILE
   ├─ for each selected path:
   │  ├─ if deleted → update-index --force-remove
   │  └─ if present → hash-object -w --path --stdin
   │                → update-index --add --cacheinfo 100644 <oid> <path>
   ├─ verify staged blobs:
   │      ls-files --stage in temp index; require oid present
   ├─ if tree resolves to same tree as HEAD^{tree} → 409 'nothing to commit'
   ├─ write-tree
   ├─ commit-tree <tree> (-p parent) -m <message>
   ├─ update-ref HEAD <new> <expectedOld>   (CAS; '0'×40 for empty repo)
   ├─ assertRepositoryIdle again (right before moving HEAD)
   ├─ if non-empty repo:
   │  ├─ ls-files --stage on Real Index for staged paths
   │  ├─ capture index fingerprint for repair records
   │  ├─ syncIndexPaths(repoRoot, <immutable-commit-sha>, paths):
   │  │  retry up to 3× with backoff 25/50/75ms:
   │  │     reset -q <commit-sha> -- <paths>
   │  │     verify HEAD still matches commit-sha
   │  │     verify diff --cached --quiet <commit-sha> -- <paths> exits 0
   │  │  on success → settleIndexRepairPaths(paths)
   │  │  on failure → recordIndexRepair(repoRoot, commitSha, paths,
   │  │                              fingerprintedRealIndex)
   │  │                              inside withRepoMutation + .lock
   ├─ show --name-only --pretty= <sha> → filesCommitted[]
   ├─ return { sha, filesCommitted, indexRefreshFailed?,
   │           indexRepair?, repairStatePersistenceFailed? }
   └─ refresh UI: status, log, comparison(s) for the committed paths
```

Additional obligations:

- **Only selected files are committed**. The Real Index may carry
  pre-staged entries from external `git add`; those are **never**
  carried into the Docus commit because the temp index is seeded
  only from HEAD (or empty repo).
- **Plumbing commit, no hooks, no signing**. Verified by `commit-tree`
  invocation inventory and by the absence of any `-S` /
  `--gpg-sign` / `--no-verify` argument.
- **HEAD CAS is mandatory**. The expected old value is the SHA read at
  the start of the request, plus an additional `assertRepositoryIdle`
  immediately before the `update-ref`. On mismatch → 409
  `'repository changed before commit'`; the client refreshes status +
  log and reports `commit_repository_changed`.
- **Working tree CAS via expected hashes**. The client computes
  SHA-256s of the bytes it believes to be on disk and sends them as
  `expected`. The server re-hashes captured bytes; mismatch → 409
  `'content changed before commit'`.
- **Empty / clean selection → 409**. `selection is stale` (re-read
  status says selected path is now clean) or `nothing to commit`
  (every selected path's tree diff is empty).
- **Repository Operation In Progress → 409**. Checked at entry and
  again immediately before `update-ref`. Markers checked:
  `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `REBASE_HEAD`,
  `rebase-merge`, `rebase-apply`, `sequencer`.
- **Index Repair metadata is durable**. Repairs survive server
  restarts — the file lives next to `.git/`. Repair-record metadata
  persistence failure is **degraded success**, not API failure, with
  toast `commit_repair_state_persistence_failed`.
- **Commit-then-refresh ordering**. The commit CAS is the success
  boundary. A subsequent UI refresh failure (status / log /
  comparison) cannot be reported as "commit failed" — the user sees
  the version, then a deferred refresh error if it happens. Currently
  implemented this way (the `try { commit }` block writes the user-
  visible success state before the refresh block). See §25 H-K2 for
  the residual surface area where this contract could still be made
  more explicit.

> ⚠️ **Known divergence (H-C1)** — `getStatus` treats every non-2xx
> response (including genuine 500s) as a body-shaped success because
> `allowNonOkJson: true` is passed unconditionally. The Create
> Version / Withdraw Restore 409 mapping relies on the **body** of the
> response to determine "stale selection vs CAS conflict vs
> repository operation". A future refactor that prefers
> `r.ok`-first parsing would break this.

## 11. Real Index Safety Contract

The Real Index is the most fragile piece of the system because it
lies between Docus and any external Git command. The current
implementation performs Real-Index synchronization through repeated
`git reset -q <target> -- <paths>` + verify steps; that implementation
has a real data-safety and intent-preservation gap, recorded below
as H-C3. The intended contract §11 is what the closure gate must
verify against.

1. Docus **does not own** the Real Index. The user's external
   `git add` / stage entries are legitimate state the user wants
   preserved.
2. After a successful commit, Docus **synchronizes only the paths
   in the commit**. Unrelated staged entries are not touched.
3. The Real Index is synchronized through a **temporary index
   built from a copy of the current Real Index**, never by
   running `git reset` directly on the locked Real Index:
   ```text
   1. resolve absolute Git directory
   2. acquire .git/index.lock (exclusive create; EEXIST => 'git index is locked')
   3. read current .git/index bytes into memory
   4. write those bytes into a Temporary Index file via a TempDir
   5. point GIT_INDEX_FILE at the Temporary Index
   6. apply scoped git reset -q <target> -- <paths> (or
      update-index --force-remove for deleted paths) against the
      Temporary Index
   7. verify the Temporary Index against the target HEAD using
      ls-files --stage + fingerprint comparison
   8. re-check repository-idle, current HEAD, and any required
      fingerprint / CAS state
   9. write the Temporary Index bytes into .git/index.lock
   10. fsync the lock file
   11. atomically rename .git/index.lock to .git/index
   ```
   This is the same lock-and-rename pattern the existing Repair
   flow already uses (`repairIndexWithLock`); the closure task
   History-C3 applies it to the routine post-commit Real-Index
   sync as well.
4. **Settled vs. persisted-state separation.** A successful
   Real-Index sync that preserves a transaction entry is
   considered settled: the entry is cleared from the persisted
   metadata (or its paths are removed). A failed sync surfaces
   as an Index Repair Transaction, never as a commit failure.
5. **Repair Transaction schema (version 2)**:
   ```ts
   {
     version: 2,
     transactions: [{
       token: string    // /^[0-9a-f]{32}$/, opaque, 32 hex chars
       status: 'pending' | 'superseded'
       head: string | null     // 40–64 hex SHA-1 or SHA-256, or null
       paths: string[]         // non-empty, .md, no leading slashes
       expectedIndex: Record<string, Array<{ mode: string; oid: string; stage: number }>>
     }]
   }
   ```
   Validation is strict: malformed `expectedIndex` entries throw at
   parse time; **corrupt files are quarantined**, not deleted
   (`<file>.corrupt-<ts>-<uuid>.json`).
6. **Repair Token is opaque** to the client. The server is the
   authority on which `expectedIndex` a given token refers to.
7. **Repair has its own CAS**: `repairIndexWithLock` already takes
   `.git/index.lock` by hand (`open(lockPath, 'wx')` →
   `EEXIST` → `'git index is locked'`), re-checks fingerprint both
   **before** and **after** a staged reset, and on mismatch throws
   `'index changed after repair was requested'` and marks the
   transaction `superseded`.
8. **Compatibility check** on resume: `currentHead === transaction.head`
   OR `merge-base --is-ancestor transaction.head currentHead` —
   refuses to repair against a non-ancestor.
9. **Discard is selective**: `discardIndexRepair` only clears the
   metadata entry; it **never** alters the Real Index. The UI surfaces
   it as "Keep staged changes and dismiss".
10. **Repair persistence failure → degraded success**, not API error.
    `repairStatePersistenceFailed` flag carries the warning.

> ⚠️ **Known divergence (H-C3)** — The current implementation does
> NOT follow §11.3 yet. The current `syncIndexPaths` runs
> `git reset -q <commit-sha> -- <paths>` directly against the Real
> Index with up to three retries. There is a window between the
> first reset and the verification during which an external
> `git add <target-path>` can land, and the next retry's reset
> will clear that newly staged entry. **Working Tree bytes may
> remain intact, but the user's staged intent can be lost.** This
> is a data-safety and intent-preservation problem that remains a
> P1 Closure Blocker. The current behaviour is fully captured in
> the Implementation Record's `/commits` sequence and is exercised
> only in the success path; the race window is documented but not
> asserted by any test. See §25 H-K3 / H-C3 and Plan closure task
> History-C3.

## 12. Log and Timeline Contract

```text
GET /api/history/log?path=<opt>&limit=<opt, defaults to nothing ⇒ 200>
```

- **Default limit**: 200 (client-side). The server accepts `limit`
  via query string and applies it to `git log -n<limit>`.
- **Path filter**: optional `path=<note-relative>` segments the log to
  commits touching that file. Implemented server-side as
  `git log --pretty=format:… --name-only -n<limit> -- <path>`.
- **Order**: newest first.
- **No `--follow`**: by deliberate decision. The comment in source
  states: *"No `--follow` for now: on a vanilla "create new file"
  commit, `--follow` falsely attributes earlier commits of unrelated
  files to this path."* Therefore a rename is logged under the new
  path only — earlier history of the old path is **not** pulled in.
  See §25 H-K9 (Rename history not followed).
- **CommitRecord shape** (server `parseLog`):
  ```ts
  interface CommitRecord {
    sha: string         // '0'..'f' full SHA, 40 chars
    author: string
    date: string        // ISO 8601 committer date (strict)
    subject: string
    body: string        // may be empty
    files: string[]     // paths in --name-only order
  }
  ```
- **Empty repo**: `parseLog` collapses the
  `/does not have any commits yet/i` / `/ambiguous argument ['"]?HEAD['"]?/i`
  patterns and returns `[]`.
- **Timeline aggregation**: `useHistoryTimeline` walks the log, splits
  commits by per-file `files[]`, and produces one
  `DocumentHistory` per path with sorted revisions and a `modifiedAt`
  timestamp.
- **Date grouping**: `groupTimelineItems` uses local-time
  `getFullYear` / `getMonth` / `getDate` and a 86_400_000 ms window
  to bucket items into Today / Yesterday / weekday names / Last Week /
  Month / Earlier. (See §25 H-K7 — DST boundaries may shift a
  timestamp into the wrong local-day bucket; observed behavior, not a
  blocker.)
- **Per-document loading**: clicking a `DocumentHistory` issues
  `getLog({ path, limit: 200 })`. Request ID guards (`revisionRequestId`)
  prevent a slow stale response from overwriting a newer one.
- **Empty / error states**: rendered inline via
  `history-empty-inline` ("No revisions available for this document.")
  and `history-error` (with a Retry button). Localized via
  `useI18n`.

## 13. Snapshot Contract

A Snapshot is a read-only view of the bytes of a single document at a
specific commit.

- **Endpoint**: `GET /api/history/file?path=<file>&ref=<ref>`. `ref`
  defaults to `HEAD`. `ref=WORKTREE` resolves to the on-disk bytes.
- **Identity**: snapshot tab id is `history:<path>` (one tab per
  document; re-using it on another revision updates its body).
- **Loading / ready / error** is a tri-state in
  `useHistorySnapshots` (`HistorySnapshotStatus`). Initial fetch goes
  through `loading`; `ready` once the `getFileAt` promise resolves;
  `error` if it rejects (along with `error: <message>`).
- **Request ID cancellation**: each `(re)open` increments the
  per-tabId request counter. Slow responses that arrive after a newer
  selection are dropped.
- **Cached revisions**: `openCachedRevision(rawMarkdown)` reuses the
  same tab with `status='ready'` and the supplied bytes (used when an
  existing comparison should pivot to a snapshot, e.g. opening a
  snapshot from a Comparison pane).
- **Retry**: `retrySnapshot(tabId)` re-issues `openRevision` with the
  existing `revisionId` without changing the tab identity.
- **Read-only storage**: The `HistorySnapshot.rawMarkdown` is the
  renderer's input. The pane (`HistorySnapshotPane.vue`) renders it
  through `<ReadingPane>`, which uses the same markdown pipeline as
  the live Reading Pane — but the snapshot is **not** an editable
  Monaco tab, so AI / Document mutation tools that target the editor
  cannot reach it.
- **AI surface separation**: A Snapshot tab id of `history:<path>`
  never collides with the editor's `tab.id` for the same path. The
  AI tool-card contract writes only to editor tabs identified by the
  document path; a History tab does not satisfy that contract.

## 14. Comparison Contract

A Comparison is the side-by-side diff between a historical revision
and the current content of the document.

- **Endpoint flow**:
  ```text
  snapshot.rawMarkdown = getFileAt(path, ref)         // server
  comparison.newRaw = openEditorTab.raw ?? loadCurrentDocument(path)  // client
  comparison.diff = computeFileDiff(oldRaw, newRaw)  // client-only
  ```
- **Historical side**: server `getFileAt`. Refresh-capable via
  `openRevision` (same `tabId = 'history:<path>'`) so opening the
  Comparison from a Snapshot tab reuses the cached bytes.
- **Current side — live editor raw preferred**: `useHistoryComparisons`
  is constructed with `getCurrentDocument(path)` and
  `loadCurrentDocument(path)`. If the path is open in an editor tab
  that is not loading and has no `loadError`, the live raw is used
  and `currentDirty = (tab.raw !== tab.originalRaw)`. Otherwise the
  saved-document API is consulted.
- **`currentDirty`** is a UI flag, not a diff input. It renders as a
  "Unsaved changes" badge in the Comparison pane so the user knows
  the comparison's Current side is showing in-memory unsaved edits.
- **Identical content**: `computeFileDiff` short-circuits to
  `{ ops: [], stats: { 0, 0, 0 } }` when `oldContent === newContent`.
  The Comparison pane renders the "identical" state with a "Latest
  version" badge in that case (verified by test).
- **Refresh path**: a successful Create Version / Withdraw calls
  `refreshDocumentComparison(path)` for each touched path; partial
  success is logged but does not roll back the main op.
- **Refresh failure is not commit failure**: client code never
  blends refresh failures into the commit success state. See §25 H-K2
  for the residual surface.

## 15. Restore Contract

Restore writes the bytes of a document at a chosen ref into the
Working Tree without creating a commit.

```text
user clicks Restore this version (Snapshot pane)
   ↓
useHistoryRestore.buildRequest(source)
   ├─ snapshots the current dirty state via getLoadedEditorDocument
   ├─ captures revisionA + raw + revisionTime at the moment of the
   │  user gesture (mutations to source afterwards cannot affect the
   │  request)
   ↓
options.confirm(request)               ← user confirms in dialog
   ↓
options.acquireMutation([<path>])      ← pathMutationLock
   ↓
options.prepareEditorRestore(path)     ← DocumentMutationBarrier
   ├─ if prepareEditorRestore rejects: rollback
   ↓
server /api/history/restore:
   ├─ validate { path, acceptedRef }                       ← shape: 400
   ├─ if acceptedRef === 'WORKTREE' → 400 'cannot restore to the working tree'
   ├─ enter one withRepoMutation(repoRoot) transaction
   ├─ resolve acceptedRef → resolvedSha:
   │     rev-parse --verify <acceptedRef>                  ← mutable HEAD path
   ├─ read:  git show <resolvedSha>:<path>
   │         if null → 404 'file does not exist at ref <acceptedRef>'
   ├─ write: git restore --source=<resolvedSha> --worktree -- <path>
   ├─ re-read: fs.readFile(repoRoot/<path>)        ← post-restore bytes
   ├─ stat:    fs.stat(repoRoot/<path>).mtimeMs
   └─ return {
         path,
         requestedRef: acceptedRef,
         resolvedRef: resolvedSha,
         raw: postRestoreWorkingTreeBytes,
         mtime,
       }
   ↓
client applyRestoredContent OR applyRestoreWithoutOverwritingNewerEdit
   ↓
editorBarrier.commit([path])
   ↓
options.fileChanges.publish({ kind: 'write', newRaw, source: 'history-restore' })
   ↓
Promise.allSettled([ refreshVault, refreshComparison ])
   ↓
options.onSuccess({ refreshFailed })  ← refreshFailed true is partial-success, not failure
```

Hard rules:

- **WORKTREE is forbidden as a Restore source.** The route validates
  `ref === WORKTREE_REF` and rejects with **400 'cannot restore to
  the working tree'**. WORKTREE is permitted on `/file` and `/diff`
  only.
- **The accepted request ref is validated but not yet resolved.**
  The route validates the request shape with `isValidHistoryRef`,
  which accepts only `HEAD` (optionally `~N`), `sha~N`, or a
  7–40-hex SHA. Branch names, tags, `@{upstream}`, and
  `..` ranges are rejected. None of those accepted shapes is
  itself immutable: `HEAD` and `HEAD~N` resolve at call time; a
  7-char short SHA resolves only when the route asks Git for
  the matching full SHA. The route must therefore, before any
  read or write, resolve the **accepted request ref** to **one
  immutable full commit SHA** inside the repository mutation
  transaction.
- **Read and write use the resolved SHA verbatim.** Both
  `git show <sha>:<path>` and `git restore --source=<sha>
  --worktree` are invoked with that resolved SHA; the textual
  request ref is never reused.
- **The destination is the Working Tree, not HEAD and not the Real
  Index.** `git restore --source=<sha> --worktree` is used. The
  `--worktree` flag is the only safe choice — checkout-style
  restore would also update the Index, silently staging a
  destructive restore.
- **Client treats `result.raw` as authoritative.** The
  `RestoreFileResult.raw` returned by the route is the
  post-restore Working Tree bytes (read inside the same mutex as
  `restoreFile`). The client uses `result.raw` — not
  `request.historicalRaw`, which is the source ref's snapshot
  bytes captured at the moment of the user's gesture —
  to update `tab.raw`, `tab.originalRaw`, and
  `VaultFileChanges.newRaw`. The `applyRestoredContent` /
  `applyRestoreWithoutOverwritingNewerEdit` helpers take both
  the source bytes and `result.mtime`. If the server contract
  ever diverges from the source snapshot (e.g. server-side
  normalization), the client surfaces the discrepancy via
  `result.raw` rather than silently trusting the historical
  view.
- **Newer in-editor edits are not overwritten.** `useHistoryRestore`
  compares `tab.revision` before/after the prepare barrier; if the
  tab was edited concurrently (a user typed while restore was pending),
  the helper enters `applyRestoreWithoutOverwritingNewerEdit` and
  marks the tab dirty, while still publishing `result.raw` as the
  new `originalRaw` and `newRaw` (verified by `useHistoryRestore.test.ts`).
- **Mutation lock is held across the whole op**. The path lock is
  released in the `finally`. If another workflow (Create Version,
  another Restore) holds the lock at entry, the user sees
  'document_mutation_in_progress' and `onConflict` fires.
- **Failure during restore rolls back the editor save barrier** so
  the editor can resume saving with whatever bytes it had before the
  barrier was opened.

> ⚠️ **Known divergence (H-C5)** — The current `/restore` route
> reads the source ref **outside** `withRepoMutation` and never
> resolves the accepted ref to one immutable SHA. For mutable refs
> such as `HEAD` or `HEAD~N`, the source-byte read and the
> `git restore` invocation may resolve to different commits: the
> response may report source bytes from one commit while the
> Working Tree is restored from another. Worse, the response's
> `raw` field carries pre-restore source bytes — not a
> post-restore Working Tree re-read — so a concurrent writer
> between `restoreFile` and the response yields an `raw` /
> `mtime` pair that does not match the bytes on disk. The
> current client also writes `request.historicalRaw` into the
> editor tab and the file-change event, which amplifies the
> divergence: the editor sees the user's gesture-time snapshot
> instead of what actually landed on disk. See §25 H-K5 /
> H-C5. Plan closure task History-C5 requires resolving the
> accepted ref to one immutable SHA inside the same mutex as
> the file write **and** routing the post-restore bytes back
> to the client as the authoritative `result.raw`.

## 16. Withdraw Contract

Withdraw drops the latest commit. The exact sequence matters
because the Real-Index synchronization path set is derived from
the commit's changed files — discover them **before** moving
HEAD.

```text
useHistoryWithdraw.withdraw(sha):
   1. confirm + acquireMutation()                        ← pathMutationLock.acquireAll()
   2. POST /api/history/drop { sha }
        │
        ▼ server:
   3.  validate sha                                       ← 400
   4.  ensureRepo + probeGit                              ← 503 graceful
   5.  withRepoMutation(repoRoot, async () => {
   6.    assertRepositoryIdle                             ← 409 'repository operation in progress'
   7.    rev-parse --verify HEAD  → expectedOld
   8.    assert HEAD === sha                              ← 409 'only the latest version can be withdrawn'
   9.    show --no-renames --name-only <sha>             → filesChanged
   10.   filter filesChanged to managed Markdown paths
   11.   resolve parent: rev-parse <sha>^                → parent | null
   12.   assertRepositoryIdle (again, immediately before moving HEAD)
   13.   CAS move HEAD:
            parent === null: update-ref -d HEAD <expectedOld>      ← root withdraw
            else:            update-ref HEAD <parent> <expectedOld> ← non-root
   14.   syncDroppedIndexPaths(repoRoot, filesChanged)    ← scoped Real-Index sync
            failure ⇒ recordIndexRepair(...)
            success ⇒ settleIndexRepairPaths(filesChanged)
   15.   return { sha, droppedSha, filesChanged,
                   indexRefreshFailed, indexRepair?, repairStatePersistenceFailed }
         })
   16. closeDroppedRevision(droppedSha)            ← snapshot/diff tab closure
   17. Promise.allSettled([refreshStatus, refreshLog,
                           refreshComparisons(filesChanged)])
   18. registerIndexRepair / settleIndexRepairPaths as appropriate
   19. toast.success(success) — partial degradation surfaces as info toast
```

Hard rules:

- **Only the latest commit is withdrawable.** The server checks
  `HEAD === sha` and rejects mismatches with
  409 `'only the latest version can be withdrawn'`.
- **Withdraw always attempts a CAS mutation of HEAD.** No
  commit is created; no commit object is rewritten; no
  `git reset --mixed` is used.
- **After HEAD moves successfully, Docus attempts scoped
  Real-Index synchronization for affected Markdown paths.**
  The synchronization covers only the managed Markdown paths
  in `filesChanged`; it preserves every unrelated staged entry.
  Failure is recorded as an Index Repair Transaction
  (`recordIndexRepair`) and reported as a degraded success via
  `indexRefreshFailed` — never as a withdrawal failure.
- **For a withdrawn root commit**, the affected Markdown paths
  are removed from the Real Index (the index reflects "nothing
  here yet"), their Working Tree bytes remain on disk, and
  they become untracked in `git status` (`??`). The user can
  recommit them through the normal Create Version flow.
- **Unrelated Real-Index entries survive.** The Real-Index
  sync touches only the affected paths in `filesChanged`; any
  entry the user staged with external `git add` on a different
  path is left exactly as it was.
- **Working Tree bytes are preserved.** Withdraw never touches
  the Working Tree, regardless of root or non-root case.
- **Index-Repair-aware.** Withdraw passes through the same Repair
  transaction machinery as Create Version.
- **Refresh after withdraw**: `useHistoryWithdraw.withdraw` calls
  `useHistory.refreshStatus`, `useHistory.refreshLog`, and
  `refreshComparisons(<filesChanged>)`. Timeline selections are
  reconciled by `HistoryPanel`'s watcher on `withdraw.completionId`,
  which calls `selectDocument` if there is still a selected document
  (and `showDocuments()` if it has no revisions left).
- **Snapshot / Comparison tabs**: when a withdrawn revision is open,
  `closeDroppedRevision` (host-supplied, verified test
  `'is single-flight and refreshes Status, Timeline, revisions,
  comparisons, and repair state'`) is invoked to close those tabs.

> ⚠️ **Known divergence (H-C4)** — The current implementation
> withdraws any commit currently at `HEAD`, regardless of whether
> Docus created it. A user's external commit (e.g. made from the
> terminal) can be withdrawn by the History UI if it is the most
> recent commit. The intended contract, per the task instructions, is
> "Withdraw can only withdraw versions created and owned by Docus".
> The Plan §15 closure task proposes a commit trailer scheme (e.g.
> `Docus-Version: 1` + a stable `Docus-Vault-Version: <id>`) and a
> corresponding check in `dropHeadCommit`. See §25 H-K4 and the
> closure blockers §25 H-C4.

> ⚠️ **Known divergence (H-K6)** — The validation
> `isValidCommitSha` accepts **7-character short SHAs**. The server
> comparison is `head === sha` where `head` is always a 40-character
> full SHA. A short SHA can never match. The user sees
> 'only the latest version can be withdrawn' on every short-SHA
> request — not a resolution failure, but an obvious UX wart. The
> Plan §15 closure task (History-C6) requires resolving the short
> SHA to a full SHA before the `HEAD === sha` check.

## 17. Repository Mutation Serialization

Docus never assumes two processes — or two workflows within one
process — are isolated by Git's `index.lock`. Beyond the file lock,
Docus serializes **mutating** operations per vault through
`withRepoMutation(repoRoot)`:

| Operation | Wrapped? |
|-----------|----------|
| `addAndCommit` (Create Version) | Yes |
| `dropHeadCommit` (Withdraw) | Yes |
| `restoreFile` (Restore) | Yes |
| `repairIndex` | Yes |
| `discardIndexRepair` | Yes |
| `status` | No (read-only) |
| `log` | No (read-only) |
| `rawAt` | No (read-only) |
| `isRepo` / `initRepo` | No |

Mechanism:

- A module-scope `Map<repoRoot, Promise<void>>` is keyed by
  `path.resolve(repoRoot)`.
- Each new operation tails onto the previous one with
  `previous.catch(() => {}).then(operation)` so a rejected
  predecessor doesn't poison the chain.
- On completion, the chain tail removes itself from the map.

**Limits**:

- This mutex is **process-local**. Two Docus processes on the same
  vault are still serialized only by Git's own `index.lock`.
- Read-only operations bypass the mutex; an `addAndCommit` running
  in one corner does not pause a `status` in another.
- The mutex does **not** close TOCTOU windows that begin outside the
  locked section (Restore §15 Known Divergence).

Client-side, `pathMutationLock.createPathMutationLock` provides an
in-memory exclusion that prevents:

- a Create Version from starting while a Restore holds the path,
- a Restore from starting while a Create Version or Withdraw holds
  the path,
- an editor save from interleaving with either of the above.

The lock also has an `acquireAll()` mode used by Withdraw to take a
vault-wide lock for the drop's CAS. Verified by
`pathMutationLock.test.ts > uses a Vault-wide lock to exclude Create
Version and Restore mutations`.

## 18. Repository Operation State

Docus **must not** continue Git operations while another process is
in the middle of `git merge`, `git cherry-pick`, `git revert`, or
`git rebase`. The server probes the absolute Git directory (via
`rev-parse --absolute-git-dir`) for the following sentinel files /
directories at the start of mutating operations:

```text
MERGE_HEAD
CHERRY_PICK_HEAD
REVERT_HEAD
REBASE_HEAD
rebase-merge
rebase-apply
sequencer
```

Presence of any of these (other than `ENOENT`) is a `409 Repository
operation in progress`. Both Create Version and Withdraw check this
state **at entry** and **again immediately before moving HEAD**.
Repair (`repairIndex`) and the auxiliary sync helpers check it after
each reset / repair write.

When a Repository-Operation conflict fires, the client UI shows
`history.repository_operation_in_progress` (Create Version) or
`history.withdraw_repository_operation` (Withdraw) and refreshes
status.

## 19. Error Model

The History feature distinguishes the following failure shapes. Each
has a recommended HTTP status and UI behavior.

| Class | HTTP | UI |
|-------|------|----|
| Validation Error | 400 | Toast `history.commit_save_failed` (or mirror); no commit happened. |
| Not Found | 404 | Read-side error in snapshot/diff/restore; the pane renders an alert with Retry. |
| Conflict — content changed | 409 `'content changed before commit'` | `commit_repository_changed`; status + log refreshed; no commit. |
| Conflict — stale selection | 409 `'selection is stale'` | Same as above; the panel deselects stale rows. |
| Conflict — CAS | 409 `'repository changed before commit'` | `commit_repository_changed`; status + log refreshed. |
| Conflict — operation in progress | 409 `'repository operation in progress'` | `history.repository_operation_in_progress`; status refreshed. |
| Conflict — Index Repair | 409 `'index changed after repair was requested'` | `history.index_repair_conflict`; UI offers Discard, not retry. |
| Git Unavailable | 503 `git not available` for most routes; 503 `{dirty:[],available:false}` for `/status` | EmptyState panel; mutating buttons disabled. |
| Degraded Success | 200 with `indexRefreshFailed` / `repairStatePersistenceFailed` flags | Info toast, operation counted as success. |
| Post-success Refresh Failure | Network / 5xx after the success response | Per-workflow toast (`history.commit_repository_changed` family); user sees the commit succeeded. |
| Unexpected Server Failure | 5xx without `error` body | Generic fallback string `'createCommit failed: 500'`. |

The three "commit succeeded but…" shapes — `indexRefreshFailed`,
`repairStatePersistenceFailed`, and post-success refresh — must
**not** collapse into a single "creation failed" toast. The current
implementation distinguishes them via separate `toast.info` variants:
`commit_index_refresh_failed`, `commit_repair_state_persistence_failed`,
and a normal success. See §25 H-K2 for the residual surface where a
network outage between `fetch 201` and `Promise.all([refreshStatus,
refreshLog])` could surface as the wrong flavor of degraded success.

## 20. Accessibility

The current code has the following accessibility affordances:

- `HistoryPanel` root: `aria-label="History"` (i18n key `history.title`).
- `HistoryChangesPanel`:
  - `<section aria-busy>` on the Changes section and the version
    composer;
  - `<input type="checkbox">` per change row with an `aria-label` of
    `history.include_document { path }`;
  - the textarea has `aria-label="Version message"`;
  - the create-version button changes its visible label to
    `history.creating_version` while busy, with a `role="status"`
    mirror for screen readers;
  - error / status strings are exposed via `role="alert"` /
    `role="status"` so AT users hear them.
- `TimelineGroup`: `role="group"` with `aria-label="<label>"`.
- `TimelineDocumentRow` / `TimelineRevisionRow`: `role="option"` with
  `aria-selected` toggling; Enter opens, ArrowDown/ArrowUp walk
  options, Escape returns to the document list (HistoryPanel wires
  these).
- `HistorySnapshotPane` / `HistoryComparisonPane`: `aria-busy` while
  restoring, `aria-label` on the toolbar, `<h2 tabindex="-1">` as the
  focus target exposed through `defineExpose({ focusViewer })`.
- `HistoryContextMenu` (revision menu): `role="menu"` with a single
  `role="menuitem"` button. Opens on `contextmenu` (right click) or
  `Shift+F10` / `ContextMenu` key. Closes on Escape (focus is
  restored to the row that opened it) or on a document-level
  `pointerdown` outside the menu.
- Empty / loading / error states:
  `role="status"` for skeleton + loading; `role="alert"` for errors
  with a Retry button.

What is **not** currently implemented (boundary recorded here, not a
Spec deviation):

- The `HistoryChangesPanel` `<select-all>` button currently toggles
  to "Deselect all" but does not carry an `aria-pressed` to expose the
  toggle state to AT. (Sympathetic to a non-blocker improvement; not
  counted as a closure blocker.)
- The `HistoryContextMenu` does not support arrow-key navigation
  inside the menu; only Escape closes it. (Acceptable; one item.)

## 21. Performance

- **Git subprocess overhead**: each route is a fresh
  `child_process.spawn`. There is no caching of `git status`,
  `git log`, etc. across requests. For a vault of N notes, the
  cost is `O(N)` file-system listings per Status and `O(N)`
  walk per `git log -n 200 --name-only`.
- **Status cadence**: `git status --porcelain --untracked-files=all`
  enumerates each untracked file individually. The default cwd is
  the vault root; the test suite runs in `mkdtemp` repositories.
- **`git log` limit (default)**: 200. Set client-side (`useHistory`'s
  `refreshLog` passes `limit: 200`). The server does not enforce a
  cap.
- **Single-document log**: same limit (200) for the per-document
  flow.
- **`MAX_CAPTURE_BYTES`**: 10 MiB per `git` invocation. Compared
  against `current.length` — i.e. **JS string UTF-16 code units**, not
  bytes. Non-ASCII output caps sooner. Overflow SIGKILLs the child.
- **Default timeout**: 15 000 ms per `git` invocation
  (`DEFAULT_GIT_TIMEOUT_MS`). On timeout, the child is SIGKILLed
  and the route returns the captured stderr as part of the
  rejection message.
- **Diff is computed on whichever side computes it first**:
  `computeFileDiff` runs in `useHistoryComparisons` (client) for
  the current-side flows and in `server/history/diff.ts` (which
  re-exports `computeFileDiff`) for `/diff` endpoints.
- **Timeline aggregation**: `O(total revisions)` over the global
  log; per-document fetch is an additional O(revisions-in-this-doc)
  walk that runs once per `selectDocument`.
- **Large-vault risk**: there is no pagination of the Timeline or
  any other History surface. A vault with thousands of documents /
  tens of thousands of commits ships everything to the client and
  re-renders on every refresh. Not a blocker for the documented use
  case, recorded as H-K10.

## 22. Security

- **No shell**: `child_process.spawn('git', args, { cwd: repoRoot,
  windowsHide: true })` — args array only. No `shell: true`. No
  string interpolation into args.
- **`--` separator**: any path passed to git commands is preceded by
  `--` (e.g. `git ls-files --stage -- <path>`,
  `git restore --source=<ref> --worktree -- <path>`), preventing a
  leading-`-` path from being interpreted as a flag.
- **Path validation**: §7. Strict allowlist; paths must lowercase
  kebab segments and a `.md` extension; no `..` segments, no
  backslashes, no dotfile segments, no absolute paths.
- **Ref validation**: HEAD / `HEAD~N` / 7–40-hex SHA / 7–40-hex + `~N`.
  Branch names, tags, `@{upstream}`, `..` ranges are rejected.
- **SHA validation** in the rest of the API: same 7–40 hex.
- **WORKTREE sentinel** never reaches git. The route guards
  `body.ref === WORKTREE_REF` and rejects with 400 on `/restore`.
  `rawAt` short-circuits the sentinel to `fs.readFile` plus a
  path-containment check (`safeWorktreeFile`).
- **Opaque repair token**: `/^[0-9a-f]{32}$/`. Validation in
  `validRepairTransaction`. Clients cannot forge a repair; they
  can only act on tokens the server returned.
- **repoRoot is trusted input**: it comes from `routes._repoRoot`
  which defaults to `CONTENT_DIR`. It is not a request-derived
  value.
- **No path escape**: `safeWorktreeFile` re-validates the resolved
  path under the vault root as a defense-in-depth measure.
- **Git stderr**: surfaced to the UI through the `error` field on
  the response. The error string is git's own stderr (e.g. "file
  does not exist at ref HEAD~1"), which is informational and does
  not disclose anything sensitive.
- **External staged content protection**: §11.
- **Non-Docus commit withdraw risk**: §16 / H-C4.

## 23. Compatibility

- **Operating systems**: Windows, macOS, Linux. Tested via the
  per-platform CI (`playwright.cross-platform.config.ts`,
  `playwright.draft-store.config.ts`) and the slow real-git history
  tests (which have explicit timeout ceilings as of `bf28078`).
- **CRLF**: handled — `core.autocrlf=false` is set on first
  initialization. `commit-tree` is a plumbing commit whose object
  bytes are exactly what was given to `hash-object`; the CRLF
  round-trip test passes byte-for-byte.
- **SHA-1 assumption**: the route validators accept 7–40 hex
  (SHA-1 range). The `update-ref` CAS sentinel `'0'.repeat(40)` is
  **40 zeros**, hardcoded. A SHA-256 vault would need 64 zeros; the
  repair-file validator already accepts 40–64. This is documented
  but **not** a current incompatibility (we still ship with SHA-1).
- **Root commit / empty repo**: handled; sentinel `'0'×40` enables
  the first commit, and the route returns 404 / 200 cleanly when
  there are no commits yet.
- **Nested repos**: `outerRepoRoot` warns but proceeds. The
  History feature manages the **inner** vault's `.git` only.
- **Existing repo**: `ensureRepo` is a no-op when `.git` already
  exists. The user's existing `.gitignore` and `.gitattributes`
  are not overwritten.
- **Git missing**: 503 + body shape per §19.
- **`.git` as file (worktree/submodule)**: supported by
  `hasOwnGitDir` checking both file and directory.
- **File locks**: Only `EEXIST` on `.git/index.lock` is currently
  normalized to `'git index is locked'` and surfaced as such.
  Other platform-specific lock errors (e.g. `EPERM`, `EBUSY`,
  `EAGAIN` on Windows) currently propagate unchanged. The
  intended C3 contract normalizes the explicitly reviewed
  Windows lock-error set.
- **SQLite is NOT used for History state**. Index-repair metadata
  is JSON on disk under the git dir, not a DB. The vault's SQLite
  metadata is left alone by the History feature.

## 24. Acceptance Criteria

The Vault Git History feature is closable when **all** of the
following are verified:

```text
[ ] Git capability detection surfaces 503 + appropriate body on
    every mutating endpoint when git is missing.
[ ] Status read-only returns a managed subset of dirty paths
    with stable index/worktree letters.
[ ] Log newest-first with limit 200.
[ ] Snapshot reads the bytes at the requested ref
    (file does not exist at ref → 404).
[ ] Diff returns line + word ops; identical content →
    empty ops / zero stats.
[ ] Create Version:
      [ ] commits only selected paths
      [ ] preserves unrelated staged entries
      [ ] rejects with 409 'selection is stale'
      [ ] rejects with 409 'content changed before commit'
      [ ] rejects with 409 'repository changed before commit'
      [ ] rejects with 409 'repository operation in progress'
      [ ] updates HEAD via CAS only
      [ ] attempts Real-Index sync; degradation surfaces as a
          repair transaction
      [ ] plumbing commit: no hooks, no signing
      [ ] refreshes Status / Log / Comparison for committed paths
[ ] Restore:
      [ ] rejects WORKTREE
      [ ] changes Working Tree only (no HEAD, no Index)
      [ ] bars concurrent Create Version on the same path
      [ ] preserves newer in-editor edits
      [ ] resolves ref to immutable SHA inside the same mutex
        (H-C5 — closure blocker)
[ ] Withdraw:
      [ ] only the latest version can be withdrawn
      [ ] does not touch Working Tree
      [ ] preserves unrelated staged entries
      [ ] rejects non-Docus commits (H-C4 — closure blocker)
      [ ] resolves short SHAs to full SHAs before the HEAD
        comparison (H-K6)
      [ ] refreshes Status / Log / Timeline / Comparison /
        Repair / Snapshot / Diff tabs
[ ] Index Repair:
      [ ] disk-persisted, durable across restarts
      [ ] schema version 2 with v1 migration path
      [ ] quarantine on corrupt parse
      [ ] supersede-on-external-change with safe Discard
      [ ] repair-token opaque
      [ ] Routine Real-Index synchronization uses one lock-protected
          Temporary-Index attempt with atomic replacement.
      [ ] No destructive reset retry is performed on the Real Index
          during routine sync (user-initiated Repair retry is a
          separate, manual operation).
[ ] Accessibility:
      [ ] Keyboard nav: Enter, ArrowUp/Down, Escape
      [ ] Context menu opens on right-click and Shift+F10
      [ ] Tab focus restored on Escape close
[ ] Multi-vault isolation:
      [ ] Per-vault status / log caches
      [ ] Per-vault mutation serialization
[ ] Test:
      [ ] All server history tests pass
      [ ] All composable history tests pass
      [ ] All component history tests pass
      [ ] Long Flow A e2e passes
      [ ] npm test -- --run is green
[ ] Tools:
      [ ] npm run typecheck is green
      [ ] npm run build is green
      [ ] git diff --check is green
```

## 25. Known Risks and Open Questions

These are the open items at the time of this reconstruction. P1 items
are Closure Blockers; the rest are documented hazards that future
maintainers need to be aware of.

| ID | Item | Severity | Closure Blocker |
|----|------|----------|-----------------|
| H-K1 | `getStatus` resolves every non-2xx response as a body-shaped success because `allowNonOkJson: true` is passed unconditionally. This is the right behavior for the `503 { available: false }` graceful-unavailable signal but it also swallows genuine 500 responses without an error path. | P1 | **Yes** (H-C1) |
| H-K2 | Commit / Withdraw success-state and refresh-error separation depends on every downstream `Promise.all([refreshStatus, refreshLog, …])` not being treated as failure. A network error between `fetch 201` and the refresh round-trip could still surface ambiguously in the toast flavor; the per-workflow tests assert the variants but a tighter contract for "commit succeeded, refresh failed" is not formally written down. | P1 | **Yes** (H-C2) |
| H-K3 | The current retrying Real-Index synchronization can overwrite or clear newly staged target-path entries created by an external Git operation during the reset/verify retry window. Working Tree bytes may remain intact, but the user's staged intent can be lost. This is a data-safety and intent-preservation problem and remains a P1 Closure Blocker. The closure task History-C3 must move the sync to a Temporary Index seeded from the current Real Index and renamed into place under hand-taken `.git/index.lock`, matching the existing Repair flow's lock-and-rename pattern. | P1 | **Yes** (H-C3) |
| H-K4 | `dropHeadCommit` withdraws any commit currently at HEAD, regardless of who created it. A user's external commit can be withdrawn by the History UI. Intended contract requires a Docus commit trailer (e.g. `Docus-Version: 1` + stable `Docus-Vault-Version`). | P1 | **Yes** (H-C4) |
| H-K5 | Restore resolves and reads a mutable ref outside the repository mutation transaction and never resolves the accepted ref to one immutable full commit SHA. The response carries pre-restore source bytes (read by `rawAt`), not a post-restore Working Tree re-read, so a concurrent writer between `restoreFile` and the response yields an `raw` / `mtime` pair that does not match disk. The current client also writes `request.historicalRaw` (the gesture-time snapshot bytes) into `tab.raw`, `tab.originalRaw`, and the file-change event, which amplifies the divergence. The closure task History-C5 must resolve the accepted ref to one immutable SHA inside `withRepoMutation`, re-read disk after `restoreFile`, and route the post-restore bytes back to the client as `result.raw`. | P1 | **Yes** (H-C5) |
| H-K6 | `isValidCommitSha` accepts 7-character short SHAs; `head !== sha` compares two 40-character SHAs. A short SHA can never match → user always sees 'only the latest version can be withdrawn' on a short request. | P2 | Yes |
| H-K7 | Timeline date grouping uses local-calendar buckets with an 86_400_000 ms window. Near DST transitions, a commit's calendar day can be ambiguous by ±1 hour. The UI label uses `Intl.DateTimeFormat` which respects the user's locale. | P2 | No |
| H-K8 | Rename history is **not** `--follow`-merged. A rename produces two separate `DocumentHistory` entries (old-path, new-path). The Status contract hides rename lines because they fail `isValidHistoryPath`. | P2 | No |
| H-K9 | History path validation does NOT include a symlink / `lstat` containment check (unlike the Folder Move / Edit-program layers). A symlink-shaped path inside the vault is validated by string shape only. This is a consistency gap with the rest of the codebase. | P2 | No |
| H-K10 | No pagination on Timeline or Log; large-vault performance is unknown and bounded only by the 200-row client-side log limit. | P2 / risk | No |
| H-K11 | Full-suite CI / Windows / cross-platform verification was not independently re-run during this reconstruction. | P1 | **Yes** (H-C8) |
| H-K12 | The Docus commit-trailer scheme (H-K4) has not been finalized. The Plan §15 closure task proposes a concrete form but the choice is up to the owner at the time of closure approval. | P1 | Yes (H-C4) |
| H-K13 | SHA-256 vault repositories are not supported; the `'0'×40` CAS sentinel hardcodes SHA-1. The repair-file validator already accepts 40–64 hex. | P2 | No |

### Verified (not open)

| ID | Item | Evidence |
|----|------|----------|
| H-V1 | AI mutation tools treat live History, Diff, and Recovery workspace contexts as read-only and deny mutation of the protected path through `deriveToolSafetyPolicy` in [`server/ai/tool-safety.ts`](../../../server/ai/tool-safety.ts). The exhaustive switch over `ClassifiedToolName` makes unclassified additions to the AI surface a typecheck error; the exhaustive switch over `AiLiveContextSnapshot['kind']` makes unclassified context kinds a typecheck error; unknown / malformed tool inputs fail closed with `{ kind: 'unknown' }` instead of being treated as read-only. | `tool-safety.ts:155-203` (`deriveToolSafetyPolicy` cases `history` / `diff` / `recovery` return `deny-protected-path` with `reason: 'read-only-context'`); tool-safety tests pin the classify + guard behavior; `tools.test` asserts set equality with `TOOL_DEFINITIONS` so a tool added there fails tests until classified. |
| H-V2 | The verification of "Capture every mutable value before the confirmation opens" in Restore relies on the source being captured by `buildRequest({ ...source })` once and not mutated again. The `useHistoryRestore.test.ts > 'captures revision A even if the mutable viewer source changes before confirmation resolves'` test pins this. | `useHistoryRestore.test.ts` (existing test, verified against current `main`). |
