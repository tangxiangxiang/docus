# D8 — Diary Encryption Implementation Plan

状态：`D8.0 REVIEW-CLOSED`；`D8.0 Self-review = PASS (P0/P1/P2 = 0/0/0)`；`D8.0 Independent Review = PASS (P0/P1/P2 = 0/0/0)`；`D8.1 REVIEW-CLOSED`；`D8.1 Independent Review = PASS (P0/P1/P2 = 0/0/0)`；`D8.2 REVIEW-READY`；`D8.2 Self-review = PASS (P0/P1/P2 = 0/0/0)`；`D8.2 Independent Review = PENDING`。

基线：`1fb1389cab053d5ff72630253f509f0170e588c2`（`docs(diary): close D7 mood implementation`）。D7.0A、D7.0、D7.1、D7.2、D7.3、D7.4、D7.5、D7.6 均保持 `REVIEW-CLOSED`。D8 只从 Diary 加密边界开始，不重开 D7，也不创建独立 Private Vault。

## 1. Stage definition

D8 的目标是给现有 managed Diary 增加一个明确的 secondary-password privacy boundary，同时继续复用 D7 已关闭的 Calendar、Native Vault workspace、DocumentMetadata、tab、route 和 lifecycle owner。

```text
D8.0  Architecture / security-boundary verification
D8.1  Secondary password + Diary session foundation
D8.2  Encrypted Diary body read/write
D8.3  Privacy enforcement across existing lifecycle surfaces
D8.4  Migration, full regression, release and closure
```

本计划没有 D8.5 或其他未定义的后续阶段。D8.0 只完成当前行为取证与实现前约束；不实现加密、不实现解锁、不修改生产代码。

## 2. Product and security boundary

### 2.1 What D8 protects

- D8 生效后，新的 managed Diary body 在 D8 控制的静态磁盘和应用可恢复 durable storage 中只以密文持久化；
- 新的 managed Diary body revisions 完全不进入新的 vault Git commit，无论应用层 representation 是明文还是密文；
- legacy Git history 与 legacy external backups 可能继续包含旧 plaintext；D8 不宣称追溯删除、重写或保护这些 legacy copies；
- 未解锁时不能通过 Calendar、FileTree、route、persisted tabs、History、Recovery 或搜索间接拿到 Diary 正文；
- 解锁后仍使用现有 Native ReadingPane / EditorPane、单一 tab、现有 save/dirty/CAS/History/Recovery seam；
- Mood、日期、Diary 是否存在和稳定 document identity 继续由现有 SQLite DocumentMetadata owner 管理，不把 Mood 复制到正文加密层。

### 2.2 Threat model limits

D8 MVP 保护的是“没有 secondary password 的本地文件/数据库/Git 备份读取者”。它不承诺抵抗已经控制 Docus server 进程、已经解锁的浏览器进程、浏览器开发者工具、用户主动复制/导出内容或操作系统已授权读写进程的攻击。解锁后的正文可以暂时存在于服务端/浏览器内存和 UI DOM 中，这是工作所需的 ephemeral plaintext；它不能被写进新的持久化 plaintext channel。

Primary Docus login password、`DOCUS_MASTER_KEY`、`DOCUS_MASTER_KEY_FILE` 和 `data/.docus-master-key` 都不等同于 Diary secondary password。现有 AI key encryption 是另一项 server-side credential 功能，不能直接复用其持久化密钥或作为 Diary 解锁凭据。

## 3. Frozen D7 contracts

以下 contract 在 D8 中继续有效：

| Contract | D8 policy |
| --- | --- |
| Diary identity | `diary/YYYY-MM-DD.md`，one date = one managed Diary document |
| Calendar ownership | Calendar 只负责日期导航和 Mood presentation；不创建第二套文档生命周期 |
| Native workspace | READ、EDIT、tab、Monaco、save、dirty、external conflict、History、Recovery 继续由 Vault owner 负责 |
| Metadata | SQLite `documents` 是 stable `documentId`、title/summary/tags、`mood`、`updated_at` 的现有 owner |
| Route / activePath | 仍不能因为 metadata 或 scope 自动打开 DOCUMENT；explicit intent 仍是打开条件 |
| FileTree | 继续是 generic tree/exact-context projection，不把 Diary policy 硬编码为 generic tree contract |
| Scope | Diary 是现有 scope 的一部分，但在 D8.1 起只有已建立的 Diary unlock session 才能进入正文可见状态 |
| History / Recovery | 不创建 Diary 专属 dialog/lifecycle；Note History 保持不变；D8 生效后的 managed Diary body 不进入新的 Git History，直到有单独批准的非 Git 加密历史方案；未覆盖时 fail closed |

D7 的 Git-backed Diary History 在旧 contract 下是正确的；D8 只为 managed Diary 引入新的 privacy contract：D8 生效后新的 Diary 正文 revision 无论是明文还是密文，都不得进入新的 vault Git commit。这个有意 supersede D7 Diary body History 的决定不重开 D7；新的非 Git 加密正文历史若需要，必须另行设计、批准并指定 owner。

## 4. Current ownership and plaintext graph

D8.0 取证详情记录在 [D8.0 architecture verification](./diary-encryption-d8.0-architecture-verification.md)。实现计划必须覆盖完整 body graph，而不是只包住 `PUT /api/posts`：

| Area | Current owner / seam | D8 required disposition |
| --- | --- | --- |
| Primary body read | `GET /api/posts/*` → `fs.readFile` → `gray-matter` | 由 Diary storage adapter 读取并认证解密；locked 请求 fail closed |
| Primary body write | `PUT /api/posts/*` → `readStableTextSnapshot` / `prepareAtomicTextWrite` | compare plaintext in memory, pass ciphertext bytes to atomic durable writer |
| Diary create | `POST /api/diary/dates` | create plaintext only in memory, persist encrypted envelope, return plaintext only to authorized unlocked caller |
| Recovery create | `PUT /api/recover/*` | encrypted Diary adapter required; no plaintext recovery payload on disk |
| Rename / folder move | generic document lifecycle and reference rewrite | opaque ciphertext may move only with identity proof; any reference rewrite must decrypt/re-encrypt transactionally or be rejected for managed Diary |
| History | nested vault Git and `/api/history/*` | D8 生效后的 managed Diary body 完全排除在新的 Git commit 之外；现有 legacy plaintext History 只作 legacy exposure 处理，不自动 rewrite/purge；新的 Diary body History 暂停/不可用，直到单独批准的非 Git 加密历史 owner 存在 |
| Draft / Recovery | browser IndexedDB `drafts` / `draftConflicts` | no plaintext managed-Diary body in IndexedDB; MVP may disable persistent Diary draft/recovery until encrypted adapter exists |
| Search | `primeBody()` and module `bodyCache` | exclude locked Diary; after unlock use a bounded, memory-only adapter and clear on lock |
| Link index | server `LinkIndex` reads every `.md` and stores links/title | generic index must not parse ciphertext as Markdown or retain decrypted Diary links after lock |
| Tree/list | `walk`, `readFrontmatter`, `listPostsFlat`, `buildTree` | use an explicit SQLite structural Diary projection; never parse encrypted bytes as frontmatter/body |
| Atomic temp/staging | `.docus-save-*`, `.docus-staged-*`, rename/reference payloads | only ciphertext may reach durable temp/staging/payload APIs; journal metadata may contain hashes/identity, never body |
| UI and export | tab raw, Monaco, ReadingPane, diff/confirm, PDF | ephemeral plaintext only while authorized; lock clears/invalidates Diary views; explicit PDF/clipboard export remains a user-created copy and is outside automatic D8 storage control |

## 5. Recommended target architecture

### 5.1 One logical document, one storage adapter

Keep the logical path and stable identity unchanged. Add one Diary-aware storage adapter below the route/lifecycle layer and above filesystem/Git primitives. The adapter owns:

1. envelope detection and authenticated decrypt on reads;
2. plaintext-to-envelope encryption before any durable write;
3. body hash/CAS comparison in memory;
4. encrypted representation for create, save, recovery and any approved rename/move transaction; enforce managed-Diary exclusion at the History/Git mutation owner rather than storing Diary body revisions in Git;
5. fail-closed behavior for unknown envelope versions, invalid authentication tags, missing identity binding and locked sessions.

The adapter must be the only route into a managed Diary body. A caller must not choose between raw `fs.readFile` and the adapter based on a loose `startsWith('diary/')`; it must use the already normalized logical path and the shared `classifyDiaryPath()` authority.

Generic ordinary Note behavior remains unchanged. Generic structural code may see a Diary path and the SQLite structural projection, but it must never treat encrypted bytes as Markdown.

### 5.2 Key hierarchy and runtime owner

Recommended minimal construction:

- D8.1 creates a random 256-bit Diary data-encryption key (DEK) and wraps it with a key-encryption key (KEK) derived from the secondary password. The wrapped DEK, KDF parameters, salt, format version and verifier metadata are not plaintext body and may live in the existing metadata authority only after a schema/ownership review.
- Use a versioned, bounded KDF. The existing Node `scrypt` implementation is an available vetted building block (`server/auth/password.ts`), but Diary must use its own salt/context and must not reuse the primary auth password hash. Argon2id is an alternative only if the runtime/dependency decision is explicitly approved; D8.0 adds no dependency.
- Use an AEAD such as AES-256-GCM with a fresh random 96-bit nonce per write and a verified 128-bit authentication tag. The envelope must carry an explicit version/algorithm identifier and reject unknown versions before returning body bytes.
- Bind authenticated associated data to the vault identity, stable `documentId`, canonical logical path and envelope version. Any path change therefore must be an explicit re-encryption/identity transaction, never a generic ciphertext move that silently changes the binding.
- `useDiaryLockSession` (name illustrative) is the single client-facing session state owner. A server-side `DiaryCryptoSession`/service is the single crypto/storage capability owner. Calendar, FileTree, VaultView, History and Recovery receive read-only capability/state; they do not hold independent password booleans or keys.
- Password, unwrapped DEK and decrypted body exist only in the current application/server session memory. Do not place them in `localStorage`, `sessionStorage`, IndexedDB, SQLite, Git, URL/query parameters, logs, telemetry or error messages.

This server-side adapter is the minimal direction because the current server already owns file I/O, atomic writes, History, metadata, and recovery. It protects at-rest vault files without replacing the Native workspace. If the deployment threat model requires the server process itself to be unable to decrypt, D8.1 must stop and explicitly select a client-side Web Crypto design; that is a materially larger API/search/history change and is not implicit in this plan.

### 5.3 Envelope and durable representation

The exact wire encoding is a D8.2 implementation decision, but it must satisfy this contract:

```text
versioned envelope
  algorithm = approved AEAD
  key reference / identity binding = stable document identity
  nonce = unique per write
  ciphertext + authentication tag = body bytes only
```

The physical file may retain the logical `.md` path for compatibility, but its bytes must be unambiguously opaque to generic Markdown readers. A plaintext fallback must not be silently accepted after migration. Unknown/newer envelopes fail closed before any body mutation. The encrypted envelope is a file representation only; it is not permission to add managed Diary body revisions to a new vault Git commit.

### 5.4 Metadata and Mood separation

Calendar needs a small structural projection: canonical date/path, existence, stable document identity, and Mood state. D8 does not move Mood into the body envelope and does not save an SVG path or decrypted body in `documents.mood`.

The existing `documents` SQLite row remains the single live metadata owner. Title/summary/tags must be classified as privacy-sensitive metadata during D8.1; if they are not required by the locked Calendar/tree surface, the locked projection must not expose them. Existing `metadata_migrations.frontmatter_backup` is a potential plaintext metadata retention path and must not become a hidden Diary body/metadata backup. D8.4 migration must classify, preserve, encrypt or remove it according to the selected metadata policy before release closure.

## 6. Scope, startup and transactional unlock

The current `activeScope` is a module-level `ScopeKey | null` persisted in `localStorage`, and the current tab persistence stores paths/active path without knowing whether a path is Diary. That is not a sufficient privacy gate. D8.1 must replace the nullable toggle semantics with the following frozen target contract:

```ts
type ScopeKey = 'note' | 'diary' | 'ledger'
activeScope: ScopeKey
```

`activeScope` is always exactly one of `note`, `diary` or `ledger`; `null` and a fourth neutral scope are forbidden. Selecting the already-selected scope is a NO-OP. The public operation is selection (`selectScope(scope)` / `requestScopeChange(scope)`), not toggle/deselection.

D8.1 must establish the lock/session state machine at application-shell scope, above `VaultView` because `NavBar` is also above `RouterView`:

```text
UNINITIALIZED
  ├─ Diary request ─► password setup ─► generate DEK / wrap DEK
  │                                  └─► establish UNLOCKED(sessionEpoch)
  ├─ cancel/setup failure ─► UNINITIALIZED
  └─ no scope change, no migration

LOCKED
  ├─ unlock request ─► UNLOCKING ─► UNLOCKED(sessionEpoch)
  ├─ invalid password ─► LOCKED
  └─ lock / logout / expiry ─► LOCKING ─► LOCKED
```

First use is distinct from verification of an existing installation. `UNINITIALIZED` remains the state until the user requests Diary, completes secondary-password setup, derives the approved KEK, generates a random Diary DEK, wraps it, persists only approved wrapped-key/KDF metadata, and establishes the first in-memory unlocked capability/session epoch. Only after that successful setup may authorized legacy plaintext migration run. Cancel or setup failure leaves `activeScope` unchanged, remains `UNINITIALIZED`, performs no body migration and leaves no partial durable success state. An initialized installation starts `LOCKED` on every application/session restart; successful password verification reaches `UNLOCKED(sessionEpoch)`.

Required scope and startup rules:

- `requestScopeChange('diary')` authenticates or initializes first; only successful setup/unlock may commit `activeScope = 'diary'`.
- Wrong password or cancellation leaves the current selected scope, route, tabs and presentation unchanged. `activeScope === 'diary'` implies an active `UNLOCKED` Diary session.
- A persisted `activeScope = 'diary'` on a new application session is normalized and persisted to `note` before Diary content is mounted. It does not fetch/restore Diary body; explicit Diary intent later opens the unlock/setup flow. Persisted `note` and `ledger` retain ordinary behavior.
- Do not restore/open persisted managed-Diary tabs or Diary deep links until the unlock capability is established. Ordinary Note tab restore may proceed independently, but the persisted tab list must be filtered before any Diary `getPost`/body fetch.
- A locked Diary deep link shows the unlock surface and does not fetch, decrypt, render or search body bytes.
- lock/logout/expiry invalidates the session epoch, clears Diary body views/models/caches, prevents late async results from rehydrating a tab, and returns to `note`.
- The unlock/lock operation is serialized with body reads/writes. A body transaction captures the current epoch; lock either waits for its durable encrypted commit or aborts before mutation. A stale capability cannot commit after lock.

## 7. Phase plan and gates

### D8.0 — Architecture / security-boundary verification

Scope: source-backed read/write graph, plaintext persistence audit, scope/startup audit, crypto/runtime inventory, migration policy, Mood separation and STOP conditions.

Deliverables: this implementation plan and the evidence document. No production encryption, no unlock UI, no schema migration, no dependency change, no D8.1 work.

Exit gate: every current body path has an owner and target disposition; no key reuse is implied; startup and draft/history boundaries are explicit; D8.1–D8.4 remain `NOT STARTED`.

### D8.1 — Secondary password + Diary session foundation

Scope: one shell-level lock/session owner, persisted locked/unlocked semantics, scope gate, deep-link gate, tab-restore quarantine, session epoch and capability invalidation.

Must not yet claim encrypted body storage is complete. Exit requires no managed-Diary body GET/restore before unlock and no persistent key material.

### D8.2 — Encrypted body read/write

Scope: versioned envelope, key wrapping, authenticated read/write, Diary create/save/recover, atomic ciphertext temp/staging, identity/CAS handling and negative tests for tamper/unknown version/wrong key.

Exit requires that the primary file, save temp, staged generation and recovery payload never contain requested plaintext body. Existing ordinary Note save semantics must remain unchanged.

### D8.3 — Privacy enforcement across existing lifecycle surfaces

Scope: History/Git, Recovery/Draft, search/body cache, LinkIndex, tree/list, rename/folder moves, external conflict, PDF/clipboard policy, logs and lock teardown.

Exit requires every surfaced Diary body path to use the adapter or fail closed, every persistent/plaintext cache path to be either encrypted, disabled for Diary, or explicitly outside the automatic storage guarantee with user-visible semantics, and the actual History/Git mutation owner to exclude new managed-Diary body revisions entirely.

### D8.4 — Migration, full regression, release and closure

Scope: idempotent plaintext-to-envelope migration, legacy History policy, metadata cleanup/classification, rekey/password change if selected, rollback/recovery proof, full D7 regression, responsive/a11y regression, CI, complete evidence and separate docs-only closure.

Exit requires no mixed plaintext/encrypted managed-Diary state, no unreviewed legacy plaintext claim, and an independent review followed by a separate closure commit. D8 overall is not closed by an implementation/evidence commit.

## 8. Migration and compatibility policy

Migration must be explicit and fail closed:

| Existing state | D8 policy |
| --- | --- |
| plaintext canonical Diary file with live identity | migrate only after unlock; encrypt, verify decrypt/hash/identity, then atomically replace; do not delete external backups silently |
| plaintext body in existing browser Draft/Recovery stores | do not auto-read into a locked session; offer an explicit user-authorized migration or discard path; never copy it into a new plaintext store |
| plaintext Diary in nested Git history | classify as legacy exposure; do not claim retroactive purge or silently rewrite/delete it. New managed-Diary body revisions must not enter Git at all; any history rewrite/purge needs an explicit user-controlled operation and backup policy |
| encrypted envelope with supported version | verify tag, identity binding and metadata association before exposing body |
| unknown/newer/corrupt envelope | fail closed before body mutation; preserve evidence for repair, never guess a plaintext format |
| missing file or missing stable generation | retain D7 identity rules; do not create a path-only encrypted identity during migration |

The migration must be resumable and idempotent per stable document identity. A failed migration must not leave a success-looking metadata status while the file remains plaintext. Existing plaintext is not retroactively erased by D8.0 documentation; D8.4 must state exactly what the user opted into and what legacy copies remain.

## 9. STOP conditions

Stop before the next phase if any of these occur:

- a managed-Diary body can reach `fs.writeFile`, atomic temp/staging, rename-reference payload, Git commit, IndexedDB Draft/Recovery, server LinkIndex or browser search cache as plaintext;
- a locked route/scope/tab restore can fetch or render Diary body;
- a component owns a second unlock/key/session state;
- a save/restore/History operation cannot bind ciphertext to stable identity and generation;
- a generic parser receives encrypted bytes as if they were Markdown and derives title/links/search data from them;
- unknown envelope versions/tags/identity mismatch are tolerated or followed by body mutation;
- password/decrypted DEK is persisted or reused from primary auth/AI key material;
- migration would silently delete legacy copies or claim existing plaintext Git history was purged;
- D8 implementation would require a new Reader/Editor/Dialog or would change ordinary Note semantics without a separately reviewed contract.

## 10. Acceptance criteria for D8.0

- [x] D7 baseline and closed architecture boundaries are recorded.
- [x] Current primary read/write, create, recover, rename/move, History and metadata seams are mapped.
- [x] Current plaintext persistence/leakage paths include disk, Git, IndexedDB, search, LinkIndex, temp/staging, UI and export handling.
- [x] A single recommended crypto/runtime owner and a separate secondary-password/key hierarchy are documented.
- [x] Scope, startup, persisted tabs, deep links and transactional lock invalidation requirements are explicit.
- [x] New D8 managed-Diary body is excluded from Git commits entirely; Note History remains unchanged and legacy Diary Git history has a non-destructive policy.
- [x] `UNINITIALIZED` / `LOCKED` / `UNLOCKED` semantics, first-use setup ordering and migration ordering are frozen.
- [x] `activeScope` is exactly one of `note` / `diary` / `ledger`; current-scope selection is a NO-OP; locked persisted Diary startup normalizes to `note`; `activeScope === 'diary'` implies `UNLOCKED`.
- [x] Migration, legacy History, unknown envelope and mixed-state STOP policies are explicit.
- [x] No production code, tests, dependencies, migration or D8.1 implementation was started.

## 11. D8.0 Independent Review remediation record

The first independent review identified three documentation contract findings. This remediation changes only the canonical plan; it does not claim independent review approval:

```text
D8.0-IR-P1-1  Git / History contract drift       = REMEDIATED
D8.0-IR-P1-2  Missing UNINITIALIZED first-use    = REMEDIATED
D8.0-IR-P2-1  Incomplete exactly-one scope       = REMEDIATED
```

At the remediation checkpoint, the resulting self-review was `P0/P1/P2 = 0/0/0` and independent re-review remained pending.

A subsequent residual wording review identified two further documentation findings. This cleanup changes only the two D8.0 documents and does not claim independent review approval:

```text
D8.0-IR-P2-2  Legacy Git security-boundary wording  = REMEDIATED
D8.0-IR-P2-3  Mood encryption lifecycle wording      = REMEDIATED
```

At the cleanup checkpoint, self-review remained `P0/P1/P2 = 0/0/0` and independent re-review remained pending.

## 12. D8.0 closure record

The independent re-review verified the remediation at `cc2d6df0c92a3e85962a605ed6674e39bb6b031d` and passed with no remaining findings:

```text
D8.0 Independent Re-review = PASS
D8.0 Independent Review P0/P1/P2 = 0/0/0
```

This closure sync changes only the D8.0 lifecycle state. It does not start D8.1 or change production code, tests or dependencies.

## 13. Lifecycle at this commit

```text
D7.0A–D7.6       = REVIEW-CLOSED
D8 overall        = IN PROGRESS
D8.0              = REVIEW-CLOSED
D8.0 Self-review  = PASS (0/0/0)
D8.0 Independent Review = PASS (0/0/0)
D8.1             = REVIEW-CLOSED
D8.2             = REVIEW-READY
D8.2 Self-review = PASS (0/0/0)
D8.2 Independent Review = PENDING
D8.3             = NOT STARTED
D8.4             = NOT STARTED
```

The sentence above is the historical D8.0 checkpoint boundary. The current
lifecycle is recorded at the top of this plan and in the D8.2 evidence; it
does not authorize D8.3 or D8.4 work before their own gates.
