# D6 — Diary Home Workspace PRD

状态：`D6 = NOT STARTED`；本 PRD 为 `REVIEW-READY`，等待独立 review。

已有 Diary Calendar MVP 的状态保持不变：`D0`–`D5` 全部 `REVIEW-CLOSED`，Diary Calendar MVP 为 `COMPLETE / REVIEW-CLOSED`。本文件只提出新的 D6 产品形态，不重开、不修改 D0–D5 closure。

日期：2026-08-25（Asia/Shanghai）

## 1. Overview

D5 已经把 Diary Calendar 做成可用的 Calendar-first surface。D6 不再继续堆叠 Calendar 功能，而是重新定义 Diary 在 Docus 中的产品形态：

> Diary 不是独立日记 App，而是 Docus 中以日期为入口的 Markdown knowledge workspace。

核心模型：

```text
Diary Home
    │ select date
    ▼
Diary Reader Dialog
    │ edit
    ▼
Diary Editor Dialog
    │ close
    ▼
Diary Home
```

Calendar 是入口，Markdown 文档是内容和知识的 source of truth。D6 只定义产品与生命周期边界，不包含实现代码或 D6 Implementation Plan。

## 2. Motivation

当前 D5 的 Diary 仍然表现为嵌入 Vault 的 Calendar surface：

- Calendar 可用，但 Diary 的视觉权重和独立心智仍然不足；
- 用户进入 Diary 后仍容易把它理解成普通 Vault document page；
- 日期是 Diary 的真正入口，却没有成为完整 workspace 的中心；
- 直接把普通 editor surface 暴露出来，会让 Diary 与 note scope 的产品差异不够清楚。

D6 解决的是 presentation 和 workspace model 问题，不改变 Diary 的数据、路径、权限或文档生命周期 contract。

## 3. Product vision

### 3.1 定位

Diary 是：

> A calendar-first interface for Markdown-based daily records.

用户心智应当是：

```text
今天发生了什么？
        │
        ▼
点击今天
        │
        ▼
打开今天的 Markdown
```

### 3.2 Docus 差异化

D6 借鉴 calendar-diary 类产品的日期入口和月历主页，但不复制独立日记 App 模型。Diary 继续使用 Docus 已有的：

- Markdown 文件和 Vault；
- History 与 Recovery；
- 现有 Editor、保存和 draft 生命周期；
- AI 与知识图谱边界；
- auth、filesystem confinement 和 document identity 安全机制。

Diary 不新增本地数据库日记 entity，不建立 App-specific storage，也不把 Calendar 变成 event/task 系统。

## 4. User journey

### 4.1 进入 Diary

用户进入 `diary` scope 后默认看到 `Diary Home`，而不是普通文档页。Calendar 是主内容，FileTree 可以隐藏或弱化，但不改变 note、archive、ledger 的普通 Vault 布局。

### 4.2 打开已有日期

用户点击已有 Diary 日期：

1. 日期通过唯一的 `openDiaryDate(date)` command 进入现有 Diary date lifecycle；
2. 系统解析同一个 canonical logical path；
3. 已有文档以 Reader Dialog 打开；
4. Reader 中的 Edit action 切换到同一文档的 Editor Dialog。

### 4.3 打开今天或过去的缺失日期

今天或过去日期缺失时，继续使用 D2/D4 已验证的 date-create contract 创建唯一的 `diary/YYYY-MM-DD`，然后打开该文档的 Dialog。D6 不新增第二条 create path。

### 4.4 选择缺失的未来日期

缺失的未来日期仍然不能创建。用户停留在 Diary Home，并收到现有的非破坏性反馈。已经存在的未来 Diary 仍可打开、编辑和删除；D6 不改变这一规则。

### 4.5 关闭 Dialog

关闭 Reader 或 Editor Dialog 后回到 Diary Home：

- 不删除文件；
- 不删除 document identity；
- 不自动关闭对应 editor tab；
- 保留 backing document/tab 和未保存修改；
- 不把 presentation close 当作 tab/document close；
- 再次选择同一天时复用同一个 logical path 和现有 tab/lifecycle 状态。

Dialog 是 presentation state，不是第二套 document workspace。

## 5. Diary Home

Diary Home 是 Diary scope 的默认 workspace surface。

它不是：

- 普通 Vault document page；
- 400px 的小 Calendar card；
- 需要 FileTree 才能理解或操作的文件列表；
- 独立日记 App 的数据库主页。

它应该提供：

- 足够大的月历主区域；
- 清晰的月份标题和前后月份导航；
- Today 定位；
- 已存在 Diary 日期的非颜色唯一标记；
- 可访问的 loading、empty 和 error 状态；
- 从日期直接进入 Reader Dialog 的单一入口。

Diary Home 可以保留少量 scope-level navigation，但不让普通文件树、右栏或第三方 widget chrome 重新夺回主视觉权重。

## 6. Calendar workspace

### 6.1 视觉方向

Calendar 由嵌入式 widget 提升为 Diary workspace 的 primary surface：

- 使用全屏或接近全屏的可用主区域；
- 弱化无意义的 card/container border；
- 强化月份层级和日期可读性；
- 保留 Docus theme、locale 和 dark/light appearance；
- 不把 Diary 日期渲染成事件卡片。

### 6.2 功能范围

D6 继续使用现有 VCalendar adapter 和已验证的 `v-calendar@3.1.2`，支持：

- 月视图；
- 上个月、下个月；
- Today 定位；
- 日期点击；
- 已存在 Diary 日期的 dot/attribute 标记；
- 与本地 civil date 一致的日期显示。

D6 不增加周视图、日视图、时间轴、拖拽改期、event scheduling 或 range selection。

### 6.3 Calendar 生命周期

`ed47c94` 建立的 keep-mounted + `v-show` presentation workaround 继续是 D6 的兼容性约束。打开 Dialog 时 Calendar 可以被隐藏，但不能因为同步 click/unmount 重新引入已关闭的 VCalendar `dayIndex` regression。隐藏状态必须同时满足可访问性要求，不能让不可见 Calendar 继续接受键盘焦点。

## 7. Diary Reader Dialog

Reader Dialog 是日期文档的阅读入口，不是普通小弹窗。

### 7.1 Presentation

- 使用 fullscreen 或 large overlay，目标是覆盖约 90%–100% viewport；
- 视觉上接近 Notion popup page、Linear detail view 或 Apple Calendar detail，而不是后台管理 modal；
- 背景 workspace 保持上下文但不能抢夺焦点；
- 关闭后回到同一个 Diary Home 月份和用户之前的 focus 位置。

### 7.2 内容

Header 至少包含：

- Diary 日期；
- Dialog Header Back/关闭 Dialog；
- Edit action。

正文复用现有 Markdown renderer/ReadingPane seam。D6 不创建 `DiaryReader`、第二套 Markdown parser 或新的 link/wiki rendering pipeline。

### 7.3 Reader 到 Editor

Edit action 只改变同一个 document identity 的 presentation mode。它不能重新创建文件、重新分配 tab identity 或绕过现有 save/history/recovery 生命周期。

## 8. Diary Editor Dialog

Editor Dialog 是现有 Docus Editor 的 Dialog presentation adapter。

必须复用：

- 现有 `EditorPane`/Monaco editor；
- `useEditorTabs`、`useTabWorkspace` 和现有 tab identity；
- `useDocumentLifecycle` 的保存、删除、重命名和 selection 协作；
- `fileChanges`、refresh、History、Recovery 和 draft persistence；
- 现有 shortcut、dirty state、冲突处理和保存反馈。

明确禁止：

- `DiaryEditor`；
- 第二套 Markdown parser；
- 第二套 save pipeline；
- 第二套 History/Recovery；
- 第二套 shortcut 或 mutation lock；
- 以 Dialog 为理由创建 parallel route/tab/editor architecture。

Editor Dialog 可以隐藏普通 Vault 的部分外围 chrome，但不能改变 editor 的数据所有权。Dialog close 只隐藏 presentation，保留 backing tab、active document 和 dirty state，不触发 dirty-document confirmation。只有 existing lifecycle 真正关闭 tab/document 时，才沿用既有 dirty/unsaved contract；不得静默丢弃用户修改。

## 9. Lifecycle model

### 9.1 单一 command ownership

`openDiaryDate(date)` 继续是 Calendar、Today、日期标记和未来其它日期入口共用的唯一 command。Calendar、Reader Dialog 和 Editor Dialog 都不直接拥有 server create/open API。

当前 D4 链路：

```text
openDiaryDate(date)
  ├─ resolve exact Diary path
  ├─ open existing document
  └─ create missing today/past, then openPost()
```

D6 的目标链路：

```text
openDiaryDate(date)
  ├─ ensure the existing D2 Diary contract
  ├─ reuse existing document identity/tab
  └─ hand presentation to Diary Reader Dialog
       └─ Edit → existing Editor lifecycle in Dialog
```

如果后续实现需要名为 `ensureDiary()` 的内部步骤，它只能是上述 command 的内部 orchestration，不得成为新的公开 create entry point，也不得绕过 server authority、future guard、exact-path lock 或 create-only semantics。

### 9.2 Identity and tab rules

- `DiaryDate` 仍是日期 identity；logical path 仍是 `diary/YYYY-MM-DD`；physical path 仍由既有 global mapping 产生 `.md`；
- 一天最多一个 Diary，不使用 collision suffix；
- Dialog open/close 不创建第二个 document identity；
- Dialog close 不等于 `closeTab()`；
- Dialog close 不改变 `activePath`，也不要求 route 离开 backing document；
- 已打开的 Diary tab 可以作为 Dialog 的 owner/ backing state，但不能迫使用户看到普通 Vault document page；
- note、archive、ledger 的 tab 和 layout 行为不因 D6 改变。

## 10. State machine

### 10.1 Product states

```text
DiaryHome
    │ select date
    ▼
DiaryReaderDialog
    │ edit
    ▼
DiaryEditorDialog
    │ close
    ▼
DiaryHome
```

### 10.2 Transitional states

`select date` 后允许存在短暂的 loading、create、error 或 future-missing feedback，但这些是 command transition/substate，不是第二套 Diary lifecycle：

```text
DiaryHome
  └─ date intent pending
       ├─ existing → DiaryReaderDialog
       ├─ today/past missing → exact create → DiaryReaderDialog
       ├─ future missing → DiaryHome + feedback
       └─ error → DiaryHome + recoverable error
```

### 10.3 Close semantics

- Reader close：回到 `DiaryHome`，恢复 Calendar 上下文和 focus；
- Editor Dialog close：只关闭 presentation，回到 `DiaryHome`，保留 backing tab/document 和 dirty state；
- Document/Tab close：仍由 existing lifecycle 处理，只有这条路径才走既有 dirty/unsaved confirmation；
- close 不删除 document identity，不清空 History/Recovery，不绕过 tab persistence；
- Dialog Header Back、Escape 和显式 Close 归一到同一个 presentation close policy；Browser Back 不属于该 policy，由 existing router/history lifecycle 处理。

## Browser History Boundary

D6 Dialog presentation state 不拥有 browser history，也不等同于 router state。必须把以下两类动作分开：

D6 不新增 `/diary`、`/diary/:date` 或 `/diary/:date/edit` route。现有 `/vault` 与 `/vault/:pathMatch(.*)*` 继续是 Vault router 的 ownership boundary。

Dialog-local presentation actions：

- Explicit Close；
- Escape；
- Dialog Header Back。

它们统一进入 `DiaryWorkspace` 的 presentation close policy：隐藏 Reader/Editor Dialog、回到 Diary Home，并恢复合适的 focus context。它们不得主动调用 `router.back()`、`router.replace('/vault')`、`closeTab()`，不得改变 `activePath`，也不得触发 dirty discard confirmation。

Browser Back 不等同于 Dialog Close，继续由现有 Vue Router 和 Vault document lifecycle 拥有：

```text
Browser Back
    ↓
Vue Router history transition
    ↓
current Vault route changes
    ↓
existing route/pathMatch sync and tab/document reconciliation
    ↓
DiaryWorkspace observes the resulting state and reconciles presentation
```

DiaryWorkspace 不能拦截或劫持 `popstate`，不能 `preventDefault` browser Back，不能为 Dialog 创建 fake history entry，不能把 Dialog state 写入 URL，也不能用 router navigation 模拟 Dialog Close。现有 `/vault` 与 `/vault/:pathMatch(.*)*` router ownership、route sync、`openPost()` 和 `useTabWorkspace()`/existing tab lifecycle 保持不变。

一个有意接受的 D6 MVP 状态是：当 backing document 为 `diary/2026-08-25` 时，route 可以仍为 `/vault/diary/2026-08-25`，backing tab 和 `activePath` 也仍指向该文档，而视觉上已经显示 Diary Home。这是 presentation state 与 document route state 分层的结果，不是要求通过 `router.replace('/vault')` 修正的 bug。

因此 D6 允许：

```text
Route represents backing document
while
Diary Home is currently presented
```

refresh 时，Dialog state 因为不写入 URL，不承诺恢复 Reader 或 Editor Dialog；refresh 后的 document restoration 继续由现有 Vault route/document lifecycle 决定。未来若需要 Dialog restoration、Reader deep-link、Editor deep-link 或 shareable Diary URL，必须另立 ADR。

三层 ownership 必须保持：

| Layer | Owner | Responsibility |
| --- | --- | --- |
| Router state | existing Vue Router | `/vault`、`/vault/<path>` 和 browser history |
| Document lifecycle | existing Vault tabs/editor lifecycle | `tabs`、`activePath`、document model、save、dirty、History、Recovery 和 route reconciliation |
| DiaryWorkspace presentation | D6 presentation layer | Home、Dialog visibility、Reader/Editor mode 和 focus context |

第三层只能观察并 reconcile 前两层产生的最终状态，不能驱动 router 来模拟自身 presentation state。

## 11. Relationship with Vault and scopes

Diary Home 不依赖 FileTree 才能作为主入口。Diary 模式下 FileTree 可以隐藏或弱化，但它仍然是既有内容、invalid/unmanaged Diary 内容和清理操作的辅助入口，不能被当作新的 Diary data store。

范围边界保持不变：

| Scope | Contract |
| --- | --- |
| `diary` | Diary Home + date-oriented Markdown workspace |
| `note` | `inbox`、`literature`、`archive` 的现有 Vault 行为 |
| `ledger` | 现有 ledger 语义 |

禁止全局隐藏 FileTree、重做 Vault grid、修改 Archive Soft-Policy 或把 Diary 加入 `note` scope。

## 12. Responsive behavior

### 12.1 Calendar Home

D6 继承 D5 已验证的 Calendar-first responsive contract：

- 320px 和 375px 日期 touch target 不低于既有 gate；
- 不引入横向滚动来换取日期宽度；
- Activity Bar、Calendar 主区域和必要的 scope navigation 在窄屏保持可用；
- Diary Home 下 FileTree 可隐藏/折叠，但离开 Diary 或打开普通 note 后恢复普通 Vault 行为；
- 768px 与 desktop 不因手机策略而意外隐藏或破坏普通 FileTree。

### 12.2 Dialog

- Desktop Reader/Editor Dialog 使用大面积 overlay；
- Mobile Reader/Editor Dialog 使用接近 fullscreen 的布局，并处理 safe-area inset；
- Dialog 内 editor 不缩放到不可用尺寸；
- 背景 Calendar 不横向溢出，隐藏时不进入 accessibility tree；
- dialog close 后 Calendar Home 恢复，不要求刷新页面或重新加载 Diary scope。

## 13. Accessibility

D6 必须继承并扩展 D5 已验证的 keyboard、ARIA 和 focus safety contract，但不宣称完整 WCAG certification。

最低要求：

- Reader/Editor Dialog 有稳定的 accessible name 和 `dialog`/modal 语义；
- 打开后 focus 进入 Dialog，关闭后 focus 返回触发日期或 Today 控件；
- 背景 Diary Home 在 Dialog 打开期间不可通过键盘误操作；
- Escape、显式 Close、Dialog Header Back 都有一致且可预测的 presentation close 行为；Browser Back 则按 router/history transition 处理；
- 日期、Today、previous、next 和 Edit 均可用键盘操作；
- Diary-exists 不能只依靠颜色，保留文本/ARIA 语义；
- loading、create、future-missing、error 状态以 live region 或等价方式传达；
- Editor 的已有快捷键、dirty confirmation 和焦点管理不被 Dialog adapter 截断；
- reduced-motion 用户不会被强制播放不必要的过渡。

## 14. Data and security boundaries

D6 不改变 D1/D2/D4 已关闭的 domain/server contract：

- `DiaryDate`、`diary/YYYY-MM-DD` logical path、`.md` physical mapping 和 one-day-one-diary 不变；
- 不把日期转换为 UTC timestamp，也不通过 `toISOString()` 推导本地 Diary 日期；
- 缺失 future 仍不可创建，existing future 仍可编辑；
- server date API、document mutation policy、AI mutation guard 和 auth boundary 继续是 authoritative；
- Dialog 不能绕过 path normalization、absolute path rejection、root escape protection、symlink/junction confinement、auth、CSRF/origin、atomic write、lock、History 或 Recovery；
- Markdown 文件仍是 source of truth，不新增数据库日记 entity 或外部同步身份；
- Dialog close 不能被解释为删除、archive、history commit 或 recovery mutation。

## 15. Future frontmatter extension

D6 可以在产品文档中保留未来 metadata seam，例如：

```yaml
---
mood:
weather:
energy:
tags:
---
```

这些字段不是 D6 MVP contract。D6 不实现 Mood、weather、energy、habit 或统计 UI，也不改变当前 Diary filename identity。未来 metadata 必须继续存储在 Markdown/frontmatter 语义内，并经过单独 phase 的 domain、migration 和 security review。

## 16. Non-goals

D6 不包含：

- Mood tracking、emotion statistics 或 sentiment analysis；
- Task management、habit tracker 或 reminders；
- Calendar events、时间段、周视图、日视图、timeline 或 agenda；
- Photo diary、attachments-first diary 或独立媒体存储；
- Timeline、year review、year view、summary、AI summary 或统计 dashboard；
- Diary-specific tags system；
- 独立 Diary database、UUID entity 或 local-only persistence；
- 新的 Diary Reader/Editor、save/history/recovery/shortcut pipeline；
- Calendar library replacement、VCalendar upgrade 或 Schedule-X/FullCalendar 引入；
- 全局 Vault layout redesign；
- Archive、note、ledger、filesystem、auth 或既有 D0–D5 contract 的重新定义。

## 17. Migration from D5

| 维度 | D5 baseline | D6 target |
| --- | --- | --- |
| Diary entry | Calendar-first surface embedded in Vault | Diary Home workspace |
| Calendar role | Primary content of an empty Vault area | Primary workspace surface |
| Date open | `openDiaryDate()` → existing `openPost()`/editor tab | `openDiaryDate()` → existing date contract → Reader Dialog |
| Edit | Existing editor surface | Existing editor lifecycle presented in Editor Dialog |
| Document identity | `diary/YYYY-MM-DD` | unchanged |
| History/Recovery | existing Vault lifecycle | unchanged |
| VCalendar | approved `v-calendar@3.1.2` adapter | unchanged |
| Mobile | D5 touch-target and no-overflow evidence | reused; no regression allowed |

D6 不需要数据迁移、文件重命名或 route identity migration。实现阶段应保留 D5 presentation fallback：如果 Dialog/Editor integration 发现生命周期或兼容性回归，可以回退到 D5 Calendar-first surface，而不回退任何 Diary 文件或 server contract。

## 18. Risks

| ID | Risk | Mitigation / product boundary |
| --- | --- | --- |
| R1 | Editor lifecycle duplication | 只使用现有 Editor、tab、save、History 和 Recovery；禁止 `DiaryEditor`。 |
| R2 | Dialog state 与 tab/route lifecycle 冲突 | `openDiaryDate()` 保持单一 command ownership；Dialog close 是 presentation-only，不改变 route、`activePath` 或 tab identity；Browser Back 仍由 router/history 和 existing lifecycle 处理。 |
| R3 | Calendar mounted lifecycle regression | 保留 `ed47c94` keep-mounted + `v-show` workaround；任何 ownership 变化都必须通过真实 click/open/close browser evidence。 |
| R4 | 320/375 mobile usability 回归 | 复用 D5 touch-target、no-overflow、keyboard 和 focus evidence；D6 不用小 modal 替代 fullscreen dialog。 |
| R5 | Diary 演变成独立 App | Markdown/Vault/History/Recovery/AI 继续是系统 source of truth；不新增 diary database 或 app-specific storage。 |
| R6 | Reader/Editor presentation close 造成数据丢失 | Dialog close 保留 backing tab、dirty state、draft 和 Recovery，不触发 discard；只有 existing tab/document close 才复用既有 dirty confirmation。 |
| R7 | Dialog 与 browser history ownership 冲突 | Dialog Header Back、Escape、Explicit Close 只走 presentation close policy；Browser Back 保持 router-owned，DiaryWorkspace 只 reconcile resulting route/document state。 |

## 19. Acceptance criteria

以下是 D6 实现与 release review 的目标 criteria，不是本 docs-only PRD 的已完成 evidence：

- [ ] Diary Home 的默认入口是 Calendar-first workspace，而不是普通 document page。
- [ ] Calendar 是 Diary Home 的 primary surface，不再表现为小型第三方 widget card。
- [ ] 日期是唯一的 Diary content entry point；月视图、月份导航、Today、日期点击和已有日期标记保留。
- [ ] Reader 使用 fullscreen/large Dialog，并复用现有 Markdown renderer。
- [ ] Editor 使用现有 Editor lifecycle 的 Dialog presentation adapter。
- [ ] 不存在 `DiaryEditor` 或第二套 Markdown/save/History/Recovery/shortcut pipeline。
- [ ] `openDiaryDate()` 仍是唯一日期 command；任何 `ensureDiary()` 只能是内部步骤，不能成为旁路 API。
- [ ] one day one Diary、exact identity、future missing guard、local civil date semantics 和 path mapping 不变。
- [ ] Dialog close 不删除 document identity、不关闭 tab、不改变 route/`activePath`、不触发 dirty discard，并返回 Diary Home。
- [ ] Dialog Header Back、Escape、Explicit Close 统一为 presentation close；Browser Back 保持 existing Router/history ownership。
- [ ] Browser Back 不被拦截，不创建 Dialog history entry，不调用 `router.back()` 或 `router.replace('/vault')` 模拟 Dialog Close。
- [ ] backing route 可以保留文档 URL，而 Diary Home 作为当前 presentation；两者暂时不一致是有意的 D6 MVP 行为。
- [ ] refresh 不承诺恢复 Dialog；Reader/Editor deep-link 需要独立 ADR。
- [ ] History、Recovery、draft、auth、filesystem/path safety 和 AI mutation guard 不变。
- [ ] VCalendar `3.1.2`、现有 adapter 与 `ed47c94` workaround 不变。
- [ ] 320/375 touch target、no horizontal overflow、keyboard、ARIA 和 hidden Calendar focus safety 不回归。
- [ ] Diary-only FileTree 隐藏/弱化行为可恢复；note、archive、ledger 的 Vault layout 不变。
- [ ] Markdown remains the source of truth；没有独立 diary database/entity/storage。
- [ ] Mood、Task、Photo、Timeline、Summary、Year view、Statistics 等 non-goals 没有被偷偷纳入。
- [ ] D6 通过独立 review 后才允许进入下一阶段；本 PRD 不自动启动 D6 implementation。

## 20. Implementation boundary and status

本文件只定义 D6 产品契约。D6 Implementation Plan 独立维护，不能用 PRD 代替施工计划，也不能由本文件授权直接修改 Editor 或 Vault architecture。

实现前必须再次核对现有 seam，包括但不限于：

- `src/components/diary/DiaryCalendar.vue` 与 `DiaryCalendarSurface.vue`；
- `src/views/VaultView.vue` 的 Diary scope、Calendar mounted/visibility 和 existing tab/editor ownership；
- `src/composables/diary/useDiaryDateCommand.ts`；
- `src/composables/vault/useEditorTabs.ts`、`useTabWorkspace.ts`、`useDocumentLifecycle.ts`；
- `src/components/vault/ReadingPane.vue`、`EditorPane.vue` 和 `EditorTabs.vue`；
- `shared/diaryProtocol.ts`、`server/routes/diary.ts` 与现有 mutation/auth/path boundaries。

最终状态：

```text
D0–D5                 REVIEW-CLOSED
Diary Calendar MVP    COMPLETE / REVIEW-CLOSED
D6 PRD                REVIEW-READY / pending independent review
D6 implementation     NOT STARTED
Future Mood/Task/etc. NOT STARTED / non-MVP
```

本 PRD 不修改已有 Diary Calendar MVP closure；D6 Implementation Plan 继续作为独立的施工计划维护。
