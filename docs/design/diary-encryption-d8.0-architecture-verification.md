# D8.0 — Diary Encryption Architecture Verification

## 1. Status and verification boundary

```text
Starting HEAD          = 1fb1389cab053d5ff72630253f509f0170e588c2
Starting commit        = docs(diary): close D7 mood implementation
D8 overall             = IN PROGRESS
D8.0                   = REVIEW-READY
D8.0 Self-review       = PASS (P0/P1/P2 = 0/0/0)
D8.0 Independent Review = PENDING
D8.1                   = NOT STARTED
D8.2                   = NOT STARTED
D8.3                   = NOT STARTED
D8.4                   = NOT STARTED
D7                     = REVIEW-CLOSED
```

本轮只核验当前实现和后续安全边界，不实现加密、不实现 secondary-password unlock、不修改 schema、不改生产代码、不改测试、不加依赖，也不创建 D8.1 代码。

已核对的既有 D7 canonical documents：

- `docs/design/diary-home-workspace-prd.md`
- `docs/design/diary-home-workspace-implementation-plan.md`
- `docs/design/diary-home-workspace-d6.7-release-closure.md`

它们共同确认：`Calendar does navigation. Vault does documents.` Diary Calendar、Native Vault workspace、History/Recovery、Mood 和 metadata owner 均属于 D7 已关闭边界，D8 只能增加 privacy gate，不得另造 Diary Reader/Editor 或第二套 document lifecycle。

## 2. Repository and vault observations

根项目 `main` 与 `github/main` 在本轮起点均为 `1fb1389...`，工作区洁净。根 `.gitignore` 忽略 `src/content/`，但这只是 Docus 项目仓库不跟踪默认 vault，并不改变 server 对 vault 的读取行为。

当前默认 vault 有自己的 `src/content/.git/`。观察到的 nested vault 状态中，`diary/` 下现有 Markdown 文件是 nested Git 的 untracked files；当前 tracked file list 没有这些 Diary 文件。这是本机当前状态，不是安全保证：nested vault 的 `.gitignore` 没有忽略 `diary/`，用户或其他流程仍可能把 plaintext Diary 加入未来 Git commit。

`data/` 目前存在 SQLite 数据库及其 WAL/SHM 运行文件，也有既有的 `data/.docus-master-key`。该 key 属于 AI provider credential encryption 的现有 server-side 机制；D8 不把它当作 Diary key，不读取或记录其内容。

## 3. Body read/write graph

### 3.1 Primary file and Diary date creation

当前的 managed Diary physical/logical contract 仍由 `shared/diaryProtocol.ts` 和 `server/routes/diary.ts` 共同定义。`POST /api/diary/dates`：

1. 根据严格 `YYYY-MM-DD` 派生 `diary/YYYY-MM-DD`；
2. 读取已存在的 `.md` 文件并通过 SQLite metadata 返回 summary；
3. 对缺失日期生成 `# YYYY-MM-DD\n`；
4. 使用 `prepareAtomicTextCreate()` 把 raw 写入临时文件并提交到正式路径；
5. 写入 SQLite `documents`，再把 raw 交给 LinkIndex。

因此创建路径当前直接把 plaintext body 交给 filesystem temp、正式文件和内存 LinkIndex。D8.2 必须在 durable create 之前加密，并让 LinkIndex/tree/list 走结构化 Diary projection。

### 3.2 Native read, edit and save

主要路径为：

```text
GET /api/posts/:path
  → fs.readFile(abs, 'utf8')
  → gray-matter(raw)
  → PostDetail.raw/content
  → useTabWorkspace.openPost()
  → Tab.raw / Tab.originalRaw
  → ReadingPane / EditorPane / Monaco
```

正文保存路径为：

```text
useDocumentSave.saveLatest()
  → savePost(path, raw, baseRaw)
  → PUT /api/posts/:path
  → readStableTextSnapshot(abs)
  → raw/baseRaw CAS
  → prepareAtomicTextWrite(abs, requestedRaw)
  → prepared.commit(currentRaw)
  → recordCommittedDocumentMutation()
  → LinkIndex.applyWrite(path, requestedRaw)
```

当前 `server/routes/posts.ts` 的 GET、PUT 和 `server/atomicTextWrite.ts` 的 `writeTemporaryTextFile()` 都以 plaintext string 为接口。D8.2 需要一个 Diary-aware adapter：读取时解密到 process memory，CAS 在内存中比较明文，落盘时只把 authenticated ciphertext/envelope bytes 交给 atomic writer。不能只在 HTTP response 层加密，因为那会留下明文 temp、staging、History 和 index。

### 3.3 Recovery, rename and delete

- `PUT /api/recover/*` 当前接收 plaintext `raw`，通过 `prepareAtomicTextCreate()` 创建文件并更新 metadata/LinkIndex；Diary recovery 也必须走加密 adapter，或在 adapter 未覆盖时明确 fail closed。
- `PATCH /api/posts/*` 当前读取 source raw，并可重写 backlink reference；它会构造 reference snapshots，经过 `prepareRenameReferenceJournal()` 把 before/after raw 写入 durable payload。managed Diary 不能让这个 generic path 直接持久化 plaintext payload；路径变更需要 identity-bound re-encryption transaction，或者 D8 MVP 对 managed Diary 的 reference rewrite/rename 明确拒绝。
- 删除和 folder move 主要移动/暂存现有 bytes及 metadata snapshot，本身不需要解密，但必须证明移动的是正确 encrypted generation。metadata snapshot 可包含 Mood 等 row，不得携带 body。

## 4. Current persistent plaintext graph

下表区分“当前真实行为”和“D8 必须达到的目标”。“内存”不等于持久化安全；它只说明该通道在当前实现中不是主动写盘的 durable store。

| Channel | Current behavior | Plaintext exposure | D8 disposition |
| --- | --- | --- | --- |
| Primary `diary/YYYY-MM-DD.md` | plaintext UTF-8 Markdown | durable on vault disk | replace with versioned authenticated envelope |
| Atomic save temp / staged generation | `writeTemporaryTextFile()` writes `raw`; replacement/staging are plaintext | durable during transaction and crash windows | pass ciphertext only; journal contains identity/hash, never body |
| Diary create/recovery temp | `prepareAtomicTextCreate()` receives raw | durable until commit/rollback | same encrypted create/recovery seam |
| Nested vault Git working tree/history | `server/history/git.ts` reads/commits bytes at path; current nested `.gitignore` does not ignore `diary/` | durable if Diary is staged/committed | future commits contain ciphertext only; classify existing plaintext history as legacy, no silent purge claim |
| History `/file`, `/diff`, restore | `git.rawAt()` and history routes return raw; client comparison stores `beforeRaw`/`afterRaw` | network/UI memory; current Git source may be plaintext | decrypt only through authorized History adapter; locked/unsupported paths fail closed |
| Rename-reference journals | `prepareRenameReferenceJournal()` writes before/after raw payload files | durable crash-recovery payload | Diary reference payload must be encrypted or forbidden; hashes alone are not a body substitute |
| SQLite `documents` | stores title/summary/tags/timestamps/Mood/id/path, not normal body | durable metadata; some fields may be sensitive | retain single owner; define locked structural projection and metadata privacy policy |
| `metadata_migrations.frontmatter_backup` | migration reads every `.md` and can retain frontmatter backup | durable plaintext metadata; not normally body | Diary migration must classify/clean/protect it; never use it as a body backup |
| Server tree/list/frontmatter | `readFrontmatter()` and `listPostsFlat()` read full file; LinkIndex also scans full raw | process memory; encrypted bytes would be parsed incorrectly | use SQLite structural Diary projection; never parse ciphertext or expose decrypted body to generic scanners |
| Browser IndexedDB `drafts` | `UnsavedDraft.content` stores plaintext | durable across refresh/tabs | disable persistent Diary draft/recovery in MVP, or add same-key encrypted draft adapter before enabling |
| Browser IndexedDB `draftConflicts` | `DraftConflictRecord.content` stores plaintext candidates | durable across refresh/tabs | same as Drafts; no locked recovery discovery for Diary |
| Tab workspace / Monaco | `Tab.raw`, `originalRaw`, Monaco model are memory | process/browser memory while open | allowed only while unlocked; lock clears/disposes Diary models and invalidates late results |
| Client search `bodyCache` | `primeBody()` GETs post content and stores body in module `Map` | browser memory, potentially all posts | exclude locked Diary; unlocked Diary body search must be bounded and clear on lock |
| Server LinkIndex | singleton `Map` stores link arrays/titles after reading raw | server memory, survives requests until process reset | no generic Diary plaintext index; clear any unlocked Diary projection at lock |
| UI diff/confirm | VaultView confirm includes slices of local/external raw; diff/recovery panes render raw | DOM/process memory while visible | allowed only in unlocked authorized surface; no logging/persisted dialog history; lock invalidates surface |
| PDF export / clipboard | explicit user action copies/renders raw; PDF can be downloaded | user-created external persistent copy | require unlocked access; explain it is outside automatic D8 vault storage control |
| Logs/errors | current code logs operation/status messages, not intended body | mostly non-body; future errors are a risk | never include password, key, raw, ciphertext or decrypted body in logs/errors |

The most important finding is that the current atomic protocol is safe for ordinary plaintext CAS but is not an encryption boundary: it deliberately writes the supplied string to `.docus-save-*`, `.docus-staged-*` and recovery/reference payloads. D8 must therefore insert encryption before those APIs, not merely add a UI lock.

## 5. History, Git and compatibility

The vault History implementation is a nested Git repository independent of the root Docus repository. `server/history/git.ts` uses `git show`/`git add`/`commit-tree` style operations; `rawAt()` returns the exact bytes at a ref. `server/history/repo.ts` creates a vault `.gitignore` that ignores Docus runtime/build/log artifacts but currently does not exclude `diary/`.

The safe D8 policy is:

1. after migration, Git sees only encrypted envelope bytes for managed Diary;
2. History comparison/diff/restore remains available only through a Diary-aware adapter that authenticates/decrypts the selected envelope after unlock;
3. if an old revision is plaintext or has an unknown envelope, it is classified as legacy/unsupported and the operation fails closed or returns an explicit metadata/body-unavailable state; it must not mix historical plaintext body with current Mood/metadata;
4. D8 does not rewrite a user's existing Git history automatically. A release document must state whether legacy plaintext remains and what explicit user-controlled purge/backup operation is offered.

This supersedes only the D8 privacy behavior for managed Diary. It does not reopen D7’s already-correct body-only History/Mood compatibility decision.

## 6. Scope, persisted startup and unlock owner

### 6.1 Current scope behavior

`src/composables/vault/useScopeFilter.ts` owns module-level `activeScope: Ref<ScopeKey | null>` and persists `docus.vault.activeScope` in `localStorage`. `toggleScope()` can set the scope back to `null`, and a persisted `diary` value can be loaded before `VaultView` mounts.

`NavBar.vue` reads the same composable above `RouterView`; `FileTree.vue` consumes the scope to filter generic roots; `VaultView.vue` also reads it and has an existing `activeScope.value = null` reveal path. This confirms that D8.1’s lock owner must be shell-level and must replace ad hoc Diary-sensitive writes with explicit safe-scope transitions.

### 6.2 Current tab restore behavior

`useTabPersistence.ts` stores only paths and active path under `docus:tabs:v1:<vaultId>`, but `useEditorTabs.ts` restores each saved path by calling `restoreOneTab()`/`getPost()` during mount. It has no current Diary unlock gate. A saved Diary path can therefore cause a plaintext body fetch before any future D8 lock exists, even if the saved active scope is normalized to `note`.

The D8.1 gate must filter/defer managed Diary paths before any body GET, and must handle a Diary deep-link as an unlock request rather than an immediate `openPost()`. Scope normalization alone is insufficient.

### 6.3 Transactional owner requirement

The target owner is one session state machine, not a boolean in Calendar or VaultView:

```text
DiaryLockSession
  owns: locked/unlocking/unlocked/locking, session epoch, capability
  guards: scope, deep link, tab restore, body read/write, History, Recovery

DiaryCryptoStorage
  owns: KDF/DEK unwrap, envelope encrypt/decrypt, identity/CAS proof
  receives: current session capability
```

All body operations capture the session epoch. Lock/logout/expiry prevents a stale completion from returning/rendering plaintext or committing a post-lock mutation. A failed unlock must not change scope, restore tabs, or populate caches.

## 7. Crypto/runtime inventory

The repository already has:

- Node `crypto.scrypt` with bounded parameters and parsing in `server/auth/password.ts`;
- AES-256-GCM, random 12-byte IV and auth-tag verification in `server/ai/keyEncryption.ts`;
- browser Web Crypto usage for draft hashing;
- no existing Diary encryption module and no encryption dependency in `package.json`.

These are implementation resources, not an authorization to reuse secrets. D8.1/D8.2 must define a separate versioned Diary key namespace, separate salts/context, key zeroization/retention policy and bounded failure behavior. The existing AI master key is persistent host configuration and is specifically excluded from the Diary session key hierarchy.

Required negative behavior: malformed KDF parameters, unknown envelope version, wrong password/key, nonce/tag failure, identity/path binding mismatch and oversized resource must fail closed without body mutation or plaintext error output.

## 8. Migration and schema decisions required before implementation

The current live SQLite schema has `documents.mood TEXT NULL`, stable document identity/version fields and `metadata_migrations` rows. D8.0 selects SQLite-owned metadata as the direction, but does not add columns or migrations.

Before D8.1/D8.2 implementation, the plan must answer:

- where the wrapped DEK, KDF parameters, envelope version and verifier live without putting the password or unwrapped key in SQLite;
- whether title/summary/tags remain available while locked, become a minimal date-only projection, or receive their own authenticated metadata envelope;
- how `metadata_migrations.frontmatter_backup` is handled for managed Diary;
- how existing plaintext files, untracked/tracked Git history, IndexedDB Drafts and conflict candidates are presented and migrated;
- whether managed Diary rename/move is disallowed or implemented as a transaction that rebinds/re-encrypts the envelope;
- how password change/rekey and backup/restore are supported without partial mixed state.

No answer may be inferred by silently reusing the AI key or by retaining a plaintext fallback.

## 9. STOP conditions and D8.0 determination

### Conditions found in the current pre-D8 implementation

The audit confirms existing plaintext body channels listed in §4. This is expected precondition evidence, not a production regression: D8.0 is the phase that identifies them before any encryption work. They block D8.1/D8.2 from claiming privacy until each has an owner and passing proof.

### No D8.0 architecture impossibility declared

The current system has identifiable adapter seams: route body reads/writes, Diary create/recovery, atomic ciphertext commit, Git byte storage, SQLite structural metadata, and shell-level scope/tab gating. Therefore D8.0 is `REVIEW-READY`, not `BLOCKED`.

It must become `BLOCKED` before implementation if the selected deployment threat model requires client-only decryption while the team cannot replace server plaintext scans/History/Draft paths, or if a transaction cannot prevent plaintext from reaching durable temp/journal/payload files. D8.0 does not waive those future gates.

## 10. Evidence and review record

Evidence sources are direct source inspection at the exact baseline, including:

- `server/routes/diary.ts`, `server/routes/posts.ts`, `server/tree.ts`, `server/documentMetadata.ts`, `server/metadataMigration.ts`;
- `server/atomicTextWrite.ts`, `server/renameReferenceJournal.ts`, `server/history/git.ts`, `server/history/routes.ts`, `server/history/repo.ts`, `server/linkIndex.ts`;
- `src/composables/vault/editor-tabs/useTabWorkspace.ts`, `useDocumentSave.ts`, `useEditorTabs.ts`, `useTabPersistence.ts`;
- `src/composables/vault/draft-recovery/draftStore.ts`, `draftTypes.ts`, `useUnsavedDraftPersistence.ts`, `useUnsavedDraftRecovery.ts`;
- `src/composables/vault/useScopeFilter.ts`, `src/App.vue`, `src/views/VaultView.vue`, `src/lib/search.ts`, `src/components/vault/monacoModelRegistry.ts` and the Native workspace panes.

No new characterization test was necessary for D8.0: the current behaviors are directly visible in the source graph and existing D7 test suites already establish the non-encryption lifecycle owners. D8.1 may add characterization tests for locked startup/tab restore before changing that behavior.

Self-review result:

```text
Current body read/write graph       PASS
Durable plaintext inventory         PASS
Git/History/Draft/Recovery audit    PASS
Search/LinkIndex/temp/log audit     PASS
Scope/startup/tab restore audit     PASS
Crypto runtime inventory            PASS
Migration and compatibility policy PASS
Mood/date/metadata separation      PASS
D7 boundary preservation            PASS
Production implementation started  NO
D8.1 started                        NO

D8.0 Self-review P0/P1/P2          0/0/0
D8.0 Independent Review             PENDING
```

## 11. Final lifecycle for this evidence commit

```text
D7.0A–D7.6       = REVIEW-CLOSED
D8 overall        = IN PROGRESS
D8.0              = REVIEW-READY
D8.0 Self-review  = PASS (0/0/0)
D8.0 Independent Review = PENDING

D8.1              = NOT STARTED
D8.2              = NOT STARTED
D8.3              = NOT STARTED
D8.4              = NOT STARTED

D8 Mood encryption production = NOT STARTED
```

本文件记录的是 D8.0 architecture/security verification，而非 D8.1 implementation authorization。Independent Review 通过之前不要进入 D8.1。
