# Docus Edit Program — Final Closure

**Date:** 2026-07-22
**Stage:** Docus Edit Program — Final Closure (NOT an Edit; no Edit-11)
**Status:** Reopened on 2026-07-22 after cross-Edit production review.

**Former program closure baseline:** `350b17713b6df53b97787416c3f3979c33a04955` (`docs(ai): re-close Edit-10 after residual race verification`)

The closure assertions below are retained as the historical record of the attempted seal. They are not a current release declaration. Production fixes after that baseline, including `c13d086` and the transaction-compensation work that follows it, require a fresh closure run and new evidence.

**Former attempted production/test baseline:** `08756eb173538196d7ebe2426de32dfc6238127a` (`test(closure): add Edit program cross-feature regression matrix`)

**Current closure commit:** not assigned while status is Reopened.

---

## 1. Program scope

**Covered:** every Edit stage of the Edit Program — Edit-01 through Edit-10 — and, decisively, the SEAMS between them: what happens when their contracts run together in one real user session.

- Editing, saving, autosave, and the optimistic-concurrency write path (Edit-02..06)
- Document lifecycle: create / rename / move / delete / folders, backlink rewriting (Edit-03)
- Workspace tab architecture and authority (Edit-07/08)
- Draft Store + unsaved Recovery (Edit-09)
- AI live workspace context + tool safety (Edit-10)
- History / Diff read-only surfaces over the same documents
- External conflict handling (both user choices), refresh/reopen survival, multi-tab authority

**Not covered (product features outside the program):** RAG, selection context, direct Monaco AI editing, tool approval UI, release packaging, publishing, sync. These require new independent plans with new names; nothing may be appended to the sealed Edit Program.

**Program Closure vs Release Readiness:** Program Closure proves the Edit Program's contracts hold together with no production blockers. It is NOT a release audit (no packaging, distribution, or third-party-compatibility evaluation). docus is self-use with AI intentionally always on; closure is the terminal state of this program, not a release candidate gate.

## 2. Edit Inventory

| Edit | Title | Production SHA | Closure SHA | Status |
| ---- | ----- | -------------- | ----------- | ------ |
| Edit-01 | 保存链路架构审计与状态所有权梳理 (save-pipeline audit; docs-only) | `427e564` | frozen-by-baseline `9afb4e1` | Closed |
| Edit-02 | editor-save 事件隔离 (event isolation; no newRaw, source markers) | `22c1129` + `d3c8475` / `cb4ba0f` / `7a21af3` | frozen-by-baseline `9afb4e1` | Closed |
| Edit-03 | Document lifecycle management (rename/move/delete, folders) | `7099425..04deb6a` | frozen-by-baseline `9afb4e1` | Closed |
| Edit-04 | 文档保存状态管理重构 (save-state management, status bar) | `f9658c3` | frozen-by-baseline `9afb4e1` | Closed |
| Edit-05 | Document save + workspace post summary | `031b2e0` | frozen-by-baseline `9afb4e1` | Closed |
| Edit-06 | 乐观并发保存与原子文件写入 (write locks, atomic writes, baseRaw CAS) | `a325a82..476a2b6` | frozen-by-baseline `9afb4e1` | Closed |
| Edit-07 | Workspace tab UX (tooltip + save presentation unification) | `ba52905..9afb4e1` | `9f8c0ae` | Closed |
| Edit-08 | Workspace tab architecture | `33bd621` | `f094456` | Closed |
| Edit-09 | Unsaved Draft Recovery (Draft Store, Recovery, management) | freeze `13a43ab` | `284d69f` | Closed |
| Edit-10 | AI live workspace context + tool safety | freeze `6ae3b77` | `350b177` | Reopened |

The SHAs above are historical closure evidence. Edit-02..06 carry no separate closure commits — their contracts were sealed by the Edit-07/08 baseline `9afb4e1` and re-asserted by the former cross-Edit matrix. The Edit-10 design spec still records its historical §17 closure at `350b177`; this program-level review supersedes that status for current release decisions until both documents receive fresh, consistent closure evidence.

## 3. Frozen production tree

- Edit-01..06 frozen-by-baseline: `9afb4e1`
- Edit-07 closed: `9f8c0ae`; Edit-08 closed: `f094456`
- Edit-09 production freeze: `13a43ab` — closure matrix: `284d69f`
- Edit-10 production freeze: `6ae3b77` — closure: first `b772be7` + `a84d4fa`, E2E-order fix `82912f6`, re-close `350b177`
- Former program production/test tree: `08756eb` — historical tests/E2E/helpers baseline only. It predates subsequent production fixes and is not the current tree. The former command included test files and therefore did not prove an empty production diff; future closure evidence must explicitly exclude `src/**/__tests__/**` and `server/__tests__/**`.
- Current docs closure SHA: not assigned while status is Reopened.

Production code has changed since the attempted seal. A new production baseline and fresh verification run are required before reclosure.

## 4. Global invariants

The unified program contract, each item evidenced in §5/§6/§8:

1. **documentId is identity; path is location.** rename/move preserve documentId; a reused path NEVER inherits the old identity; History/Recovery/AI/Draft/metadata never key on path alone; async results are checked against the identity they started from. (T1/T2 of `edit-program-closure.test.ts`; `documentMetadata.test.ts`; `tools.test.ts` identity-mismatch; draft-store E2E-8.)
2. **Workspace authority comes only from the real active workspace.** Not from routes, stale tabs, module singletons, server disk bodies, or background panes. (No `_liveTabs` singleton exists — verified by grep; E2E-7 recovery-beats-route; E2E-8 capture-then-switch; `useWorkspaceTabFocus.test.ts`.)
3. **Dirty buffers are never silently overwritten.** Every conflict preserves the local body, enters an explicit external/recovery state, and waits for a user decision — no auto-merge, no auto-discard. (`useDocumentSave.test.ts` external family; Long Flow A P2; Long Flow B; residual-race spec.)
4. **Draft/Recovery integrity.** No early deletion, no wrong-identity binding, cleanup ONLY on successful save (or explicit user discard), no hidden disk-side leak, never mutated by History/Diff/AI. (`useDocumentSave.drafts.test.ts`; `useUnsavedDraftPersistence.test.ts`; `draftCleanup.test.ts`; Long Flow A P1/P2.)
5. **History/Diff are read-only.** Explicit revision identity; the Diff after-side uses the live editor's correct documentId; they never pollute save state and never become a mutation target. (E2E-3/4; Long Flow A P3 — zero PUTs while the panes were open; `useHistory*.test.ts`.)
6. **File transactions.** rename/move/delete keep id/metadata/Draft-Recovery links, rewrite backlinks correctly (or fail closed), leave no partial side effects on failure, use stable lock order; AI rename executes exactly the locked = guarded plan. (`renameReferences.test.ts`; `documentWriteLock.test.ts`; `pathMutationLock.test.ts`; `tools.test.ts` rename + protected-path family; Long Flow A P4.)
7. **Async binding at initiation.** Results bind to the documentId/path/revision/tab/recoveryId/snapshot captured at start and are never applied to switched or replaced state. (`useDocumentSave.test.ts` stale-confirm family; `useUnsavedDraftRecovery.test.ts`; `fileChanges.test.ts`.)
8. **Security fail-closed.** Traversal/absolute/backslash/NUL/unknown kind/unknown tool all fail closed; malformed liveContext has no fallback; blocked mutations have zero side effects; sensitive raw never enters errors, logs, URLs, Toast, or persistence. (§9 below; `live-context.test.ts`; `tool-safety.test.ts`; `tools.test.ts` zero-side-effect family; console sentinels in T1/T2.)

## 5. Cross-Edit Matrix

| Journey | Edits involved | Exact test(s) | Result |
| ------- | -------------- | ------------- | ------ |
| Normal edit/save/reload | 02,04,05,06 | `useDocumentSave.test.ts` › `sends the immutable originalRaw baseline…`; `put.test.ts`; `get-post.test.ts`; Long Flow A P1 (byte-exact reload, id stable, no stray Draft) | Pass |
| Dirty close/recovery | 09 | `useUnsavedDraftRecovery.test.ts`; `useUnsavedDraftPersistence.test.ts`; `draft-store.spec.ts` E2E-1/2/5/7/9/10; Long Flow A P1/P2 | Pass |
| External conflict / local choice | 04,06,10 | `useDocumentSave.test.ts` › `enters external without advancing or publishing on a typed 409` / `keeps external while editing and blocks queued and manual saves`; `StatusBar.test.ts` › `preserves all external-conflict actions`; `ai-live-context.spec.ts` E2E-10; Long Flow B (keep local → save) | Pass |
| External conflict / server choice | 04,06,09 | `useDocumentSave.test.ts` › `converges dirty tab to clean when user accepts AI overwrite`; `draft-store.spec.ts` E2E-2; Long Flow A P2 › Use Disk Version (explicit, draft cleaned, no merge) | Pass |
| History/Diff/live editor | 03,06,07,08 | `history-git.test.ts`; `history-routes.test.ts`; `history-diff.test.ts`; `useHistory*.test.ts`; `HistorySnapshotPane/ComparisonPane.test.ts`; E2E-3/4; Long Flow A P3 (read-only, 0 PUTs, buffer untouched) | Pass |
| Rename/identity/backlinks | 03,06 | `renameReferences.test.ts`; `documentMetadata.test.ts` › `moves and deletes metadata with related rows`; `links-api.test.ts`; `tools.test.ts` rename family; E2E-9; Long Flow A P4 (id stable, refs rewritten, old path dead) | Pass |
| Multi-tab authority | 08,10 | `useDocumentSave.test.ts` › `dispose isolates a pending PUT completion…` / `keeps debounce timers independent across tabs`; E2E-2 / E2E-8; Long Flow B steps 1/7/8 | Pass |
| AI full chain (7 active kinds) | 10 | `live-context.test.ts`; `tool-safety.test.ts`; `tools.test.ts`; `chat.test.ts`; `edit10-final-closure.test.ts`; `ai-live-context.spec.ts` E2E-1..10; `ai-live-context-final-closure.spec.ts`; Long Flow B | Pass |
| Delete/path reuse/stale response | 03,06,09,10 | `edit-program-closure.test.ts` T1; `draft-store.spec.ts` E2E-8 + reuse-closure tests; `useUnsavedDraftRecovery.test.ts` › `maps 404, read failures, and reused paths to safe decisions`; `tools.test.ts` › `blocks with identity-mismatch … even with identical raw` | Pass |
| Long Flow A | 02–10 | `edit-program-long-flows.spec.ts` › `Long Flow A — Recovery → History/Diff → Rename across one document life` | Pass ×4 |
| Long Flow B | 04,06,08,09,10 | `edit-program-long-flows.spec.ts` › `Long Flow B — AI live context, external conflict, and multi-tab authority in one chain` | Pass ×4 |

## 6. Long-flow evidence

**Spec:** `e2e/edit-program-long-flows.spec.ts` — real VaultView, real Monaco, real Draft Store (IndexedDB), real embedded server REST, real file-change handling, real routing. No real Anthropic round-trip (`/api/ai/**` intercepted at the browser layer, the sealed harness pattern); no test-only HTTP route; no `waitForTimeout` anywhere; every step gated on a network or DOM condition; per-run unique slugs; all created files + drafts cleaned; git status clean after.

- **Long Flow A — Recovery / History / Rename** (5 phases): create + ref doc with backlink → save rev B → crash-window dirty C → refresh → baseline-match Recovery silently adopts C (keep-C path) → next edit lands the save, draft cleaned exactly on success → dirty D + external disk change → refresh → divergent prompt → View Diff shows both sides → Open Recovered Content → explicit Use Disk Version → draft discarded, buffer = disk, nothing merged → History rev A → snapshot → Diff A-vs-live → Close Diff (0 PUTs, buffer untouched, no confirm) → rename (documentId preserved, bytes travel, old path 404, backlink rewritten to the canonical root-relative form) → refresh → reopen (body/identity intact, no stale Recovery, timeline re-pinned under the new path with a distinct pin subject proving the post-rename timeline served).
- **Long Flow B — AI / External / Multi-tab** (9 steps): A dirty (held save) + B clean → Send on B (clean snapshot, B's identity only) → type on B while the AI turn is gated open → REAL same-path CAS mutation via APIRequestContext (bypasses page.route; succeeds because disk still equals the send-time snapshot) → held autosave released → REAL 409 → B external → SSE file_changed through the real client chain → overwrite confirm once → Cancel keeps local → switch to A, Send (A's dirty identity; wire contains no B path/body) → back to B, explicit "keep local" → save → refresh → B clean + consistent, A's unsaved buffer re-adopted, drafts correct.

**Runs:** 4 consecutive passes, 0 retries (`playwright.config.ts` retries=0), per-run durations ~17–27 s for the pair. Non-vacuity: the cross-Edit server suite's central claims were mutation-checked RED before this round (inverted identity and deny-code assertions both fail); the long flows fail closed on ordering violations (overwritten buffer, missed 409, missed confirm each break a dedicated assertion).

**Interlock:** the browser-level race chain (Long Flow B / residual-race spec) and the server-level chain (`edit10-final-closure.test.ts`, `edit-program-closure.test.ts` T1) meet on the same `file_changed` descriptor shape and the same CAS write path.

## 7. Data integrity

| Store | Verification | Result |
| ----- | ------------ | ------ |
| Markdown (files) | `atomicTextWrite.test.ts` (CAS + staging), `put.test.ts` / `get-post.test.ts` byte-exact round-trip, Long Flow A byte-exact reloads, T1/T2 disk assertions | Pass |
| SQLite `documents` | `documentMetadata.test.ts` (identity stable across update; move/delete with related rows), `metadata-api.test.ts`, `metadataMigration.test.ts`; blocked AI verification creates NO row (`tools.test.ts` › `blocks with unverifiable when the file exists but has NO documents row — and creates none`); T1 row deleted on delete, minted fresh on reuse | Pass |
| `document_tags` | `documentMetadata.test.ts` › `moves and deletes metadata with related rows` (FK cascade), `patch-archive.test.ts`; blocked operations leave tags untouched (`tools.test.ts` › `a blocked stale mutation leaves the metadata row, tags, and updatedAt untouched`) | Pass |
| Draft Store (IndexedDB) | `draftStore.characterization.test.ts`, `draftKey/draftHash.test.ts`, `useUnsavedDraftPersistence.test.ts`, real-IDB `draft-store.spec.ts` (33 tests); cleanup only on acknowledged save / explicit discard; Long Flow A draft-count probes (count only — draft bodies never leave the browser) | Pass |
| Recovery records | `draftRecoveryDecision.test.ts`, `useUnsavedDraftRecovery.test.ts`, `useDraftRecoveryOperationProtection/Management.test.ts`, `DraftRecoveryPrompt/Pane/Center.test.ts`, `draftCleanup.test.ts` (30-day identity-mismatch expiry only; protected identities never selected); draft-store E2E-1/2/5/7/10 | Pass |
| History (git) | `history-git/routes/diff.test.ts`, `useHistory*.test.ts`; hash-CAS Create-Version (409 on stale selection); per-path timelines with pre-rename revisions retrievable at the old path (T2; deliberate no-`--follow`, `git.ts:273`); Long Flow A P3/P5 | Pass |
| AI `sessions` / `messages` | `ai-sessions.test.ts`, `ai-messages.test.ts`, `chat.test.ts`: only user content + assistant text persisted; liveContext exists exactly once in production as the in-memory prompt (`chat.ts:152`), never in DB/SSE; T1 sentinels through real `runChat` never reach logs (console spies) | Pass |
| Link index | `linkIndex.test.ts`, `links-api.test.ts`, `useLinkIndex.test.ts`, `renameReferences.test.ts`; `updateReferences=false` leaves refs alone (T2 PATCH); confirm-gated rewrite on impact>0 (Long Flow A P4); AI rename rewrites only via the guarded plan (`tools.test.ts`) | Pass |

## 8. Concurrency audit

| Race | Expected | Covering test | Result |
| ---- | -------- | ------------- | ------ |
| Save A in flight, switch to B | A's result lands on A only | `useDocumentSave.test.ts` › `dispose isolates a pending PUT completion…` / `dispose isolates a pending conflict response from the old Workspace`; Long Flow B | Covered/Pass |
| Save A in flight, rename A | converge by identity or fail closed | `useDocumentSave.test.ts` › `ignores stale write confirm on old path when a rename supersedes it while confirm is pending` / `applies lifecycle reference writes before releasing the save barrier`; `pathMutationLock.test.ts`; `documentWriteLock.test.ts` | Covered/Pass |
| Save A in flight, delete A | deleted file not recreated | `useDocumentSave.test.ts` › `ignores stale write confirm when a delete arrives while confirm is pending` / `rollback resumes a dirty queued save while commit does not resume a deleted path`; `tools.test.ts` › `write_file must NOT recreate it` | Covered/Pass |
| Dirty A, external write to A | local preserved, external state | `useDocumentSave.test.ts` external/poll family; `StatusBar.test.ts`; E2E-10; Long Flow B | Covered/Pass |
| Clean Send → post-send dirty → AI writes A | local preserved, external, user decides | `ai-live-context-final-closure.spec.ts`; `edit10-final-closure.test.ts`; `useDocumentSave.test.ts` › `preserves user edits when confirm resolves after local typing`; Long Flow B | Covered/Pass |
| Recovery A active, route points at B | Recovery A has authority | E2E-7 `recovery beats the route`; `useUnsavedDraftRecovery.test.ts` › `fails closed when the recovery target changed or is unsafe`; draft-store E2E-9 | Covered/Pass |
| History A active, A renamed | revision identity not misplaced | `edit-program-closure.test.ts` T2; Long Flow A P3→P5 (distinct post-rename pin subject); `useDocumentSave.test.ts` stale-confirm-on-old-path | Covered/Pass |
| Rename backlink set changes mid-flight | retryable fail-closed or stable plan | `tools.test.ts` › `blocks an unrelated rename whose reference rewrite would modify the dirty protected document` / `verify-clean: blocks with stale when the protected backlink document changed after the snapshot`; `renameReferences.test.ts`; `documentFileLifecycle.test.ts` (rollback AggregateError) | Covered/Pass |
| Old path deleted then reused | documentId mismatch everywhere | `edit-program-closure.test.ts` T1; `draft-store.spec.ts` E2E-8 + reuse-closure tests; `useUnsavedDraftRecovery.test.ts` › reused-path decisions | Covered/Pass |
| Tab closed while save/cleanup incomplete | Draft not deleted early | `useDocumentSave.drafts.test.ts` › `keeps drafts after save failure and external conflict` / `deletes the owned draft after the acknowledged revision stays clean`; `useUnsavedDraftPersistence.test.ts` › `isolates a reopened document from work owned by the closed tab`; `workspaceClose.test.ts` | Covered/Pass |
| Draft write during refresh | no corrupt/duplicate Recovery | `useUnsavedDraftPersistence.test.ts` › `does not let an old pending write recreate a discarded draft` / `markClean waits for an in-flight draft write and deletes the exact result` / `registers one pagehide listener and removes it on dispose`; `draft-store.spec.ts` E2E-10 (blocked upgrade preserves records) | Covered/Pass |

No uncovered high-risk race. All eleven rows are linked to real tests; all pass.

## 9. Security and privacy audit

Grep results (production = `src/` + `server/`; test hits listed where they are NEGATIVE evidence):

- `_liveTabs`: ABSENT as code (one historical comment in `useLinkIndex.ts:14`); the module-singleton workspace authority design was never built — no stale authority source.
- `currentNoteContent`: absent from production code; only parser-door comments (`server/ai/live-context.ts`) and negative test assertions. The strict parser is the only door.
- `currentNotePath`: production hits are the scoped LEGACY compatibility path only (`server/ai/routes.ts` → `{kind:'legacy-path'}`), a path-only read hint ("do not assume the file's text is in this prompt"), never content, never identity for mutations (`tool-safety.test.ts` legacy policy).
- `console.*raw` / `console.*liveContext` / `console.*draft`: ZERO production hits. The cross-Edit server suite additionally spies on console and fails if any sentinel body reaches a log.
- `expectedRaw`: in-memory policy field only (`server/ai/tool-safety.ts`), never in errors/prompts/logs (`chat.test.ts` asserts the prompt does not contain it).
- `localStorage`: UI preferences and paths only (theme, view mode, expanded paths, Monaco view state, recent link targets, tab restore `docus:tabs:v1` = paths, scope filter, layout) — never bodies, drafts, externalRaw, or liveContext. `sessionStorage`: zero hits.
- `JSON.stringify(liveContext)`: exactly one production site — `server/ai/chat.ts:152`, the current-turn prompt assembly (in-memory, sent to the model, not persisted, not SSE-broadcast).
- `ensureDocumentMetadata` in `server/ai`: runs ONLY inside the executors AFTER the guard (`tools.ts:717`); the verification path mints nothing (T1: blocked verification leaves the DB untouched).
- Test seams (`__set*ForTesting` / `__reset*ForTesting` / "test-only"): all null/reset-by-default DI escape hatches; no `process.env.*TEST` gate exists anywhere; no user request can enable them; no test-only HTTP route exists (the only `route.fulfill` sites are the browser-layer interceptors in `e2e/helpers/edit-program.ts`).
- `waitForTimeout`: zero in this round's specs; the only two sites are sealed Edit-09 negative-evidence windows in `draft-store.spec.ts` (a 1200 ms "let the pending aborted autosave fire" window and a 400 ms "between wrongful Ctrl+S and the 800 ms debounce" window — both assert something does NOT happen; neither sequences a flow).
- only/skip: none (`fit()` grep hits are `MarkMap.vue` comment prose).
- Manual confirmations: errors carry logical paths only (no absolute paths, no bodies); unknown tool / unknown context kind fail closed (`tools.test.ts`, `live-context.test.ts`); prompt delimiter hardening holds (`edit10-final-closure.test.ts` §9 verbatim payload — exactly one delimiter pair); path validators consistent (`paths.test.ts`, `tool-safety.test.ts` protected-path spelling variants); blocked operations emit zero `file_changed` descriptors and zero disk/DB writes.

## 10. Accepted residual risks

Real risks that cannot be fully eliminated at this architecture's boundaries (none is a fixed-bug relabel):

1. **External processes do not honor in-process locks.** `documentWriteLock`/`pathMutationLock` serialize within the app; an outside editor can still change a file mid-operation — surfaced and contained as the external-conflict / 409 / file_changed paths (proven by Long Flow B and the external families).
2. **A crash can land inside a multi-file compensating transaction** (rename reference-rewrite rollback; staged `.docus-delete-*` files). The staged-file scheme and identity-based draft retention make the outcome recoverable, not silently lossy. (The ordinary-save commit path and folder rename are no longer in this class: both are journaled and completed by startup crash recovery — see §11.)
3. **Browser/OS force-quit can land outside an IndexedDB transaction boundary.** The Draft Store's generation/CAS design plus quarantine-retry certification converges on next boot (`draft-store.spec.ts` E2E-5/7/10).
4. **The Edit-10.4 accepted residual race** — send-time clean → same-path mutation while the buffer is dirty post-send — is allowed by the verify-clean policy by design; its terminal state is proven safe (local preserved, server = AI write, explicit external state, user decides, no lost input) in the real browser by `ai-live-context-final-closure.spec.ts` and Long Flow B.
5. **Old clients without live identity** currently derive the `unrestricted` policy for compatibility. They do not receive dirty-document, read-only-view, `documentId`, `expectedRaw`, or external-conflict protection. This is an explicitly accepted compatibility boundary, not fail-closed behavior.

## 11. Known issues

- **Known production blockers:** the identified Archive, rename-registration, and metadata-compensation defects now have production fixes and unit/integration regression coverage. A follow-up review round additionally fixed: vault membership mutations (file/folder create, delete, rename/move, recovery create, AI create/write-as-create/delete/rename) now serialize behind a reserved vault structure lock with a fixed acquisition order (structure → sorted document paths), closing the P0 where folder lifecycle transactions could swallow a concurrently created child; POST create, recovery create, and AI create_file now commit through create-only `link(2)` with a `committed` ownership flag, so an external writer landing in the check-to-commit window is reported as a conflict and never overwritten or deleted (recovery no longer removes a byte-identical external file on EEXIST). A further review round additionally fixed: (1) the lock table now keys the two lock classes in separate namespaces — the structure lock under a reserved internal key, every document lock under `document:<path>` — so no user-supplied path, valid or not, can collide with the structure lock; previously an AI tool call whose unnormalizable path spelled the reserved structure-lock string self-deadlocked (the inner document lock queued on the same key the outer structure lock held) and jammed every later membership operation behind the stuck lock — the regression tests require all five mutation tools to return immediate invalid-path errors and never hang; (2) the REST single-file rename now builds ONE authoritative in-lock backlink plan — the verified candidate set and the executed reference-write set come from a single enumeration, and the link index is never re-queried for the write set — closing the TOCTOU where a concurrent body PUT (document lock only, never the structure lock) could add a link to the rename source between the footprint check and the reference writes and have that file rewritten without its lock ever being held (locked set = written set again; a link landing after the check is left untouched, drift seen by the check still fails closed with a retry). A fourth review round additionally fixed the external-write-safety boundary (in-process locks do not stop Obsidian/vim/sync software): (1) the final check-to-rename window in the file CAS is closed — `prepareAtomicTextWrite`'s commit (the PUT save path) and `atomicReplaceTextIfUnchanged` (Archive cleanup, AI write/patch, and every rename reference write and rollback) now run an ownership protocol: atomically take the current generation aside to a private staging path FIRST, verify the staged bytes against the caller's expectation, then commit the new file create-only via `link(2)`; an external writer landing before the takeover is detected at verification, one recreating the path afterwards loses to the create-only commit — in every interleaving the external bytes are preserved and the operation fails closed with a typed 409 `EDIT_CONFLICT` (or 404 if the target was deleted), never a silent overwrite, and no check-to-rename window remains; rollbacks are equally strict — an undo rewrites only bytes still exactly equal to what the operation wrote, so an external save on top of our write wins; (2) REST document rename, REST folder rename, and AI `rename_file` reference writes and their rollbacks all go through that helper — an external save to a reference file between the plan snapshot and the write loop fails the whole rename closed (409, fully undone) instead of being overwritten; (3) delete rollbacks now honor the path-reuse identity contract — when a failed delete's rollback finds the path re-occupied by a NEW external generation, the old documentId is never restored onto foreign bytes: the stale identity is dropped, the new file gets a fresh identity on its next API touch, and the old generation stays quarantined under its `.docus-delete-*` staging name (empty paths still restore the old file create-only via `link(2)` together with the old identity); this applies to REST document delete, REST folder delete (prefix identity), and AI `delete_file`. The same round also settled the open backlink contract choice as SNAPSHOT SEMANTICS: links added after a rename's in-lock footprint check are NOT part of that rename — a rename never writes a document whose lock it does not hold, so a late link is left untouched (its author sees the post-rename world on the next load), while drift seen BY the check still fails closed with a retry; the alternative (a link-graph mutation lock held from plan verification to rename completion) was rejected because it would serialize all document saves against renames. Each fix carries mutation-verified regression tests. Closure remains reopened until the fresh closure/E2E evidence is run and both closure documents are reconciled; this paragraph is not a new seal.
- A fifth review round additionally fixed crash atomicity and external-rename safety: (1) the ordinary-save commit is now crash-atomic end to end — a durable sidecar journal (`.docus-journal-*`, created O_EXCL, written, fsynced and closed BEFORE the takeover, removed only AFTER the new generation is committed) records operation, paths and content hashes only (never bodies), and server startup runs `recoverInterruptedOperations` BEFORE the HTTP listener accepts requests in both prod and dev, so a kill -9 / crash / power loss between takeover and commit can never leave a note visibly missing with hidden staging files — verified by real subprocess crash tests in which the child SIGKILLs itself inside the commit window and inside the rename link window, the restarted server auto-recovers the formal path, and the documentId is never lost; (2) file rename is create-only — the source is taken aside to private staging and committed to the destination via `link(2)`, so an external writer (Obsidian/vim/sync ignore in-process locks) that claims the destination after the route's exists check fails the rename closed with a typed 409 and both files preserved, never a POSIX-rename overwrite; folder rename gates on `mkdir` (EEXIST/ENOTDIR fails closed; the single atomic rename only ever replaces our own empty gate directory, and rmdir proves ownership if external content lands inside the gate before the rename); (3) rename rollbacks are equally create-only — if an external writer re-uses the source path while a failing rename is being undone, the rollback fails closed instead of overwriting the external file: the document stays at the new path and its documentId follows the bytes (REST rename, REST folder rename, AI rename_file); folder rename also writes a durable folder-rename journal before the move so a crash between the tree move and the metadata move is completed at startup, and journal-less `.docus-rename-*` staging is resolved by an inode-partner scan that completes the metadata move for forward-move and rollback crashes alike (the metadata move always runs after the file move); (4) folder delete never restores old identities onto external content — the metadata restore is strictly gated on a successful create-only directory restore of the staged tree (if external content claimed the path, stale rows are dropped and the old tree stays quarantined), and a failed delete whose path was re-used now refreshes the process-level link index against the new generation (REST document delete, REST folder delete via subtree re-enumeration, and AI delete_file), replacing the old file's outbound links and title instead of carrying them until restart. Each fix carries mutation-verified regression tests. Closure remains reopened until the fresh closure/E2E evidence is run and both closure documents are reconciled; this paragraph is not a new seal.
- A sixth review round hardened the startup recovery state machine: journal paths are now strict, basename-bound, and vault-contained before any referenced path is touched; ambiguous save recovery preserves every non-stale generation instead of deleting old/replacement bytes when an external third version owns the formal path; file rename has its own durable journal spanning the create-only move through metadata commit, including the post-staging-removal crash window verified by a real SIGKILL subprocess test; recovery runs before the Vault metadata scan in both production and Vite; forward double-path reuse carries an explicit staging/destination disposition so the old identity is never rebound to an external source; and delete staging is split into auto-completable `.docus-delete-inflight-*` versus permanent `.docus-quarantine-reuse-*`. Closure remains reopened; this is review evidence, not a new seal.
- A seventh review round closed the remaining recovery provenance and durability gaps: file/folder rename journals are now bound to the declared source's physical directory and basename (with no-op and cross-parent folder declarations rejected), file-rename replay is gated by the journaled documentId and treats an already-correct destination as idempotently complete, every non-EEXIST file-move failure propagates source-reuse disposition instead of rebinding identity, delete path reuse is durably promoted from `inflight` to permanent quarantine before metadata is reidentified (startup performs the same promotion and conservatively quarantines legacy timestamp artifacts), and journal creation/removal both fsync the parent directory. Closure remains reopened; this is review evidence, not a new seal.
- An eighth review round made every retained recovery state replayable across repeated startups: file-rename journals now predeclare their exact staging name so a crash between takeover and destination link restores the source (verified by a real `SIGKILL` subprocess); ambiguous replace recovery durably transitions its replacement into a permanent quarantine plus a `manual-recovery-required` journal phase; delete path reuse writes an identity-CAS manifest before quarantine promotion so startup can finish detaching only the old documentIds after another crash, while legacy delete artifacts are detached from public paths and retain a permanent identity manifest; and folder-rename replay requires the destination inode to match the journaled source directory generation and never treats an empty directory as gate ownership proof. Closure remains reopened; this is review evidence, not a new seal.
- Non-blocking artifacts:
  - Monaco dev-server "Canceled" unhandled-rejection teardown noise during navigation (third-party teardown noise; present in every sealed round; no user-visible effect).
  - Documentation drift (historical examples, not contracts): `README.md:241` / `README.zh-CN.md:219` and the `2026-06-07-llm-integration.md` plan example still mention the legacy `currentNoteContent` request field, which the server ignores (liveContext is the only content door — enforced by `live-context.test.ts`). Per-round test counts inside the sealed Edit-09/10 specs are snapshots of their closure rounds; current totals live in this document.
- Deferred product improvements: none claimed by this program; anything further starts a new plan with a new name.

## 12. Program verdict

```text
Docus Edit Program: Reopened
Known production blockers: fixes implemented; fresh closure verification pending
```

## 13. Release readiness

```text
Edit Program closure: Reopened; fresh seal pending
Release readiness: Not evaluated
```

Program closure is NOT a release audit. No packaging, distribution, or third-party-compatibility evaluation was performed; docus is self-use, and closure does not assert release fitness.

---

### Former seal checklist (invalidated by reopening)

Complete Edit Inventory ✔ · real production SHAs for every Edit ✔ · real closure SHAs ✔ · all current specs consistent ✔ · superseded specs marked ✔ · no post-closure production fix without reseal (no fix needed) ✔ · all global invariants pass ✔ · all cross-Edit journeys pass ✔ · two real-browser long flows pass ✔ · key long flow ×4 consecutive, 0 retries ✔ · no silent dirty-buffer loss ✔ · no early Draft/Recovery cleanup ✔ · History/Diff read-only with correct identity ✔ · rename/move/delete never misplace identity ✔ · backlinks correct or fail-closed ✔ · path reuse never inherits documentId ✔ · stale async never lands on a new identity ✔ · AI live context + tool safety full chain ✔ · sensitive raw never persisted or leaked ✔ · blocked operations leave no partial side effects ✔ · Edit-09 Draft Store E2E all pass (38/38) ✔ · Edit-10 Final Closure all pass ✔ · full application E2E all pass (22/22) ✔ · no only/skip/retry/timeout masking ✔ · full quality gates pass ✔ · final docs complete ✔ · final workspace clean ✔ · known production blockers: None ✔

**This stop-work declaration is suspended until a fresh closure record verifies the remediation.**
