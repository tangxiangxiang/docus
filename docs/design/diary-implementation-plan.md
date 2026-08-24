
# Diary Implementation Plan

## 1. Status

- **Status:** D0 REVIEW-CLOSED；D1 REVIEW-CLOSED；D2 COMPLETE / REVIEW-READY。本文件继续定义 Diary 的阶段边界、测试、证据和 review gate；D2 独立 review 尚未关闭。
- **Planning baseline:** f342e7ad85e30b8bfb9073ac22f668dae154a7d0 (docs(diary): add vcalendar compatibility gate).
- **Product source:** [diary-prd.md](./diary-prd.md)。PRD 是产品契约的唯一 source of truth；本文件不能重新定义产品行为。
- **VCalendar status:** preferred candidate / pending D3.0 exact-stack compatibility gate；本文件不把它写成已批准的 runtime dependency。
- **D1 status:** REVIEW-CLOSED。implementation commit 为 `d0a5d4e82e930445bd9e549e27d39e8c18b30819`；独立 review 结果为 P0 = 0、P1 = 0、P2 = 0。
- **VCalendar runtime gate:** PENDING。D3.0 尚未安装 candidate、尚未执行 compatibility spike，也没有 runtime/build/test PASS 证据。
- **Current phase boundary:** D2 server/root/mutation contract 已实现并完成本地验证；generic recovery provenance follow-up 已由 `acaf548c048c2948de726208ea4d2a1c1c9b3be3`（`fix(diary): close generic recovery provenance gap`）收口，D2 仍为 COMPLETE / REVIEW-READY，等待独立复审；本次没有开始 D3.0 或后续 Diary implementation，未安装 VCalendar。
- **Self-review result:** P0 = 0、P1 = 0、P2 = 0，表示本 Implementation Plan 的施工 contract 已补齐，不表示任何 Diary runtime 阶段已经通过。

### Planning-state note

PRD 与本 Implementation Plan 已完成独立 review closure 的状态同步：PRD = REVIEW-CLOSED，D0 = REVIEW-CLOSED，D1 = REVIEW-CLOSED。D2 已实现并处于 COMPLETE / REVIEW-READY；generic recovery provenance P1 follow-up 已完成，等待独立复审；D3.0 仍为 BLOCKED / PENDING，VCalendar runtime compatibility gate 仍为 PENDING。该状态同步不代表 Diary 全部实现，也不把 VCalendar 写成已批准的 runtime dependency。

## 2. Source of Truth

实施时按以下优先级解释事实：

1. docs/design/diary-prd.md 定义 Why、What、产品行为、领域不变量、UX 和架构边界。
2. 当前 main 代码定义真实 module seam、启动顺序、API route、测试配置和可靠性实现。
3. 本 Implementation Plan 定义 How、阶段顺序、预计文件、测试、停止条件、证据和 commit/review boundary。

如果当前代码与 PRD 发生真实矛盾：

- 停止当前阶段；
- 在阶段 evidence 中记录具体路径、行为和影响；
- 提出 PRD/ADR follow-up；
- 不通过代码顺手修正产品决定；
- 不把临时 workaround 当作 closure evidence。

Implementation Plan 不复制 PRD 全文，只重复后续实现必须持续引用的冻结 contract：

| Area | Frozen contract |
| --- | --- |
| Root | diary/ 是保留的 system root；root 不能 rename、delete、move 或 re-parent。 |
| Identity | 一个有效日期对应一个 Diary；logical path 是 diary/YYYY-MM-DD，physical file 是 CONTENT_DIR/diary/YYYY-MM-DD.md。 |
| Shape | Diary 是 flat date namespace；不使用 diary/YYYY/MM/、diary/YYYY-MM/ 或 nested Diary folder。 |
| Creation | 缺失的 today/past 可创建并打开；缺失的 future 不创建；已有 future 可以打开、编辑、删除。 |
| Mutation | managed Diary document 可以 edit/delete；不能 rename、move 或 re-parent。 |
| Identity safety | 固定路径和 create-only semantics 保证 one/day；绝不使用 -2、-3 collision suffix。 |
| Editor | 复用现有 Vault Editor、tabs、save、history、draft recovery 和 selection；禁止 DiaryEditor 等平行生命周期。 |
| Calendar | VCalendar 是 preferred candidate，必须先通过 D3.0；D3.0 不是完整 Calendar implementation。 |
| Mood | 只保留 future presentation/domain seam；Mood 不进入 MVP。 |
| Scope | note 仍是 inbox/literature/archive；diary 和 ledger 是独立 scope。 |

## 3. Scope

### In scope

- D0-D5 的可执行阶段计划。
- Diary date/path/classification domain protocol。
- diary/ root seed、server-authoritative create/edit/delete/rename/move guards。
- generic REST、folder、AI mutation entry point 的旁路审计和 guard。
- D3.0 VCalendar exact-stack compatibility gate，以及 D3.1 adapter、D3.2 monthly surface 的施工边界。
- Calendar 与现有 FileTree、Vault Editor、route、tabs、fileChanges、History、Recovery 的 integration plan。
- responsive、accessibility、i18n、docs、release evidence 和 rollback strategy。

### Out of scope

- 本任务中的任何 Diary implementation。
- 本任务中的 VCalendar 安装、candidate resolution、compatibility spike 或 browser smoke。
- Mood MVP、AI 写日记、独立 Diary database/entity、重复日记、recurrence、event scheduling、time slots、drag/resize。
- DiaryEditor、DiarySave、DiaryHistory、DiaryRecovery 或平行 route/tab/save architecture。
- Archive Soft-Policy、useArchiveNote()、note scope、ledger 语义或 filesystem/auth/history/recovery 安全边界的改动。
- 为 Diary 新增通用 folder re-parent 能力，或重构现有 folder transaction/recovery architecture。

## 4. Cross-phase Invariants

以下 invariant 在 D1-D5 中始终有效；任何阶段不能以方便实现为理由破坏它们：

1. 1 date = 1 Diary。
2. Diary path 不产生 collision suffix。
3. Docus logical path 不含 .md；只有 physical mapping 追加 .md。
4. Diary today 使用 local civil date，不使用 new Date().toISOString().slice(0, 10)。
5. 缺失 future 不得创建；已有 future 仍可打开、编辑、删除。
6. managed Diary document 不能 rename、move 或 re-parent。
7. managed Diary document 允许 edit/delete，并复用普通 document lifecycle 的安全流程。
8. diary root 是 reserved system root，不能 rename/delete/move/re-parent。
9. diary/foo.md、diary/2026-02-31.md、diary/foo/bar.md 等 invalid/unmanaged 外部内容不能被 Calendar 当成 managed Diary，也不能被自动删除、覆盖或重命名。
10. 不创建 DiaryEditor 或第二套 editor identity/save/history/recovery。
11. 复用既有 History、Crash Recovery、Draft Store、selection 和 fileChanges 语义。
12. Archive Soft-Policy 不变：archive root 保留，archive descendants 继续是 ordinary user content。
13. note scope 仍只包含 inbox、literature、archive；diary 不并入 note。
14. ledger 语义不变。
15. filesystem confinement、path traversal、absolute path、root escape、symlink/junction、extension/slug validation、auth、CSRF/origin 和 atomic write 安全不放宽。
16. Mood 不进入 MVP；future Mood 只能通过既定 metadata/presentation seam 演进。
17. VCalendar 只存在于 presentation adapter；domain、server、API path protocol 和 domain tests 不依赖 VCalendar。
18. 不为了 VCalendar 降级 Vue、Vite 或 TypeScript。
19. 现有 folder same-parent rename/delete 与其 durable transaction/recovery 继续有效；Diary 计划不新增通用 folder move API，也不通过禁用现有 folder lifecycle 实现 Diary 规则。

## 5. Current Architecture Seams

本次审计确认的当前 main seam 如下。文件名是实施前应重新阅读的事实入口，不代表本次已经改动：

| Seam | Current fact | Diary reuse boundary |
| --- | --- | --- |
| shared/archiveProtocol.ts | PROTECTED_ROOTS 当前包含 inbox、literature、archive；archive descendants 已不再是 readonly。 | D1 需要审计并扩展 reserved-root contract 到 diary，但不能恢复 archive subtree restriction。必要时做最小 root helper 调整，不做全局 archive refactor。 |
| shared/scopeProtocol.ts | note 映射到 inbox/literature/archive，diary 和 ledger 已是独立 scope。 | 保持现状；Diary domain 不改变 scopeProtocol。若实现前事实不同，先停并报告。 |
| server/paths.ts | 提供 logical path validation、.md physical mapping、safe path resolution 和 CONTENT_DIR confinement。 | Diary 所有 path 都必须复用这些 helper；不能自行拼接绝对路径或引入第二套 path parser。 |
| server/seed.ts | ensureInitialFolders() 当前只 seed 三个 vault roots，并且是 idempotent、冲突不覆盖。 | D2 扩展同一 helper 到 diary/；不建立平行 ensureDiaryFolder() startup 架构。 |
| server/prod.ts / server/vite-plugin.ts | production/dev 有既有 startup initialization、writer ownership、crash recovery、metadata migration 和 auth runtime。 | 保持 dev/prod seed/recovery/auth 顺序一致；Diary root 必须在请求可用前初始化。 |
| server/documentMutationPolicy.ts | REST/AI document mutation 共用 protected-root validator；archive descendants 只受普通 path/security 规则。 | D2 将 Diary managed path/date rule 接入同一 authoritative policy，不只加 UI guard。 |
| server/routes/posts.ts | 负责 list/get/create/write/patch/delete/recover；PATCH 支持普通文件 rename/move；create 使用 create-only semantics。 | D2 复用 edit/delete/atomic/history lifecycle，拒绝 Diary bypass、rename/move 和 suffix。 |
| server/routes/folders.ts | folder create、same-parent rename、recursive delete 由 durable folder transaction/recovery 体系负责；当前 route 明确拒绝跨父目录 folder re-parent。 | 不扩展 folder API；D2 只增加 Diary root/nested folder contract guard，并保留现有 transaction。 |
| server/tree.ts | 递归扫描 .md，向客户端暴露 extensionless PostSummary.path；当前没有 Diary classification。 | D1/D2 新增严格 managed/unmanaged classification 或在上层过滤；不能改变全局 Markdown scanning semantics 来隐藏 invalid content。 |
| server/ai/tools.ts / server/ai/tool-safety.ts | AI mutation tools 共享 path helpers、document mutation policy 和 live safety policy。 | D2 让 AI 与 REST 使用同一 Diary guard；不新增 AI 日记产品功能。 |
| server/index.ts / auth | Hono /api/* 已由 authBoundary 默认保护，auth routes 和 health allowlist 已集中注册。 | Diary route 必须挂在现有 boundary 下，不新增 auth bypass 或测试后门。 |
| src/lib/api.ts | 提供 extensionless getPost/listPosts/createPost/patchPost/deletePost 和 folder wrappers，使用 authFetch。 | D4 增加最小 typed Diary API wrapper 或扩展现有 client；不创建第二个 auth/fetch stack。 |
| src/views/VaultView.vue | 拥有 Vault shell、fileChanges、editor tabs、useDocumentLifecycle、route/openPost、History/Recovery orchestration。 | D3/D4 在现有 Vault seam 接入 Calendar/open command；不创建平行 Diary route 或 editor shell。 |
| src/composables/vault/useDocumentLifecycle.ts | 已覆盖 create、rename、delete、folder lifecycle、draft/recovery/selection coordination。 | Diary 只添加 domain-aware entry/guard 或 adapter，不复制 save/delete/recovery pipeline。 |
| src/composables/vault/editor-tabs/useTabWorkspace.ts / useEditorTabs.ts | openPost()、refresh、route sync、tab identity 和 document creation 已集中。 | openDiaryDate() 最终必须走这里的 existing open path。 |
| src/composables/vault/context/fileChanges.ts | 提供 write/delete/rename change bus 和 consumer sequencing。 | Calendar markers 从既有 refresh/fileChanges 结果更新，不建立 Diary event bus。 |
| src/composables/vault/useScopeFilter.ts / src/components/NavBar.vue | scope chip 已显示 diary；FileTree 是现有内容可见性入口。 | Calendar 成为 diary scope primary surface，但 FileTree 保留用于内容/invalid file 可见和清理。 |
| src/composables/useI18n.ts | 中英文文案集中在 composable string table。 | D5 复用已有 i18n seam，不把大量英文硬编码到 Calendar。 |
| Tests/configs | unit server/client 使用 Vitest；History/Recovery 有独立 config；browser 使用 Playwright。 | 每阶段只增加对应 lane；不把 D3 spike 与 full Diary E2E 混在一起。 |

### Exact-stack audit snapshot

本次只记录审计时的 baseline，D3.0 必须重新从当时的 package.json 与 lockfile resolve，不能沿用这段文字当作未来 pin：

| Package | package.json direction | lockfile snapshot |
| --- | --- | --- |
| Vue | ^3.5.34 | 3.5.35 |
| Vite | ^8.0.12 | 8.0.16 |
| TypeScript | ~6.0.2 | 6.0.3 |
| @vitejs/plugin-vue | ^6.0.6 | 6.0.7 |
| vue-tsc | ^3.2.8 | 3.3.3 |
| Vitest | ^4.1.8 | 4.1.8 |
| jsdom | ^29.1.1 | 29.1.1 |

当前没有 VCalendar dependency；此表不代表 VCalendar 已在这个 stack 上通过 runtime/build/test 验证。

## 6. Phase Dependency

~~~mermaid
flowchart TD
  D0["D0\nPRD + Implementation Plan"] --> D1["D1\nDiary Domain Protocol"]
  D1 --> D2["D2\nRoot / Server / Mutation Contract"]
  D2 --> D30["D3.0\nVCalendar Compatibility Gate"]
  D30 --> G{"Gate result"}
  G -->|"PASS"| D31["D3.1\nDiaryCalendar Adapter"]
  G -->|"CONDITIONAL PASS\nwith evidence"| D31
  G -->|"FAIL"| ADR["Calendar ADR follow-up\nD3 implementation stops"]
  D31 --> D32["D3.2\nMonthly Diary Surface"]
  D32 --> D4["D4\nVault Lifecycle Integration"]
  D4 --> D5["D5\nResponsive / Release / Closure"]
~~~

每个箭头都是 review gate，不是自动续跑指令。阶段完成后必须 STOP，等待独立 review 和 closure；D3.1 永远不能绕过 D3.0。

### Runtime implementation flow

~~~mermaid
flowchart LR
  C["DiaryCalendar"] --> O["openDiaryDate(date)"]
  O --> V["Diary date/domain validation"]
  O --> A["Diary date API / existing post API"]
  A --> L["existing useDocumentLifecycle"]
  L --> T["existing openPost / editor tabs"]
  T --> E["existing Vault Editor"]
  L --> F["fileChanges + tree/posts refresh"]
  F --> C
~~~

这张图只表达计划中的真实复用关系：不引入 DiaryService、DiaryEditor、DiaryEventBus 或第二套保存服务。最终 API wrapper 和 command 的文件位置必须以实施时 current main seam 为准。

## 7. D0 — PRD / Implementation Planning

### Goal

创建本文件，把已完成产品 PRD 转换为可逐阶段施工、review、closure 的 Implementation Plan。

### Preconditions

- 已读取 diary-prd.md。
- 已读取 authentication-v1-implementation-plan.md、emoji-support-implementation-plan.md、pdf-export-implementation-plan.md，并遵循其 phase、file map、test matrix、evidence、rollback 和 commit boundary 惯例。
- 已审计当前 main 的 shared/server/client/test seams。
- 当前 worktree 无用户未提交改动需要覆盖。

### Scope

- 记录 D1-D5 的 Goal、Preconditions、Scope、Non-goals、Current Repo Seams、Files、Steps、Contracts、Tests、Regression、Validation、Evidence、STOP、Exit、Commit 和 Review Status。
- 明确 D3.0 compatibility gate 及其对 D3.1 的阻塞关系。
- 明确每阶段 closure 后必须停止，不自动进入下一阶段。

### Non-goals

- 不改 PRD 产品决定；原始 D0 不负责 PRD closure，后续 closure sync 只同步已完成 review 的状态文字。
- 不新增 production code、tests、dependency 或 lockfile。
- 不安装 VCalendar，不运行 D3.0 spike，不开始 D1。

### Current Repo Seams

- PRD：docs/design/diary-prd.md。
- 既有计划风格：authentication、emoji、PDF export 三份 Implementation Plan。
- 当前验证脚本来自 package.json；本 D0 只做文档/差异验证。

### Files to Inspect

- docs/design/diary-prd.md
- docs/design/authentication-v1-implementation-plan.md
- docs/design/emoji-support-implementation-plan.md
- docs/design/pdf-export-implementation-plan.md
- package.json、package-lock.json
- 本文件第 5 节列出的 current main seams

### Expected Files to Modify

- 无 production/test/dependency 文件。
- 原始 plan commit 仅新增 docs/design/diary-implementation-plan.md；closure sync 只修改 docs/design/diary-prd.md 与本文件的状态文字。

### New Files

- docs/design/diary-implementation-plan.md

### Detailed Steps

1. 冻结 PRD link、planning baseline 和当前 status。
2. 记录 current main 的 root/scope/path/editor/server/auth/test seam。
3. 将实施拆为 D1、D2、D3.0、D3.1、D3.2、D4、D5。
4. 为每个阶段写清楚 review/closure、测试和 STOP 条件。
5. 加入 phase dependency、runtime flow、cross-phase invariants、rollback 和 evidence contract。
6. 检查本文件没有把 VCalendar peer range 写成 runtime approval，也没有把 Diary 变成另一套 editor。

### Contracts / Invariants

- 本文件是施工计划，不是 implementation result。
- 原始 D0 plan 创建完成时为 review-ready；独立 review 与 closure sync 完成后，D0 状态为 REVIEW-CLOSED。
- D1-D5 均必须保持 NOT STARTED 或 BLOCKED，直到对应阶段真实实施。
- 任何未验证的 VCalendar、browser、typecheck 或 build 结果不能标成 PASS。

### Tests

- 不新增测试。
- 只运行文档差异、文件边界和 worktree 检查。

### Regression

- production code、tests、package manifests、lockfile、scopeProtocol、Archive 和现有 lifecycle 不得出现 diff。

### Validation Commands

~~~powershell
git diff --check
git diff --name-only
git status --short
~~~

不运行 npm install、npm run typecheck、npm run build、npm test 或 D3.0 spike，除非另有明确任务授权。

### Evidence

D0 完成报告必须包含：

1. 本文件路径和 commit SHA。
2. 实际 changed files。
3. production code changed: NO。
4. tests changed: NO。
5. package.json/package-lock.json changed: NO。
6. dependencies installed: NO。
7. git diff --check 结果。
8. worktree status。
9. D1-D5 仍未开始。

### STOP Conditions

- PRD 仍有未关闭的 P0/P1/P2 contract issue。
- current main 与计划中关键 seam 不一致。
- 需要修改 PRD 才能让计划成立。
- 需要安装依赖、改 production code 或创建新的 feature epic 才能完成 D0。
- 发现用户已有未提交改动会与本文件冲突。

### Exit Criteria

- PRD source link、D1-D5 scope、D3.0 gate、tests、STOP conditions、commit boundaries 和 closure flow 全部写明。
- 当前任务没有 production/test/dependency/lockfile diff。
- git diff --check PASS。
- 本阶段完成时状态为 D0 REVIEW-CLOSED；当时 D1 尚未开始。

### Suggested Commit

docs(diary): close PRD and implementation plan

### Review Status

REVIEW-CLOSED；本次 closure sync 不包含 Diary implementation、VCalendar 安装或 D3.0 compatibility spike。

## 8. D1 — Diary Domain Protocol

### Goal

建立完全不依赖 Calendar UI、server route 和 editor lifecycle 的纯 Diary date/path/classification domain。

### Preconditions

- D0 Implementation Plan 已独立 review 并 REVIEW-CLOSED。
- Diary PRD 的独立 closure 已有可引用 evidence；如果仓库文件状态仍与交接声明不一致，先停止。
- 当前 runtime/target 的 date-only 支持已审计。
- 没有把 Calendar library 带入 domain 设计。

### Scope

- 严格验证 DiaryDate 的真实 calendar date。
- 提供 logical path、root、managed、unmanaged/invalid classification 的纯职责。
- 将 diary 纳入 functional protected-root contract，同时保持 archive soft-policy 和 note scope 不变。
- 明确 local civil date strategy。

### Non-goals

- 不实现 API、seed、Calendar、editor、Mood 或 mutation route。
- 不让 domain 负责 filesystem I/O、auth、history、recovery 或 UI toast。
- 不引入第三方 date library；如果 Temporal.PlainDate 在目标 runtime 需要新 dependency，STOP 并单独报告。
- 不把整个 diary/ subtree 设计为 readonly filesystem subtree；Diary 限制只针对 date identity/shape。

### Current Repo Seams

- shared/archiveProtocol.ts：当前 reserved roots 和 root mutation predicates。
- shared/scopeProtocol.ts：当前 diary 独立 scope，预计不改。
- server/paths.ts：logical path syntax、safe path 和 physical .md mapping。
- server/tree.ts：现有 extensionless post listing，供 classification 对照。

### Files to Inspect

- shared/archiveProtocol.ts
- shared/scopeProtocol.ts
- shared/__tests__/archiveProtocol.test.ts
- server/paths.ts、server/__tests__/paths.test.ts
- server/tree.ts、server/__tests__/tree.test.ts
- tsconfig.app.json、tsconfig.server.json、目标 browser/Node runtime 配置
- package.json、package-lock.json 中的 date/runtime 相关能力

### Expected Files to Modify

- shared/archiveProtocol.ts：只在当前 root contract 最小扩展确实需要时修改；不得改变 archive descendants 语义。
- shared/__tests__/archiveProtocol.test.ts：补 diary root regression（如果 root contract 放在此模块）。
- server/paths.ts：仅当实施审计证明 date/path mapping 应归属现有 path helper 时修改；不复制安全 parser。
- shared/scopeProtocol.ts：当前已满足 Diary 独立 scope，默认不改。

### New Files

- 推荐 shared/diaryProtocol.ts：纯 date/path/classification contract。
- 推荐 shared/__tests__/diaryProtocol.test.ts。

具体函数名可以按 current main convention 小范围调整，但职责必须保持可替换、纯函数、无 Calendar import。

### Detailed Steps

1. 先确认 Temporal.PlainDate 或同等级 date-only abstraction 在 browser、Node、Vitest/jsdom 的真实 target 中可用；区分 native support、test support 和 production support。
2. 如果需要 polyfill 或新的 dependency，停止 D1，记录 dependency/target 影响，等待独立 ADR；不能顺手安装。
3. 建立 DiaryDate 的 strict parser/validator：regex 只做形状初筛，最终必须验证月份、日期、闰年和真实 calendar date。
4. 覆盖 diaryLogicalPathForDate()、diaryDateFromPath()、isDiaryRoot()、isManagedDiaryPath()、classifyDiaryPath() 等职责；具体命名以实施时 current main 为准。
5. 分类 diary root、valid managed diary/YYYY-MM-DD、invalid/unmanaged diary/foo、invalid date 和 nested path。
6. 将 diary 加入 protected-root mutation contract，审计所有 isProtectedRoot/canModify/canMove 调用点；确认 archive descendants 仍返回普通内容语义。
7. 让 date conversion 始终保持 date-only/local fields；禁止 UTC ISO slice。
8. 编写纯 domain tests，确保测试文件不 import VCalendar、Vue component 或 server route。

### Contracts / Invariants

- valid：2026-08-24、2024-02-29。
- invalid：2026-02-29、2026-02-31、2026-13-01、2026-00-10、2026-8-24、foo、2026-08-24-extra。
- logical path 永远是 diary/YYYY-MM-DD，不能含 .md。
- diary root 是 protected root；archive root 和 archive/* 的现有 soft-policy 不变。
- note scope 仍不包含 diary；diary scope 仍只指向 diary。
- domain classification 不执行 delete、rename、overwrite 或 filesystem repair。

### Tests

至少新增/更新：

- shared/__tests__/diaryProtocol.test.ts
  - valid date、invalid date、leap year；
  - logical path round-trip；
  - root/managed/unmanaged classification；
  - no .md logical identity；
  - date-only/local conversion；
  - today/past/future comparison helper（如职责确实归 domain）。
- shared/__tests__/archiveProtocol.test.ts
  - diary root protection；
  - archive root/descendant regression；
  - note root protection。
- server/__tests__/paths.test.ts（仅当 path helper 有修改）
  - safe path、physical mapping 和 Diary path 不绕过现有 confinement。

### Regression

- archive descendants 仍可按 Archive Soft-Policy 进行普通 user-content CRUD。
- inbox、literature、archive root protection 不回归。
- note/diary/ledger scope mapping 不变。
- no traversal、absolute path、root escape、symlink/junction relaxation。

### Validation Commands

~~~powershell
npm run typecheck
npm exec vitest run shared/__tests__/diaryProtocol.test.ts shared/__tests__/archiveProtocol.test.ts
git diff --check
~~~

若新增 server-side pure helper，补跑 npm run typecheck:server 和对应 server/__tests__/paths.test.ts。D1 不运行 Calendar tests。

### Evidence

报告：

- changed files、new public pure functions 和职责；
- date validation test output；
- root/scope/archive regression output；
- date strategy 是否需要 dependency；
- typecheck 与 focused test 命令/结果；
- worktree status；
- D2 已进入 COMPLETE / REVIEW-READY；独立 review 仍未关闭。

### STOP Conditions

- 真实日期验证依赖未获批准的新 dependency/polyfill。
- 需要修改 .md logical identity、document ID architecture 或全局 path parser。
- 发现当前 diary scope、archive contract 或 protected roots 与 PRD 不一致。
- domain 需要读取 filesystem 或 Calendar runtime 才能完成纯分类。
- 需要改变 note、ledger 或 Archive 产品语义。

### Exit Criteria

- pure Diary domain protocol 存在且有严格日期测试。
- root/managed/unmanaged 分类稳定。
- diary root contract 生效，archive/scope regression 通过。
- typecheck、focused tests、git diff --check PASS。
- 独立 review 后才可标 REVIEW-CLOSED。

### Suggested Commit

feat(diary): establish diary domain protocol

### Review Status

REVIEW-CLOSED。实现 commit：`d0a5d4e82e930445bd9e549e27d39e8c18b30819`。独立 review：P0 = 0、P1 = 0、P2 = 0。D1 closure 后必须 STOP，不自动开始 D2。

### Closure Evidence

- Contract completed：branded `DiaryDate`、strict Gregorian date validation、logical Diary path mapping、root / managed / unmanaged / outside classification。
- `diary` exact protected-root contract 已建立；Archive Soft-Policy 保持不变，`scopeProtocol` 未修改。
- 未使用 UTC conversion；未新增 dependency；未安装 VCalendar；未开始 D2。
- Validation evidence：`npm run typecheck` PASS；Diary/Archive focused tests PASS；document mutation policy regression PASS；`git diff --check` PASS。
- Windows 初次 focused test 的 `spawn EPERM` 已标记为环境限制，并通过允许的提升方式成功重跑；GitHub CI 未验证。
- D2 gate 已满足其前置条件；D2 implementation 已完成并进入 REVIEW-READY。

## 9. D2 — Root / Server / Mutation Contract

### Goal

把 D1 的 Diary identity/date invariant 变成 server-authoritative、atomic、不可旁路的 root/CRUD/mutation contract。

### Preconditions

- D1 已 REVIEW-CLOSED。
- date strategy、logical/physical mapping 和 protected-root contract 已有 tests。
- 当前 auth boundary、path confinement、atomic write、metadata、history、crash recovery seam 已重新审计。

### Scope

- 统一 seed diary/ root。
- 提供 Diary-specific date create command（推荐 POST /api/diary/dates，最终 endpoint 以现有 route convention 为准）。
- 允许 managed Diary edit/delete，拒绝 managed rename/move/re-parent。
- today/past missing create；future missing reject；existing future return/open/edit/delete。
- 防止 generic posts、folder route、AI tools 绕过 Diary contract。
- 保留 invalid/unmanaged external files 的可见性和原文件安全。

### Non-goals

- 不新增 database Diary entity、UUID、migration 或 second identity store。
- 不复用 uniqueMoveTarget() 或 Archive collision suffix。
- 不建立 Diary-specific delete/history/recovery transaction。
- 不修改 folder transaction architecture，不新增跨父目录 folder move API。
- 不修改 auth policy、CSRF/origin policy、path confinement 或 atomic safety 来迁就 Diary。
- 不实现 Calendar UI 或 editor open command。

### Current Repo Seams

- server/seed.ts 的 ensureInitialFolders() 是唯一 root seed helper。
- server/prod.ts、server/vite-plugin.ts 是启动初始化入口。
- server/routes/posts.ts 已有 create/write/patch/delete/recover 和 create-only/metadata lifecycle。
- server/documentMutationPolicy.ts 是 REST/AI 的共享 file mutation policy。
- server/routes/folders.ts 的 current same-parent folder rename/recursive delete transaction 必须保留。
- server/ai/tools.ts、server/ai/tool-safety.ts 是 AI mutation path。
- server/index.ts 已有 auth boundary；新 route 必须在同一 boundary 内。

### Files to Inspect

- server/seed.ts
- server/prod.ts
- server/vite-plugin.ts
- server/index.ts
- server/documentMutationPolicy.ts
- server/routes/posts.ts
- server/routes/folders.ts
- server/tree.ts
- server/paths.ts
- server/documentFileLifecycle.ts
- server/documentMetadata.ts
- server/atomicTextWrite.ts
- server/crashRecovery.ts
- server/ai/tools.ts
- server/ai/tool-safety.ts
- server/__tests__/seed.test.ts
- server/__tests__/post.test.ts
- server/routes/folders.test.ts
- server/__tests__/documentMutationPolicy.test.ts
- server/__tests__/tools.test.ts
- auth/path security tests relevant to the route boundary

### Expected Files to Modify

- server/seed.ts。
- server/prod.ts / server/vite-plugin.ts，仅在同一 seed helper 的 dev/prod 调用顺序需要补齐时修改。
- server/documentMutationPolicy.ts。
- server/routes/posts.ts、server/routes/folders.ts。
- server/tree.ts，仅在 managed Diary filtering/classification 需要一个最小共享 seam 时修改；不隐藏 invalid files globally。
- server/ai/tools.ts / server/ai/tool-safety.ts，仅为共享 Diary guard 接入所需。
- server/index.ts，仅在新增 server/routes/diary.ts 需要挂载时修改。
- 相关 server tests。

### New Files

- 推荐 server/routes/diary.ts：只拥有 date create/read projection 所需的 route contract，不把所有 document lifecycle 搬入新 service。
- 推荐 server/__tests__/diary-routes.test.ts 或按当前测试命名 convention 拆分的 Diary route test。
- 如需要单独共享 server classifier，可新增最小 helper；不得建立第二套 path/security protocol。

### Detailed Steps

1. 先把 ensureInitialFolders() 扩展到 diary，保持 idempotent：已存在目录不触碰；同名普通文件报告 conflict；不覆盖用户数据。
2. 确认 dev/prod 都在接受请求前调用同一 seed helper，并保持 writer ownership、auth initialization、crash recovery、metadata migration 的既有顺序。
3. 设计 date create command：输入严格 DiaryDate，按 client/server 约定校验 timezone/local date；不能接受任意 path、.md、title 作为 identity。
4. 对 today/past missing 创建 exact diary/YYYY-MM-DD.md；existing exact path 返回 existing，不新建第二代文件。
5. 使用当前 create-only/atomic semantics 处理并发：竞争失败方重新读取 exact path 并返回 existing；不得生成 suffix。
6. 将 edit/delete managed Diary 接入现有 posts lifecycle；保持 metadata、History、Draft/Recovery 和 file change semantics。
7. 在共享 validateDocumentMutation 或等价 authoritative policy 中拒绝：managed Diary rename、move-out、move-in、within-diary move、generic create 和 identity-changing path mutation。
8. 审计 POST /api/posts、PATCH /api/posts/*、DELETE /api/posts/*、folder API、recover API 和所有 batch/indirect mutation，确保没有只在 UI 层阻断。
9. POST /api/folders 在 diary root 下创建任意 nested folder 必须拒绝；现有 server/routes/folders.ts 的 same-parent rename/delete/transaction 不重构。
10. 让 AI create/write/delete/rename tools 复用同一 Diary policy；不要新增“AI 写日记”命令或特殊绕过。
11. 对 diary/foo.md、invalid date、nested path 等 external content 保持 tree/file management 可见；Calendar projection 忽略，server 不自动删除、覆盖或重命名。
12. 为 auth、path traversal、absolute path、symlink/junction、root escape、atomic race 和 protected root 加 regression assertions。

### Contracts / Invariants

| Input/state | Required result |
| --- | --- |
| seed missing diary/ | create exactly one directory |
| seed existing directory | leave contents untouched |
| seed diary is a file | surface conflict; never overwrite |
| today/past missing date | create exact path and return it |
| existing date | return/open existing identity |
| future missing date | reject/no file |
| invalid date/path | reject/no file |
| concurrent same-date create | one physical file; loser rereads exact path |
| managed edit | allowed through ordinary save path |
| managed delete | allowed through ordinary delete；generic Diary recovery 需要 prior-identity proof，History Restore 缺失目标必须先有 Git historical content provenance |
| managed rename/move/re-parent | reject server-side |
| generic create under diary | reject unless it is the approved date command |
| folder create under diary | reject; no nested Diary folder model |
| invalid external content | preserve and keep generic file visibility |
| protected root | rename/delete/move/re-parent reject |

### Tests

至少覆盖：

- server/__tests__/seed.test.ts：diary seed、idempotence、file conflict、no overwrite、dev/prod helper contract。
- server/__tests__/diary-routes.test.ts：today/past/future/invalid/existing/concurrent/no suffix；managed-looking generic recovery fail-closed。
- server/__tests__/post.test.ts 或独立 route test：managed edit/delete allowed；rename/move-in/move-out/within-diary rejected；generic create rejected。
- server/routes/folders.test.ts：folder create under diary rejected；protected root guard；现有 same-parent rename/delete 和 durable folder transaction regression。
- server/__tests__/documentMutationPolicy.test.ts：REST/AI shared Diary policy。
- server/__tests__/tools.test.ts、server/__tests__/tool-safety.test.ts：AI cannot bypass Diary identity。
- server/__tests__/tree.test.ts：invalid external content remains visible/untouched；managed projection filtering 由明确 layer 负责。
- path/auth/security tests：auth boundary、CSRF/origin、safe path、symlink/junction、root escape。

### Regression

- Archive root/descendant Soft-Policy 完全不变。
- note scope、diary scope、ledger scope 不变。
- ordinary file create/write/delete/move、folder same-parent rename/delete、History、Recovery、Draft Store 不回归。
- Archive action、collision suffix、useArchiveNote() 目标不变。
- server 仍只允许安全 relative paths；禁止 ../、absolute、protocol path、vault escape。

### Validation Commands

~~~powershell
npm run typecheck
npm exec vitest run server/__tests__/seed.test.ts server/__tests__/diary-routes.test.ts server/__tests__/documentMutationPolicy.test.ts server/routes/folders.test.ts
npm exec vitest run server/__tests__/post.test.ts server/__tests__/tools.test.ts server/__tests__/tree.test.ts
npm run test:history-integration
npm run test:recovery-integration
git diff --check
~~~

如果 route 与 History/Recovery 真实 transaction 有关联，必须保留对应 integration lane；Windows symlink/EPERM 只能标 BASELINE-LIMITED，不能标 PASS。

### Evidence

报告：

- seed helper 和 dev/prod startup evidence；
- endpoint request/response matrix；
- concurrent create physical listing/metadata evidence；
- generic REST/folder/AI bypass rejection；
- edit/delete/history/recovery evidence；
- invalid external file untouched evidence；
- auth/path/security regression；
- typecheck、focused、history、recovery 命令结果；
- worktree 和 commit SHA；
- D3.0 remains BLOCKED / PENDING；VCalendar 未安装且 compatibility spike 未执行。

### STOP Conditions

- 需要新 database schema、Diary entity 或改变 document identity。
- 并发 create 只能靠 suffix 或非 create-only overwrite 才能实现。
- generic API、AI tool 或没有可靠 provenance 的 recovery path 需要不同于共享 policy 的特殊 bypass。
- 需要修改 server/routes/folders.ts transaction/journal architecture 才能满足 Diary。
- 需要全局修改 tree scanning 来隐藏 invalid external content。
- auth/path/filesystem safety 必须放宽。
- current diary root 与 seed contract 不一致且不能在同一 helper 内修复。

### Exit Criteria

- root seed、date create、edit/delete 和 all-entry-point guard server-authoritative 生效。
- one/day/no suffix、future、invalid external、protected root contract 有测试和 evidence。
- Archive/note/scope/security/history/recovery regression 通过。
- typecheck、targeted tests、integration lanes、git diff --check PASS，或明确记录 baseline-limited。
- 独立 review 后 REVIEW-CLOSED，然后 STOP，不自动进入 D3.0。

### Suggested Commit

feat(diary): enforce diary server lifecycle

### Review Status

COMPLETE / REVIEW-READY；实现 commit 为 `bb32349247914061e6ad71989538c995028faeea`，generic recovery provenance follow-up commit 为 `acaf548c048c2948de726208ea4d2a1c1c9b3be3`。D2 独立 review 尚未关闭；D2 review 未关闭时 D3.0 必须 blocked。

### Implementation Evidence

- `ensureInitialFolders()` 统一 seed `inbox`、`literature`、`archive`、`diary`；dev/prod 复用同一 helper，保留 writer ownership、auth、crash recovery、metadata 初始化顺序。
- `POST /api/diary/dates` 只接受严格 `date + timeZone`，按 local civil date 判定 today/past/future；exact path、existing resolve、create-only、并发 no-suffix contract 已实现。
- managed Diary edit/delete 继续走普通 posts lifecycle；rename、move-in、move-out、within-Diary identity mutation、generic create、nested folder create 和 AI bypass 均由 server policy 阻断。generic `/api/recover/*` 对 Diary 缺失目标 fail-closed，即使 path 看起来是 managed date 也不能作为 prior identity proof；History Restore 只有在 server 从指定 Git ref 读到 historical content 后，才允许恢复 exact managed path。任意 unmanaged Diary path 仍拒绝创建。
- invalid/unmanaged external files 保持 generic tree visibility；Archive Soft-Policy、scope、auth/path/filesystem/atomic/history/recovery 安全边界未放宽。
- 未安装 VCalendar，未新增 dependency、Calendar UI、Editor integration 或 Diary database/entity。
- `npm run typecheck` PASS；`npm run build` PASS（提升权限运行，只有既有 Rolldown annotation/large-chunk warnings）；D2 focused lane 的 282/283 测试通过，单独 auth lane 9/9 PASS。并行 auth lane 的 1 个共享 `src/content` `ENOENT` 为环境/测试隔离限制。
- `npm run test:history-integration`：5 files / 172 tests PASS；本 follow-up 的 `server/__tests__/history-routes.test.ts` Git-backed restore lane：70 tests PASS；`npm run test:recovery-integration`：188/193 PASS，5 个既有 atomic symlink 场景因 Windows `EPERM` 为 BASELINE-LIMITED。
- 本 follow-up focused recovery/policy lane：`server/__tests__/documentMutationPolicy.test.ts` + `server/__tests__/diary-routes.test.ts` 为 2 files / 17 tests PASS；`server/__tests__/post.test.ts` 为 16 tests PASS。GitHub CI 未查询；D2 独立 review 尚未关闭。

## 10. D3.0 — VCalendar Compatibility Gate

### Goal

在任何正式 Calendar integration 前，用 Docus 当时精确的 Vue/Vite/TypeScript toolchain 验证 VCalendar candidate 的 dependency resolution、runtime、build、test 和 future custom-rendering seam。

### Preconditions

- D1 和 D2 均 REVIEW-CLOSED。
- 重新读取当时的 package.json、package-lock.json 和实际 Node/browser/Vitest target。
- D3.0 之前没有把 VCalendar import 放入 production Diary code。
- 已确认 candidate resolution 不需要降级 Docus core stack。

### Scope

- 核对官方 Vue 3 package line、npm dist-tags/release、peerDependencies、maintenance status 和 official installation instructions。
- 明确 candidate version/tag 并显式 pin。
- 执行 isolated compatibility spike，不执行完整 Diary integration。
- 验证 MVP 能力和未来 Mood 所需的 day-cell custom rendering seam。
- 输出 PASS、CONDITIONAL PASS 或 FAIL evidence。

### Non-goals

- 禁止直接执行 npm install v-calendar。
- 不在 D0 或 D3.0 之前安装依赖。
- 不在 spike 中接入 Diary create API、Vault lifecycle、History、Recovery、Mood 或 full Calendar styling。
- 不为了保住 VCalendar downgrade Vue、Vite 或 TypeScript。
- 不把 upstream issue report 直接当成 confirmed incompatible。

### Current Repo Seams

- package.json / package-lock.json 是 exact-stack source。
- vite.config.ts、tsconfig.app.json、vitest.config.ts 是 build/type/test target。
- Vue component test 使用 Vitest/jsdom；browser smoke 使用 Playwright。
- Diary production adapter 尚未存在；spike 必须可丢弃或经过 review 才能演进。

### Files to Inspect

- package.json、package-lock.json
- vite.config.ts
- tsconfig.app.json、tsconfig.server.json
- vitest.config.ts
- playwright.config.ts
- Docus current Vue entry/component/test conventions
- VCalendar official package/release/installation/peer dependency metadata（实施时记录 URL、版本和核对日期）

### Expected Files to Modify

- package.json、package-lock.json：只在 candidate 已核对、明确 pin 且 gate 允许安装时修改。
- vite.config.ts、TypeScript/Vitest config：只有真实 candidate integration 需要且经 review 批准才修改，默认不改。
- 兼容性测试/证据文件：按 spike 结果决定是否保留，不把 disposable code 默认当 production。

### New Files

- 可选 disposable spike component/test，例如 src/components/diary/__tests__/vcalendar-compatibility.test.ts 和临时 browser smoke fixture；名称以实施时 convention 为准。
- 可选 compatibility evidence/ADR 文档。
- 不默认保留 disposable demo component；若 spike 能直接演进为 D3.1，必须经过独立 review。

### Detailed Steps

1. 读取 exact Docus stack，不使用“Vue 3”这种宽泛描述。
2. 核对当前官方 Vue 3 VCalendar line、npm dist-tag/release、peerDependencies、maintenance 和 official install docs。
3. 明确 v-calendar@<candidate>（或官方等价 package/tag）；记录选择依据和可能的 @popperjs/core requirement。
4. 只有上述信息明确后，才允许安装 explicit candidate；禁止 unqualified npm install v-calendar。
5. 创建最小 isolated spike，验证 component mount、basic monthly view、previous/next month、attributes、dot、customData、day click、local date adapter、day-content/current official equivalent、locale、mobile/narrow、dark/light、unmount/remount 和 reactive attributes update。
6. 在同一 candidate 上跑 production build、client typecheck、Vitest/jsdom component test 和 browser smoke。
7. 记录 runtime exceptions、console errors、render instability、package resolution 和 exact limitations。
8. 对 upstream issue 只记录为 Known Compatibility Risk，除非 spike 实际复现才升级为 failure。
9. 依照 gate result 决定 D3.1 是否解锁；FAIL 时停止，不写假 production integration。

### Contracts / Invariants

PASS 必须同时满足：

- candidate 在 exact Docus stack 稳定 mount；
- monthly render、prev/next、attributes/dot、dayclick、reactive indicator、locale、narrow/mobile、typecheck、production build、Vitest/jsdom 和 browser smoke 通过；
- day-content 或当前官方等价 custom rendering seam 可用；
- 没有 blocker-level runtime crash；
- 没有降级 Vue/Vite/TypeScript。

CONDITIONAL PASS 只在限制不影响 MVP 且不破坏 future Mood architecture 时允许，并且必须记录：

- exact limitation；
- workaround；
- future impact；
- owner/后续 review point。

FAIL 包括 Vue 3.5 runtime crash、mount 不稳定、attributes/dayclick broken、custom rendering seam unusable、typecheck integration 根本不兼容、build blocker 或 production runtime blocker。FAIL 后 D3.1/D3.2 blocked。

### Tests

Spike 至少验证：

- mount/unmount/remount；
- monthly view、previous/next；
- attributes、dot、customData；
- day click 和 local DiaryDate adapter；
- reactive attributes update；
- day-content/custom day rendering seam；
- locale、narrow/mobile、dark/light；
- Vitest/jsdom component test；
- client typecheck、production build、browser smoke。

D3.0 不测试 Diary create API、History、Recovery、Mood 和 full Calendar product UI；这些属于后续阶段。

### Regression

- 只允许明确 candidate 依赖变更；不修改 Vue/Vite/TS major/minor 来迁就 Calendar。
- domain/server tests 不 import VCalendar。
- D3.0 spike 不能改变现有 Vault、Archive、scope、auth、History 或 Recovery 行为。
- 若保留 candidate dependency，lockfile 必须与 explicit version 一致。

### Validation Commands

以下命令是 D3.0 未来 gate，不是当前 docs-only task 的执行结果：

~~~powershell
# candidate resolution must precede this; never omit the explicit version
npm install v-calendar@<verified-candidate>
npm run typecheck
npm run build
npm exec vitest run <compatibility-test-file>
npm run test:e2e -- <compatibility-browser-spec>
git diff --check
~~~

如 official candidate 要求 @popperjs/core，只能按 official instruction 安装明确版本；不能从旧文档推断所有 candidate 都需要它。

### Evidence

D3.0 报告必须包含：

1. candidate package/version/tag、resolve 日期和选择依据。
2. exact Docus Vue、Vite、TypeScript、@vitejs/plugin-vue、vue-tsc、Vitest、jsdom resolved versions。
3. candidate peerDependencies 和冲突/兼容分析。
4. official release/maintenance/install metadata。
5. spike files、whether disposable/retained、browser environment。
6. 每项 capability 的 PASS/FAIL 和 console/runtime errors。
7. typecheck/build/Vitest/jsdom/browser smoke 结果。
8. PASS / CONDITIONAL PASS / FAIL 结论。
9. exact limitation/workaround/future impact（如 conditional）。
10. D3.1 是否解锁；CI 是否实际查询。

### STOP Conditions

- 只能通过 npm install v-calendar 无版本安装才能继续。
- candidate release line、peerDependencies 或 maintenance status 无法可靠确认。
- 需要 downgrade Vue/Vite/TypeScript。
- basic mount、build、typecheck、dayclick、attributes 或 custom rendering seam blocker。
- spike 需要接入 Diary API、editor 或 Mood 才能通过。
- official limitation 影响 MVP 或 future Mood seam，却只能靠静默 workaround 隐藏。

### Exit Criteria

- candidate explicit pin 和 exact-stack evidence 完整。
- spike required matrix 完整。
- 结论为 PASS，或有完整且安全的 CONDITIONAL PASS。
- 若 FAIL，已停止完整 D3 并创建 Calendar ADR follow-up，D3.1 保持 blocked。
- 独立 review 后 D3.0 REVIEW-CLOSED，然后 STOP。

### Suggested Commit

成功 gate：chore(diary): validate calendar compatibility

失败 gate：只提交 ADR/evidence；不要提交假 production Calendar integration。

### Review Status

初始 NOT STARTED；执行后 COMPLETE / REVIEW-READY；独立 review 后 REVIEW-CLOSED。只有 closure 后 D3.1 才能从 blocked 变为可实施。

## 11. D3.1 — DiaryCalendar Adapter

### Goal

在 D3.0 PASS 或有记录的 safe CONDITIONAL PASS 后，建立可替换、只负责 presentation 的 DiaryCalendar adapter。

### Preconditions

- D3.0 已 REVIEW-CLOSED。
- candidate/version/peer dependency 和 allowed limitation 已写入 evidence。
- D1 domain protocol 可由 adapter 调用，但 adapter 不拥有 domain authority。

### Scope

- 接收 DiaryDay[] 或等价已验证 projection。
- 将 hasDiary 映射成 Calendar attributes/dot。
- 提供 today、month navigation、day click、local date adapter 和 date-selected emit。
- 将 custom day rendering seam 保持为未来 Mood 可扩展，但不实现 Mood。
- 将 VCalendar import 限制在 presentation layer。

### Non-goals

- 不创建 Diary、不读写 filesystem、不保存、不删除。
- 不拥有 editor tabs、route、history、recovery、selection 或 auth。
- 不实现 event cards、time slots、drag、resize、recurrence 或 Mood UI。
- 不把 VCalendar API 泄漏到 shared/、server 或 domain tests。

### Current Repo Seams

- 当前 Vue component convention、useI18n、icons、style tokens 和 test mount helpers。
- D3.0 的 candidate import/config seam。
- D1 的 DiaryDate validator/adapter。

### Files to Inspect

- src/components/、src/components/vault/ 现有 component convention。
- src/composables/useI18n.ts。
- src/style.css 和主题 token。
- src/lib/__tests__、src/components/__tests__ 的 Vue Test Utils/Vitest patterns。
- D3.0 compatibility evidence。

### Expected Files to Modify

- VCalendar candidate import/config 所在的最小 presentation file。
- src/composables/useI18n.ts，仅增加实际需要的中英文 Calendar labels。
- 需要时 src/style.css 的 Calendar wrapper tokens；不做全局 theme rewrite。
- D3.1 component tests。

### New Files

- 推荐 src/components/diary/DiaryCalendar.vue。
- 推荐 src/components/diary/__tests__/DiaryCalendar.test.ts。
- 如需要纯 presentation mapping，可新增 src/components/diary/diaryCalendarAdapter.ts；不要新增 Diary domain authority。

### Detailed Steps

1. 读取 D3.0 evidence，锁定 candidate import 和其 official style integration。
2. 定义 adapter props/events；DiaryCalendar 只接收 validated DiaryDay[] 和 display state。
3. 使用 D1 local date adapter 处理 Calendar date value；禁止 UTC ISO conversion。
4. 映射 existing Diary dates 到 dot/attributes；无 Diary 日期不显示 marker。
5. 接入 today、prev/next、day click 和 accessibility labels。
6. 为 future custom day cell 保留最小 seam；MVP 不输出 Mood。
7. 让 component 在 loading/error/empty state 下保持可控，不把 API 或 editor 调用塞入 adapter。

### Contracts / Invariants

- Adapter 不决定 today/past/future create policy；它只发出 validated date intent。
- day click 输出 DiaryDate，不输出 .md、timestamp 或 arbitrary path。
- hasDiary 映射为 dot/attribute，不渲染 event object/card。
- VCalendar import 只在 component/adapter presentation layer。
- unmount/remount 不泄漏 listener、timer 或 state。

### Tests

- valid DiaryDay 显示 dot；missing Diary 不显示 dot。
- click 输出 validated DiaryDate。
- Today、prev/next、local date conversion。
- reactive DiaryDay[] update。
- custom day rendering seam smoke（不实现 Mood）。
- mobile/narrow render、dark/light class/token、keyboard/accessibility labels。
- loading/error/empty presentation。
- domain/server tests 没有 VCalendar import。

### Regression

- 现有 NavBar scope chips、FileTree、Vault layout、auth routes 和 theme 不回归。
- Calendar adapter 不触发 create/save/delete，不改变 Archive/note/ledger。
- VCalendar failure 可以独立移除，不影响 D1/D2 domain/server files。

### Validation Commands

~~~powershell
npm run typecheck:client
npm exec vitest run src/components/diary/__tests__/DiaryCalendar.test.ts
npm run build
git diff --check
~~~

### Evidence

报告 component public contract、VCalendar import location、test matrix、responsive/accessibility DOM evidence、build/typecheck 结果、changed files 和 D3.2 是否解锁。

### STOP Conditions

- adapter 必须创建/保存/删除 Diary 才能完成。
- VCalendar candidate API 与 D3.0 evidence 不一致。
- 需要把 VCalendar 类型引入 shared/server。
- custom rendering seam 只能通过 Mood MVP 才能验证。
- 需要新增平行 editor/tab/route。

### Exit Criteria

- DiaryCalendar 是纯 presentation adapter，tests 覆盖 required interaction。
- no API/filesystem/editor side effects from adapter。
- typecheck、component test、build、diff check PASS。
- 独立 review 后 REVIEW-CLOSED，然后 STOP。

### Suggested Commit

feat(diary): add diary calendar adapter

### Review Status

初始 BLOCKED（D3.0 未 closure）；D3.0 closure 后 NOT STARTED；实现后 COMPLETE / REVIEW-READY；独立 review 后 REVIEW-CLOSED。

## 12. D3.2 — Monthly Diary Surface

### Goal

把 diary scope 的主要导航表现为 Calendar-first monthly surface，同时保留 FileTree 作为内容、invalid unmanaged files 和清理入口。

### Preconditions

- D3.1 已 REVIEW-CLOSED。
- Diary date projection 的唯一 source 已确定（D2 endpoint 或既有 posts/tree projection），不能维护第二份事实源。
- 当前 VaultView/scope layout seam 已重新审计。

### Scope

- month view、Today、prev/next、existing Diary dot、day click、loading/error/empty states。
- diary scope 进入 Calendar-first surface；FileTree 仍可显示内容和 invalid unmanaged files。
- generic FileTree create/new-folder actions 不能绕过 Diary server/domain invariant。
- 使用现有 scope state、Vault layout 和 i18n，不重构整个 Vault。

### Non-goals

- 不新增 Month Agenda、event card、time slot、drag、resize、recurrence。
- 不用 Calendar 替换整个 FileTree。
- 不实现 openDiaryDate() 的完整 create/editor lifecycle（属于 D4）。
- 不实现 Mood。

### Current Repo Seams

- src/components/NavBar.vue / useScopeFilter.ts 的 diary scope chip。
- src/components/vault/FileTree.vue 的 tree/visibility/create menu。
- src/views/VaultView.vue 的 primary workspace shell。
- D3.1 DiaryCalendar adapter。
- src/lib/api.ts 的 list/tree/authFetch wrappers。

### Files to Inspect

- src/views/VaultView.vue
- src/components/NavBar.vue
- src/components/vault/FileTree.vue
- src/components/vault/ActivityBar.vue
- src/composables/vault/useScopeFilter.ts
- src/composables/vault/editor-tabs/useTabWorkspace.ts
- D3.1 component and tests
- src/style.css

### Expected Files to Modify

- src/views/VaultView.vue 或 current diary-scope surface owner。
- src/components/vault/FileTree.vue，仅调整 diary scope 的 presentation/guard integration；server guard 仍 authoritative。
- src/components/NavBar.vue，仅在 scope surface wiring 需要时修改。
- src/lib/api.ts 或独立 typed projection client。
- src/composables/useI18n.ts、src/style.css。
- D3.2 component/surface tests。

### New Files

- 推荐 src/components/diary/DiaryCalendarSurface.vue，负责 projection/loading/error/empty 和 DiaryCalendar composition。
- 如 current layout 需要独立 state owner，可新增小型 src/composables/diary/useDiaryCalendarData.ts；不得创建 event bus 或 editor lifecycle。

### Detailed Steps

1. 在现有 diary scope selection 下挂载 Calendar-first surface，不新增 /diary 平行 route。
2. 读取 D2/D3.1 定义的 DiaryDay projection，严格过滤 invalid/unmanaged content。
3. 渲染 month view、dots、Today、prev/next、loading/error/empty states。
4. 保留 FileTree 可见性；必要时对 diary root 的 generic create UI 做明确 guard/disabled presentation，但不得只依赖 UI。
5. 将 day click 先发给 D4 planned command seam；D3.2 只负责事件连接和 state presentation。
6. 验证 narrow/mobile 无横向滚动、cell 可用、dot 不是唯一 accessibility signal。
7. 不把日期映射为 event model；保持 DiaryDay 与未来 Mood seam 可扩展。

### Contracts / Invariants

- diary scope 默认 primary surface 是 monthly Calendar。
- FileTree 不完全消失，invalid/unmanaged content 仍能被看到和处理。
- 无 Diary 日期显示日期但无 dot；已有日期显示轻量 dot。
- missing future 不产生 create side effect。
- Calendar 不接受 arbitrary path 作为 identity。
- note、ledger scope 和 Archive behavior 不变。

### Tests

- diary scope selected 时 Calendar surface 可见。
- existing/missing dates marker 正确。
- Today、prev/next、loading/error/empty。
- invalid/unmanaged files 不污染 DiaryDay projection，仍保留 FileTree visibility。
- root/generic create UI 不绕过 policy。
- mobile/narrow DOM、keyboard labels、dot alternative text/aria。
- NavBar scope regression、FileTree ordinary scope regression。

### Regression

- ordinary note/ledger scope layout、FileTree CRUD、search、context menu、Archive action 不回归。
- Calendar surface 不改变 current route/tab/selection；完整 open/create 行为留给 D4。
- no folder re-parent or DiaryEditor introduction。

### Validation Commands

~~~powershell
npm run typecheck:client
npm exec vitest run src/components/diary src/components/__tests__/NavBar.test.ts src/components/vault/__tests__/FileTree.test.ts src/components/vault/__tests__/context-menu.test.ts
npm run build
git diff --check
~~~

### Evidence

报告 diary scope UI、Calendar/FileTree relationship、DOM/accessibility/mobile evidence、projection source、changed files、focused tests/build 结果；D4 remains blocked until review closure。

### STOP Conditions

- 需要新增 /diary editor route 或平行 tab identity。
- Calendar 只能依赖 invalid file deletion/rename 才能渲染。
- 需要修改 global FileTree semantics、scopeProtocol 或 Archive behavior。
- 需要在 surface 中实现 create/open/save，而不是使用 D4 command。

### Exit Criteria

- diary scope Calendar-first monthly surface 可用，FileTree visibility preserved。
- no create/editor side effect from D3.2 surface。
- focused tests、typecheck、build、diff check PASS。
- 独立 review 后 REVIEW-CLOSED，然后 STOP。

### Suggested Commit

feat(diary): add monthly diary navigation

### Review Status

初始 BLOCKED（D3.1 未 closure）；D3.1 closure 后 NOT STARTED；实现后 COMPLETE / REVIEW-READY；独立 review 后 REVIEW-CLOSED。

## 13. D4 — Vault Editor / Lifecycle Integration

### Goal

让 Calendar date intent 通过单一 openDiaryDate(date) command 进入现有 Docus document lifecycle，而不复制 editor/save/history/recovery。

### Preconditions

- D3.2 已 REVIEW-CLOSED。
- D1 domain、D2 server command 和 D3 Calendar surface contracts 已稳定。
- VaultView、useEditorTabs、useDocumentLifecycle、route sync、draft recovery 和 fileChanges seam 已重新读取。

### Scope

- 实现/接入单一 openDiaryDate(date) command。
- validate date -> resolve exact path -> today/past missing create -> future missing no-create -> existing openPost()。
- 复用 current route /vault/diary/YYYY-MM-DD、tab identity、save、History、Recovery、draft selection。
- create/delete/refresh/fileChanges 后同步 Calendar marker。

### Non-goals

- 不创建 DiaryEditor、DiaryTabs、DiarySave、DiaryHistory 或 DiaryRecovery。
- 不新增 /diary/editor/... 或 /diary/:date 平行 route。
- 不建立 Diary event bus、duplicate creation logic 或 custom delete pipeline。
- 不改变 ordinary note/archive/ledger lifecycle。

### Current Repo Seams

- src/views/VaultView.vue 的 openPost、route、editor tabs、lifecycle wiring。
- src/composables/vault/useDocumentLifecycle.ts 的 create/delete/mutation barriers。
- src/composables/vault/editor-tabs/useEditorTabs.ts、useTabWorkspace.ts。
- src/lib/api.ts / potential diary-api.ts。
- src/composables/vault/context/fileChanges.ts。
- src/composables/vault/draft-recovery/serverDocumentResolver.ts、History composables。

### Files to Inspect

- src/views/VaultView.vue
- src/router/index.ts
- src/lib/api.ts
- src/composables/vault/useDocumentLifecycle.ts
- src/composables/vault/useEditorTabs.ts
- src/composables/vault/editor-tabs/useTabWorkspace.ts
- src/composables/vault/editor-tabs/useRouteSync.ts
- src/composables/vault/context/fileChanges.ts
- src/composables/vault/draft-recovery/serverDocumentResolver.ts
- History/recovery composables and their tests

### Expected Files to Modify

- src/views/VaultView.vue 或 current command owner。
- src/composables/vault/useDocumentLifecycle.ts，仅在普通 lifecycle 需要一个 Diary-aware entry seam 时修改；不复制 lifecycle。
- src/composables/vault/editor-tabs/useEditorTabs.ts / useTabWorkspace.ts，仅在 existing open/refresh API 需要 typed integration 时修改。
- src/lib/api.ts 或 D2-specific typed Diary API wrapper。
- src/composables/vault/context/fileChanges.ts，通常不需要修改；若需要必须保持 generic event contract。
- D4 composable/lifecycle tests、VaultView/route tests。

### New Files

- 推荐 src/composables/diary/useDiaryLifecycle.ts 或 current composable convention 下的最小 useDiaryDateCommand.ts，只拥有 openDiaryDate orchestration。
- 推荐 src/lib/diary-api.ts（如果现有 api.ts 不适合增加 date command）及其 focused test。

### Detailed Steps

1. 定义 openDiaryDate(date) 的唯一调用入口；Calendar cell、Today、dot/open action 都调用它。
2. command 使用 D1 validator，不能接收 arbitrary path 或 .md。
3. 先 resolve exact logical path；existing document 直接走 openPost()。
4. missing today/past 调 D2 approved create command，成功后 publish file change/refresh，再走 existing openPost()。
5. missing future 不发 create request，保持 URL/selection policy 与 PRD 一致并给低噪音 state。
6. duplicate click/concurrent UI action 使用 exact path 和 existing mutation lock，不能创建第二个 document。
7. 让 create/delete/fileChanges/refresh 重新生成 DiaryDay projection，避免手工维护第二份 marker state。
8. 保持 existing route /vault/diary/YYYY-MM-DD 和 tab path identity；不加 parallel editor route。
9. 验证 current document delete、save conflict、draft recovery、History 和 selection handling 仍由现有 lifecycle 负责。

### Contracts / Invariants

~~~text
openDiaryDate(date)
  -> validate date
  -> resolve exact logical path
  -> if existing: openPost(path)
  -> if missing today/past: approved create exact path, then openPost(path)
  -> if missing future: no create, no suffix, recoverable UI state
~~~

- Calendar、dot、Today 和 any future Diary entry point 全部复用同一 command。
- create/delete marker 与 fileChanges/tree/posts refresh eventually consistent and testable。
- open existing future allowed；create missing future forbidden。
- route/tab/editor/history/recovery identity remains logical path without .md。

### Tests

- existing date click opens existing post。
- today missing create/open。
- past missing create/open。
- future missing no create。
- existing future open/edit/delete。
- duplicate click/concurrent click no duplicate。
- route updates /vault/diary/YYYY-MM-DD。
- tab identity and current selection update。
- create adds dot; delete removes dot；refresh/external valid file adds dot。
- invalid external file remains visible but no Diary marker。
- History、draft recovery、Crash Recovery、save conflict still work。
- Archive/note/ledger lifecycle unaffected。

### Regression

- ordinary openPost/save/delete/rename/move behavior 不回归。
- useArchiveNote()、Archive collision handling、folder lifecycle、scope filter 不变。
- current authFetch/session expiry and path safety unchanged。
- no new Diary-specific persistence or event bus。

### Validation Commands

~~~powershell
npm run typecheck
npm exec vitest run src/composables/diary src/composables/vault/__tests__/useDocumentLifecycle.test.ts src/composables/vault/editor-tabs/__tests__/useTabWorkspace.test.ts src/views/__tests__/VaultView.test.ts
npm run test:history-integration
npm run test:recovery-integration
npm run build
git diff --check
~~~

### Evidence

报告 command state machine、request sequence、exact physical path listing、route/tab state、marker refresh、History/Recovery/Draft evidence、test/build results、changed files 和 D5 readiness。

### STOP Conditions

- Calendar、Today、dot 出现第二套 create/open logic。
- existing editor lifecycle 不能 safely open date without new editor/save state。
- route/tab identity 必须改成 parallel Diary identity。
- history/recovery 需要 Diary-specific database/pipeline。
- create requires suffix、overwrite 或绕过 current atomic/mutation lock。
- current save/auth/path safety regression。

### Exit Criteria

- single openDiaryDate command powers all entry points。
- create/edit/delete/open/future/route/tab/marker/history/recovery tests pass。
- no new editor/lifecycle architecture。
- typecheck、focused/integration tests、build、diff check PASS。
- 独立 review 后 REVIEW-CLOSED，然后 STOP。

### Suggested Commit

feat(diary): integrate diary dates with vault lifecycle

### Review Status

初始 BLOCKED（D3 未 closure）；D3.2 closure 后 NOT STARTED；实现后 COMPLETE / REVIEW-READY；独立 review 后 REVIEW-CLOSED。

## 14. D5 — Responsive / Release / Closure

### Goal

将 Diary 从功能可用收口为 production-ready：responsive、accessibility、i18n、docs、regression、release evidence 和最终 closure。

### Preconditions

- D4 已 REVIEW-CLOSED。
- D3.0 candidate/gate evidence 可追溯。
- D1/D2/D3.1/D3.2/D4 changed files 和 tests 已 review closed。
- 当前 CI、browser、History、Recovery lane 和 Windows baseline 已审计。

### Scope

- desktop/mobile monthly view、keyboard、screen reader、dark/light、loading/error/empty。
- i18n 文案和 accessibility labels。
- README.md、README.zh-CN.md、docs/user-guide/vault.md、必要时 docs/user-guide/diary.md、相关 architecture docs、CHANGELOG.md。
- unit/server/integration/browser regression、release evidence、最终 closure。

### Non-goals

- 不重新引入 Schedule-X Month Agenda。
- 不新增 Mood MVP、event scheduling、recurrence 或 complex confirmation。
- 不把 dot 作为唯一 accessibility signal。
- 不把 baseline environment failure 伪装成 PASS。
- 不在 release 阶段再扩展 Diary product contract。

### Current Repo Seams

- src/composables/useI18n.ts 的 zh/en string table。
- src/style.css 和 existing theme/layout tokens。
- README.md、README.zh-CN.md、docs/user-guide/vault.md、docs/architecture/document-lifecycle.md、docs/architecture/storage.md、docs/architecture/security.md。
- e2e/ Playwright specs、auth fixture、existing test scripts。
- CHANGELOG.md。

### Files to Inspect

- src/composables/useI18n.ts
- src/style.css
- README.md、README.zh-CN.md
- docs/user-guide/vault.md
- docs/architecture/document-lifecycle.md
- docs/architecture/storage.md
- docs/architecture/security.md
- CHANGELOG.md
- playwright.config.ts、playwright.auth.config.ts
- e2e/fixtures/auth.ts、relevant browser specs
- .github/workflows/ci.yml

### Expected Files to Modify

- src/composables/useI18n.ts。
- src/style.css 或 Diary component scoped style。
- README.md、README.zh-CN.md、docs/user-guide/vault.md。
- docs/user-guide/diary.md：只有当前 docs structure 和内容量证明需要独立 user guide 时新增。
- docs/architecture/document-lifecycle.md、storage.md、security.md：只更新真实受影响的 Diary contract，不复制 PRD。
- CHANGELOG.md。
- Diary browser/unit/integration tests、fixtures、必要的 CI command wiring。

### New Files

- 推荐 e2e/diary.spec.ts 和必要 fixture；文件名按当前 Playwright convention 调整。
- 可选 docs/user-guide/diary.md，不能机械新增。
- 不新增第二套 documentation hierarchy。

### Detailed Steps

1. 在真实 narrow viewport 验证 monthly view、无横向滚动、cell usable、reasonable 44×44 touch targets、Today/prev/next。
2. 验证键盘 focus、screen reader labels、dot 的替代语义、loading/error/empty 和 future missing feedback。
3. 验证 dark/light 不污染全局 theme，不依赖 hover。
4. 审计 useI18n，为 Diary/Today/create/future/error/invalid-unmanaged 文案提供 zh/en；避免大量硬编码英文。
5. 更新用户文档：root reserved、one/day、logical/physical path、today/past/future、普通 editor/history/recovery/delete、managed rename/move restriction；不写成 archive readonly。
6. 更新 architecture/storage/document lifecycle 文档和 CHANGELOG，只反映实际 implemented behavior。
7. 执行完整 regression lanes；对 Windows symlink/EPERM baseline 记录 BASELINE-LIMITED。
8. 如需 CI 变更，先证明 current CI 无法运行新 lane，再独立 review；不通过 continue-on-error 隐藏失败。
9. 形成 final release evidence，等待独立 review 后才将 Diary 标为 COMPLETE / REVIEW-CLOSED。

### Contracts / Invariants

- Desktop/mobile 都是 monthly view，产品模型不变。
- no horizontal overflow；date cell、Today、prev/next usable。
- dot 不是唯一 accessibility signal。
- zh/en 文案齐全且不误导未来日期或 invalid content。
- docs 与 actual implementation、server contract、D3.0 evidence 一致。
- full regression 不改变 Archive、note scope、ledger、auth、path、History、Recovery。

### Tests

- responsive/browser：desktop、narrow/mobile、dark/light、keyboard、screen reader labels。
- Calendar UI：Today、prev/next、dot、loading/error/empty、future missing。
- D4 lifecycle：today/past create/open、existing future、edit/delete、route/tab/marker。
- server/API：root seed、date create、concurrency、guards、invalid external、auth/path。
- History/Recovery integration。
- Archive/note/ledger/scope regression。
- final browser E2E：建议 e2e/diary.spec.ts，按 auth fixture 需求运行。

### Regression

- npm test 三 lane、build、typecheck、browser E2E、auth path、History、Recovery。
- existing FileTree、context menu、search、scope chips、folder transaction、Archive action。
- no security relaxation and no untracked package drift。

### Validation Commands

~~~powershell
npm run typecheck
npm run build
npm test
npm run test:e2e
npm run test:e2e:auth
npm run test:history-integration
npm run test:recovery-integration
git diff --check
~~~

如果完整 npm test 或 browser lane 因已知 Windows symlink/EPERM baseline 受限，报告为 BASELINE-LIMITED，并分开记录真正的 test failure。GitHub Actions 只有实际查询后才能写 CI PASS。

### Evidence

最终报告必须包含：

- phase、commit SHA、changed files；
- implemented contract、tests added/modified；
- 每条 validation command 和 PASS/BASELINE-LIMITED/FAIL；
- responsive/accessibility/i18n/docs evidence；
- auth/path/filesystem/history/recovery regression；
- GitHub CI status（若实际查询）；
- open risks、P0/P1/P2；
- worktree status；
- final next step/closure decision。

### STOP Conditions

- release evidence 发现 PRD contract 仍未实现。
- browser 需要新 route/editor/lifecycle architecture。
- accessibility/mobile 只能通过改变 product model 解决。
- docs 与 actual code/server behavior 不一致。
- full tests 暴露未归因的 P0/P1 regression。
- 需要放宽 auth/filesystem/path/history/recovery safety。

### Exit Criteria

- D1、D2、D3.0、D3.1、D3.2、D4 全部已有独立 closure。
- responsive/accessibility/i18n/docs/release tests 和 regression evidence 完整。
- typecheck/build/relevant tests/browser/History/Recovery 达到 release gate；baseline limitations 已标注。
- final docs/CHANGELOG 与 implementation 一致。
- 独立 review 后 D5 REVIEW-CLOSED，Diary 才能标 COMPLETE / REVIEW-CLOSED。

### Suggested Commit

chore(diary): close responsive release and documentation gate

### Review Status

初始 BLOCKED（D4 未 closure）；D4 closure 后 NOT STARTED；实现后 COMPLETE / REVIEW-READY；独立 review 后 REVIEW-CLOSED。

## 15. Test Matrix

| Phase | Unit / component | Server / integration | Browser / release | Gate |
| --- | --- | --- | --- | --- |
| D0 | none | none | none | git diff --check + docs-only boundary |
| D1 | shared/__tests__/diaryProtocol.test.ts、archive/path regression | none or pure server helper tests | none | typecheck + focused tests |
| D2 | mutation policy/tool safety | seed、Diary route、posts、folders、tree、auth/path、History/Recovery as affected | none required unless route needs browser evidence | server authoritative contract |
| D3.0 | isolated VCalendar Vitest/jsdom spike | dependency resolution/build | browser compatibility smoke | PASS / CONDITIONAL PASS / FAIL |
| D3.1 | DiaryCalendar.test.ts | none | optional component smoke | adapter contract |
| D3.2 | surface/scope/FileTree tests | projection/API tests | responsive/accessibility smoke | monthly surface |
| D4 | command/lifecycle/VaultView/route tests | Diary API + existing lifecycle | create/open/delete/marker flows | editor lifecycle reuse |
| D5 | full relevant unit/component | npm test + history/recovery | Playwright, auth if required | final release closure |

### Command policy

- npm run typecheck = client + server typecheck。
- npm run build = vue-tsc -b + Vite production build。
- npm test = unit + History integration + Recovery integration。
- npm run test:e2e、npm run test:e2e:auth 按 Playwright 配置运行 browser lanes。
- 不能把“命令启动成功”当成 feature PASS；必须对应 test/evidence。
- Windows symlink/EPERM baseline 只能标 BASELINE-LIMITED。
- GitHub CI 状态只有实际查询后才能报告。

## 16. Regression Matrix

| Area | Must remain unchanged |
| --- | --- |
| Archive | root reserved；archive descendants ordinary CRUD；Archive action 默认目标和 collision suffix 不变。 |
| Scope | note = inbox/literature/archive；diary 独立；ledger 独立。 |
| Roots | inbox/literature/archive 原有 protected-root contract 保留；diary 新增 root contract 不扩大其它范围。 |
| Filesystem | relative path、slug、extension、absolute path、..、root escape、symlink/junction confinement。 |
| Auth | Hono auth boundary、authFetch、CSRF/origin、session semantics。 |
| Editor | existing open/save/tab/route/selection；无 DiaryEditor。 |
| Folder | same-parent rename、recursive delete、durable journal/recovery；不新增 Diary folder re-parent。 |
| History | metadata、Git/history commit、restore/diff semantics。 |
| Recovery | crash recovery、draft recovery、current-file selection。 |
| AI | tool safety 和 document mutation policy；无 AI bypass。 |
| UI | FileTree/context menu/search/scope chips、dark/light、accessibility。 |

## 17. Global STOP Conditions

任何阶段发现以下情况，都必须：STOP current phase -> report discrepancy -> propose ADR/PRD follow-up，不得自行扩大 scope：

- PRD assumption 与 current main 不一致。
- 需要新 database schema、Diary entity 或新的 document identity architecture。
- 需要新 Editor lifecycle、parallel route、parallel tabs 或平行 save/recovery。
- 需要 downgrade Vue/Vite/TypeScript。
- VCalendar D3.0 gate FAIL。
- generic filesystem/auth/path security 必须削弱。
- Diary requires root model redesign。
- Mood becomes necessary for MVP。
- folder re-parent suddenly becomes a Diary prerequisite。
- implementation requires changing Archive behavior、useArchiveNote()、note scope 或 ledger semantics。
- current folder transaction/recovery contract 与计划冲突。
- one/day 只能通过 suffix、overwrite 或非原子 workaround 实现。
- invalid external content 只能通过自动删除/隐藏来完成 Calendar projection。
- 需要新增大型 unrelated epic 或修改与 Diary 无关的 closed work。

## 18. Rollback Strategy

| Phase | Rollback boundary |
| --- | --- |
| D0 | docs-only commit 可独立 revert；不涉及 production。 |
| D1 | pure domain helpers/tests 可独立 revert；root protocol rollback 必须同时保留 archive/note regression。 |
| D2 | seed、route、policy guards 分 commit 或可独立回退；不得留下 auth/path/metadata partial state。 |
| D3.0 | compatibility dependency/spike/evidence 独立于 production Calendar；FAIL 时不提交假 integration。 |
| D3.1 | presentation adapter 可整体移除，不影响 D1 domain、D2 server 和 existing editor。 |
| D3.2 | Calendar surface 可移除，FileTree/diary scope content visibility 保留。 |
| D4 | openDiaryDate integration 可回退，不复制/污染 existing lifecycle。 |
| D5 | docs/style/i18n/browser evidence 可独立回退；不通过回退隐藏 domain/server regression。 |

核心目标：Calendar library failure 不能迫使 Diary core protocol、server safety 或 existing editor 一起推翻。

## 19. Evidence Requirements

每个阶段完成后，Codex 必须报告：

1. phase 名称和 review status。
2. commit SHA。
3. changed files / new files。
4. implemented contract 和未实现的 non-goals。
5. tests added/modified。
6. 完整 validation commands。
7. 每条结果：PASS、BASELINE-LIMITED 或 FAIL。
8. GitHub CI status，只有实际查询才填写。
9. open risks。
10. P0/P1/P2。
11. worktree status。
12. next phase remains NOT STARTED 或 BLOCKED。

### D3.0 additional evidence

D3.0 还必须报告 candidate version/tag、resolved peerDependencies、exact Docus stack、official maintenance/install audit、spike capability matrix、console/runtime errors、PASS/CONDITIONAL PASS/FAIL 和 D3.1 unlock decision。

## 20. Commit / Review Boundaries

建议的最小 commit sequence：

1. docs(diary): add implementation plan — 原始 D0，仅新增本文件。
2. docs(diary): close PRD and implementation plan — D0 closure sync；该提交时 D1 尚未开始。
3. feat(diary): establish diary domain protocol — D1，implementation commit 为 `d0a5d4e82e930445bd9e549e27d39e8c18b30819`。
4. feat(diary): enforce diary server lifecycle — D2。
5. chore(diary): validate calendar compatibility — D3.0，只有 explicit candidate/gate evidence；FAIL 时改为 ADR/evidence commit。
6. feat(diary): add diary calendar adapter — D3.1。
7. feat(diary): add monthly diary navigation — D3.2。
8. feat(diary): integrate diary dates with vault lifecycle — D4。
9. chore(diary): close responsive release and documentation gate — D5。

可以因真实 diff 合并小 commit，但不能把 D1 domain、D2 server、D3 Calendar、D4 editor 全塞进一个不可 review 的大 commit。每个 commit 都要有对应 phase evidence，且 phase review 未 closed 不得进入下一阶段。D3.0 gate commit 与正式 Calendar implementation 必须保持不同 review boundary。

## 21. Status Matrix

| Phase | Purpose | Status | Gate |
| --- | --- | --- | --- |
| D0 | PRD + Implementation Plan | REVIEW-CLOSED | independent IP review 已通过；PRD closure status 已同步 |
| D1 | Diary domain protocol | REVIEW-CLOSED | implementation commit `d0a5d4e82e930445bd9e549e27d39e8c18b30819`；independent review P0/P1/P2 = 0 |
| D2 | Root / server / mutation | COMPLETE / REVIEW-READY | D1 REVIEW-CLOSED；等待独立 D2 review |
| D3.0 | VCalendar compatibility | BLOCKED / PENDING | D2 REVIEW-CLOSED |
| D3.1 | DiaryCalendar adapter | BLOCKED | D3.0 PASS/approved CONDITIONAL + REVIEW-CLOSED |
| D3.2 | Monthly Diary surface | BLOCKED | D3.1 REVIEW-CLOSED |
| D4 | Vault lifecycle integration | BLOCKED | D3.2 REVIEW-CLOSED |
| D5 | Responsive / release / closure | BLOCKED | D4 REVIEW-CLOSED |

当前状态为：D0 REVIEW-CLOSED；D1 REVIEW-CLOSED；D2 COMPLETE / REVIEW-READY；D3.0 BLOCKED / PENDING；D3.1、D3.2、D4、D5 均 BLOCKED。D2 尚未独立 review closed，也不代表 VCalendar runtime compatibility 已验证。

## 22. Final Closure Criteria

Diary 只有在以下条件全部满足、每阶段都独立 review closed 后，才能标记 COMPLETE / REVIEW-CLOSED：

- [x] D0 Implementation Plan review closed。
- [x] D1 pure Diary domain、strict date validation、classification 和 root contract closed；implementation commit 和独立 review evidence 已记录。
- [ ] D2 seed、date create、one/day/no suffix、future、edit/delete、rename/move guards、generic/AI/folder bypass guards closed。
- [ ] D3.0 exact-stack VCalendar gate PASS，或有不影响 MVP/future Mood 的 documented CONDITIONAL PASS。
- [ ] D3.1 adapter tests、VCalendar presentation isolation 和 custom rendering seam closed。
- [ ] D3.2 monthly Calendar-first diary surface、FileTree relationship、mobile/accessibility states closed。
- [ ] D4 single openDiaryDate、existing editor/tabs/route、fileChanges、History、Recovery、draft and selection integration closed。
- [ ] D5 responsive、i18n、docs、CHANGELOG、browser/release evidence closed。
- [ ] one date = one Diary；无 collision suffix。
- [ ] logical/physical path and local date semantics unchanged。
- [ ] missing future never creates；existing future remains editable/deletable。
- [ ] managed Diary rename/move/re-parent remains blocked without making subtree globally readonly。
- [ ] invalid/unmanaged external content is preserved and visible outside Calendar projection。
- [ ] no DiaryEditor or parallel lifecycle exists。
- [ ] Archive Soft-Policy、note/diary/ledger scopes unchanged。
- [ ] filesystem/auth/path/CSRF/history/recovery safety unchanged。
- [ ] VCalendar failure path never downgrades Docus core stack。
- [ ] typecheck/build/relevant tests/integration/browser gates have explicit PASS or baseline-limited evidence。
- [ ] GitHub CI status is reported only if actually queried。

本 Implementation Plan 当前完成 D0、D1 closure，并完成 D2 implementation；D2 状态为 COMPLETE / REVIEW-READY，等待独立 review。D3.0 runtime compatibility gate 仍为 PENDING，未安装 VCalendar；这不表示 Diary Calendar 或完整 Diary lifecycle 已实现。
