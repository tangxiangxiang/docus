# D6 — Diary Home Workspace Implementation Plan

状态：

- D0–D5：`REVIEW-CLOSED`
- Diary Calendar MVP：`COMPLETE / REVIEW-CLOSED`
- D6 PRD：`REVIEW-READY`
- D6 Implementation Plan：`REVIEW-READY`
- D6 implementation：`NOT STARTED`

本文件是 D6 Diary Home Workspace 的施工计划，不是实现结果。每个阶段都必须在独立 review 通过后，才能进入下一阶段；本文件本身不会启动 D6 implementation。

## 1. Overview

D6 是一次 Diary workspace presentation migration：把 D5 的 Calendar-first surface 从 Vault 中的空状态 Calendar，升级为以 Calendar 为主入口的 Diary Home，并在日期选择后以大面积 Reader Dialog / Editor Dialog 呈现同一个 Markdown document。

目标结构：

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

D6 不重新设计 Diary domain，也不创建新的文档系统。Calendar 负责日期入口和 presentation；Markdown 文件继续是 source of truth；`openDiaryDate()` 继续是唯一日期 command；Reader 和 Editor 都是现有 Docus document lifecycle 的 presentation adapter。

本计划的第一项工作不是直接新增 Dialog，而是确认当前 `DiaryCalendarSurface`、`VaultView`、`useDiaryDateCommand`、existing tab workspace、Reader 和 Editor 之间的 ownership。若无法在不复制 lifecycle 的情况下建立 adapter，必须停止并重新评估架构，而不是在 D6 中创建第二套 Editor。

## 2. Goals

### 2.1 Product goals

- Diary scope 的默认入口是 Diary Home，而不是普通 document page。
- Calendar 是 Diary Home 的 primary surface，保留 D5 已验证的月视图、Today、月份导航、日期点击和 Diary marker。
- 已有日期可进入 Reader Dialog；Reader 的 Edit action 可进入 Editor Dialog。
- Reader Dialog 和 Editor Dialog 使用 fullscreen 或接近 fullscreen 的 presentation，不退化为小型后台 modal。
- Dialog close 返回 Diary Home，保留月份上下文、focus context 和 document identity。

### 2.2 Architecture goals

- `openDiaryDate()` 仍是 Calendar、Today 和其它日期入口共用的唯一 command owner。
- Reader 复用现有 Markdown renderer/reading seam；Editor 复用现有 `EditorPane`/Monaco、tabs、save、History、Recovery、draft 和 dirty-state lifecycle。
- D6 只增加 Diary presentation orchestration，不把 server mutation、document identity、auth 或 filesystem policy 放进组件。
- 保留 D5 的 `ed47c94` keep-mounted + `v-show` workaround，避免 Calendar 因日期 click 后同步卸载再次触发 VCalendar `dayIndex` regression。
- note、archive、ledger 和普通 Vault document layout 不受 D6 影响。

### 2.3 Delivery goals

- D6.0 先形成可评审的 ownership 和 adapter boundary。
- D6.1–D6.6 每阶段有 focused evidence 和独立 gate。
- 任一 Dialog 阶段失败时，能够回退到 D5 Calendar Home，而不回退 Diary 文件、server contract 或 D4 lifecycle。
- D6 release 只在实现、回归、响应式、可访问性和 independent review 全部具备 evidence 后关闭。

## 3. Non-goals

D6 不包含：

- 修改 `DiaryDate`、`shared/diaryProtocol.ts`、logical/physical path 或 one-day-one-diary contract；
- 修改 server Diary API、document mutation policy、auth、filesystem confinement、atomic write 或 mutation lock；
- 创建 `DiaryEditor`、`DiaryReader` 或第二套 Markdown/save/History/Recovery/shortcut pipeline；
- 创建 `openDiaryEditorDate()`、parallel command system、parallel route 或独立 Diary tab identity；
- 替换或升级 VCalendar，不重新选择 Schedule-X、FullCalendar 或自研 Calendar；
- 修改 `v-calendar@3.1.2` 或删除 `ed47c94` keep-mounted workaround；
- Mood、Task、Habit、Emotion、Photo、Timeline、AI summary、Year view、Agenda、Statistics 或 Diary-specific tags；
- Calendar event scheduling、时间段、拖拽改期、周视图、日视图或 range selection；
- 独立 Diary database、UUID entity、local-only persistence 或非 Markdown source of truth；
- 全局 Vault grid redesign、全局隐藏 FileTree、Archive Soft-Policy 变化或 scope model 变化；
- 数据迁移、文件重命名、route identity migration 或新的 D7 phase；
- 在本计划阶段修改任何 production code、tests、package、lockfile 或 dependency。

### Future Consideration: Recent Diaries

未来 Diary Home 可以在 Calendar 之外提供轻量的 Recent Diaries 列表，用于快速回到最近访问或最近编辑的 Markdown Diary。它必须继续读取现有 document/tree/history 语义，不应成为新的 Diary storage 或 identity system。

Recent Diaries 不属于 D6 MVP，不在本计划中实现，也不自动启动 Task、Mood、Timeline 或 Statistics 等其它产品方向；任何后续扩展都需要单独的产品/架构 review。

## 4. Architecture

### 4.1 Current D5 seams to preserve

实现 D6.0 时必须以当前 main 的真实实现为准，重新确认以下 seam：

| Existing seam | Current responsibility | D6 boundary |
| --- | --- | --- |
| `DiaryCalendar.vue` | VCalendar adapter、month navigation、Today、attributes、local civil date、day click | 继续只负责 Calendar presentation 和 `DiaryDate` intent，不拥有 document lifecycle |
| `DiaryCalendarSurface.vue` | Diary tree projection、empty/loading/error presentation、Calendar composition | 可被 Diary Home 复用或迁移，但不直接调用 API、router、`openPost()` 或 mutation |
| `VaultView.vue` | scope、Vault shell、Calendar mounted/visibility、route、tabs、History/Recovery、existing editor ownership | D6 必须缩小 presentation coupling，而不能复制其 document ownership；保留 keep-mounted seam |
| `useDiaryDateCommand.ts` | 日期校验、exact path、existing open、today/past create、future-missing guard、busy/error feedback | 继续是唯一 `openDiaryDate()` command owner；Dialog 不绕过它 |
| `useEditorTabs` / `useTabWorkspace` | tab identity、load、active document、save/close、route sync、persistence | Editor Dialog 只消费并呈现现有 workspace state |
| Reading/Markdown seam | 现有 Markdown rendering、links、TOC 和 reading behavior | Reader Dialog 使用现有 renderer，不复制 parser 或 link pipeline |
| `EditorPane` / Monaco seam | Markdown editing、model、shortcuts、dirty changes、save integration | Editor Dialog 使用现有 Editor surface，不创建 Diary-specific editor |

D6.0 必须确认实际文件和调用关系没有偏离上表。表中的文件名是审计 seam，不是预先批准的大范围修改清单。

### 4.2 Target presentation architecture

目标组件关系：

```text
DiaryWorkspace
        │
        ├── Calendar Surface
        │
        └── Dialog Controller
                │
                ├── Reader Dialog
                │       │
                │       └── Existing Markdown Renderer
                │
                └── Editor Dialog
                        │
                        └── Existing Editor
```

其中 `Dialog Controller` 只负责 presentation：Dialog visibility、selected DiaryDate、Reader/Editor mode、focus handoff 和 close policy。它不是 document engine，不拥有 document identity、raw content、save、History 或 Recovery。

目标架构分为四层：

```text
Diary Home / Workspace presentation
        │ owns visible mode, dialog shell, focus context
        ▼
Existing Diary date command
        │ owns validation, exact path, create/open decision
        ▼
Existing document/tab/editor lifecycle
        │ owns identity, raw content, save, history, recovery, dirty state
        ▼
Markdown file in the existing Vault
```

可以新增一个 Diary workspace presentation host（例如概念上的 `DiaryWorkspace`），但它只能承载：

- Calendar host；
- Reader/Editor Dialog visible state；
- selected date/path 的 presentation state；
- open/close focus handoff；
- Diary-only responsive and accessibility attributes。

它不得承载：

- server create/open/save/delete；
- logical path 生成或日期合法性；
- document identity 分配；
- tab persistence；
- History/Recovery transaction；
- auth、path normalization 或 mutation policy。

### 4.3 Data and command flow

日期入口统一走以下逻辑：

```text
Calendar / Today / marked date
        │
        ▼
openDiaryDate(date)
        │
        ├─ existing managed Diary → existing open path
        ├─ missing today/past → approved exact create → existing open path
        ├─ missing future → no create + recoverable feedback
        └─ invalid/error → no document transition + feedback
        │
        ▼
same logical path + same tab/document identity
        │
        ├─ Reader Dialog presentation
        └─ Editor Dialog presentation
```

如果未来需要 `ensureDiary()`，它只能是 `openDiaryDate()` 内部的 orchestration。它不能成为组件可调用的新公开 API，也不能绕过 D2 server authority、future guard、exact-path lock、create-only semantics 或 existing open lifecycle。

### 4.4 Calendar mounted lifecycle boundary

Calendar 的 mounted ownership 是 D6 的硬约束：

- Diary Dialog 打开时可以隐藏 Calendar，但不能因同步 click 触发 parent unmount；
- `ed47c94` 的 keep-mounted + `v-show` strategy 必须保留，除非未来出现有独立证据支持的等价实现，并由 compatibility review 单独批准；
- hidden Calendar 必须从 accessibility tree 和 keyboard navigation 中安全退出；
- Dialog close 后 Calendar 必须恢复同一个月视图和可用 focus context；
- 不允许用 `nextTick`、定时器或偶然的 scheduler timing 作为未经验证的生命周期修复。

### 4.5 Identity and source of truth

- `DiaryDate` 仍是 local civil calendar date，不转换为 UTC timestamp；
- logical identity 仍为 `diary/YYYY-MM-DD`，physical mapping 仍由既有 global path layer 产生 `.md`；
- 一天最多一个 Diary，不使用 Archive 的 collision suffix；
- Reader 与 Editor 只呈现同一个 document identity；
- close Dialog 不等于 close tab，不等于 delete document，不等于 history commit，也不等于 recovery mutation；
- Markdown 文件仍是唯一 source of truth。

## URL and Routing Strategy

D6 MVP 不改变现有 Vault router contract。Diary Home 继续作为现有 Vault scope/presentation 的一部分呈现；D6 不新增：

- `/diary`；
- `/diary/:date`；
- `/diary/:date/edit`；
- 新的 Diary route lifecycle；
- 由 URL 直接触发的第二套 create/open/editor command。

现有 Vue Router 继续拥有：

- `/vault`；
- `/vault/:pathMatch(.*)*`。

现有 route/pathMatch 到 document/tab 的同步与 reconciliation、`openPost()`、tab persistence 和 `useTabWorkspace()`/existing workspace lifecycle 仍按 D4/Vault contract 工作。Dialog 的打开、关闭和 Reader/Editor mode 不会被编码成新的 Diary URL。

如果未来需要 Diary entry deep-link、可分享 Reader URL 或刷新后恢复 Dialog，必须先建立独立 ADR，明确 URL、auth、dirty state、future-missing 和 History/Recovery 的交互；不能在 D6 MVP 中隐式加入。

## Browser History Boundary

D6 Dialog presentation state 不拥有 browser history，也不等同于 router state。必须把 Dialog-local presentation actions 与 browser history navigation 分开。

Dialog-local actions 只有：

- Explicit Close；
- Escape；
- Dialog Header Back。

三者统一进入 `DiaryWorkspace` presentation close policy：隐藏 Reader/Editor Dialog、回到 Diary Home，并恢复合适的 focus context。它们不得主动调用 `router.back()`、`router.replace('/vault')`、`closeTab()`，不得改变 `activePath`，也不得触发 dirty discard confirmation。

Browser Back 继续属于 existing Vue Router 与现有 document/tab lifecycle：

```text
Browser Back
    ↓
Vue Router history transition
    ↓
current Vault route changes
    ↓
existing route/pathMatch sync
    ↓
existing openPost()/tab/document lifecycle reconciliation
    ↓
DiaryWorkspace observes the resulting state and reconciles presentation
```

DiaryWorkspace 不能 `preventDefault` browser Back，不能拦截或劫持 `popstate`，不能为 Dialog 创建 fake history entry，不能把 Dialog state push 到 URL，也不能用 `router.back()` 模拟 Dialog Close。Browser Back 不是 Dialog close policy 的一个变体。

一个有意接受的 D6 MVP 状态是：当 backing document 为 `diary/2026-08-25` 时，route 可以仍为 `/vault/diary/2026-08-25`，backing tab、`activePath` 和 active document 也仍保持，而视觉上已经显示 Diary Home。这是 presentation state 与 document route state 分层的结果，不是需要通过 `router.replace('/vault')` 修正的 bug。

```text
Route represents backing document
while
Diary Home is currently presented
```

当 Browser Back 导致 route、tab 或 document state 改变时，DiaryWorkspace 只能观察最终结果并 reconcile：如果 backing Diary document 仍是当前 document，可以按既定规则保持/恢复 presentation；如果已切换到 note、其它 Diary、空 Vault 或其它 document，Diary Dialog 必须关闭或重新 reconcile。它不能阻止 router transition。

refresh 时，Dialog state 因为不写入 URL，不承诺恢复 Reader 或 Editor Dialog；refresh 后的 document restoration 继续由 existing Vault route/document lifecycle 决定。未来若需要 Dialog restoration、Reader deep-link、Editor deep-link 或 shareable Diary URL，必须另立 ADR。

三层 ownership 必须保持：

| Layer | Owner | Responsibility |
| --- | --- | --- |
| Router state | existing Vue Router | `/vault`、`/vault/<path>` 和 browser history |
| Document lifecycle | existing Vault tabs/editor lifecycle | `tabs`、`activePath`、document model、save、dirty、History、Recovery 和 route reconciliation |
| DiaryWorkspace presentation | D6 presentation layer | Home、Dialog visibility、Reader/Editor mode 和 focus context |

第三层只能观察并 reconcile 前两层产生的最终状态，不能驱动 router 来模拟自身 presentation state。

## Dialog and Tab Identity Boundary

D6 Dialog 不是新的 document tab，也不是新的 editor session。Dialog 是临时 presentation layer：

- document identity 继续由 existing Docus document lifecycle 拥有；
- Reader Dialog 与 Editor Dialog 始终指向同一个 logical path 和同一个 backing document/tab state；
- Calendar click 是 date intent，必须进入唯一 `openDiaryDate()`；Dialog Controller 不因 click 额外分配第二个 tab；
- 已有 D4 open path 如需创建或复用 backing tab，仍由 existing lifecycle 完成，不能被 Dialog 自己重新实现；
- Reader → Editor 只改变 presentation mode，不新建 document、tab、Monaco model 或 save session；
- close Dialog 不自动 close tab，也不丢弃 dirty state。

禁止出现以下架构：

```text
Calendar click → new Diary tab → Dialog-owned editor session
```

正确边界是：

```text
Calendar click
    ↓
openDiaryDate()
    ↓
existing document/tab lifecycle
    ↓
DiaryWorkspace presentation
    ├── Reader Dialog
    └── Editor Dialog → Existing Editor
```

## Dialog State Ownership Boundary

`DiaryWorkspace`/Dialog Controller 只拥有 presentation state：

- Dialog visibility；
- selected `DiaryDate` 或其已解析的 presentation context；
- Reader/Editor presentation mode；
- focus origin、focus restoration 和 close/back intent。

Existing document lifecycle 继续拥有：

- document identity 和 logical path；
- editor state、raw content 和 model；
- save、dirty state、close confirmation；
- History、Recovery、draft、fileChanges 和 mutation coordination。

Dialog state 不得泄漏成 document mutation state。特别是，Dialog 不能自己保存 raw、自己维护 tab list、自己创建 document、自己恢复 History/Recovery，或在 existing tab/document close 时绕过 lifecycle confirmation；presentation-only close 不启动这条 close lifecycle。

## 5. Phase breakdown

每个 phase 的状态只有在该 phase 的 evidence、task-scoped review 和独立 review 都完成后才能标为 `REVIEW-CLOSED`。下一个 phase 不得在前一个 phase 仍为 `REVIEW-READY` 时开始。

### D6.0 — Architecture confirmation

目标：确认从 `DiaryCalendarSurface` 到 Diary Workspace presentation host 的最小演进路径。

必须确认：

- 当前 Calendar、Vault shell、`openDiaryDate()`、tab workspace、Reader 和 Editor 的实际 ownership；
- Dialog state 应由哪一个现有 presentation seam 承担；
- Calendar hidden-but-mounted 的 DOM/accessibility 策略；
- Reader 和 Editor 是否能在不复制 renderer/editor lifecycle 的情况下被 adapter 化；
- note、archive、ledger 的 existing layout 如何保持 untouched；
- D6 fallback 如何保留 D5 Calendar-first surface。

输出：architecture decision record 或等价 implementation-plan evidence，明确 allowed seams、forbidden seams、rollback seam 和 unresolved questions。

D6.0 ownership checklist：

- [ ] Browser Back ownership 明确属于 existing Vue Router/history；
- [ ] Dialog Header Back、Escape、Explicit Close 明确属于 DiaryWorkspace presentation close policy；
- [ ] Dialog close 不调用 router navigation，不创建 Dialog history entry；
- [ ] Dialog close 不调用 `closeTab()`，不改变 `activePath`，不触发 dirty discard confirmation；
- [ ] Document/Tab close 与 Dialog close 明确区分，前者继续由 existing document lifecycle 拥有；
- [ ] route/document state change 可以被 DiaryWorkspace observe/reconcile，但不会被 Dialog 拦截；
- [ ] refresh 后 Dialog restoration、Reader deep-link 和 Editor deep-link 明确为 D6 MVP 之外的未来 ADR。

Gate：如果需要新 route、第二个 tab store、Diary-specific editor、server API 或改变 D4 command ownership，立即 STOP，不能进入 D6.1。

### D6.1 — Diary Workspace Shell

目标：建立 Diary-only 的 workspace presentation shell，并首先建立清晰的 ownership boundary；不改变 document lifecycle。

职责范围：

- 承载 Calendar Home；
- 承载 Reader/Editor Dialog container 的 visible state；
- 管理 Diary Home ↔ Dialog 的 presentation transition；
- 保存触发日期控件、Dialog focus target 和返回 Calendar 的 context；
- 让 Diary scope 在 narrow/desktop 下使用自己的 presentation layout。

不得在本阶段：

- 新增 document create/open/save API；
- 让 shell 读取或修改 server document raw；
- 把 shell 变成第二个 Vault；
- 通过卸载 Calendar 规避生命周期问题；
- 修改普通 note/archive/ledger 的 layout。

Gate：Diary Home 可显示，D5 Calendar 行为保持，Calendar mounted strategy 未回归，普通 Vault surface 无变化；D6.1 的 shell ownership 不拥有 document lifecycle。

### D6.2 — Calendar Home Migration

目标：将 D5 Calendar surface 提升为 Diary Home primary surface。

保持：

- VCalendar 与现有 adapter；
- `DiaryDate` 和 local civil date semantics；
- month navigation、Today、day click、attributes/dot、locale、theme；
- D5 的 320/375 touch target、768/1280 layout 和 no-horizontal-overflow evidence；
- existing empty/loading/error semantics。

变化只限 Diary presentation：

- Calendar 获得足够的 workspace visual weight；
- 减少无意义的 widget/card chrome；
- Diary-only FileTree 可以隐藏或弱化，但必须可恢复；
- 不改变 FileTree 的内容能力或 scope contract。

Gate：Calendar Home 在 desktop/tablet/mobile 均可用，日期 intent 仍只 emit 到统一 command，VCalendar compatibility evidence 继续 PASS。

### D6.3 — Reader Dialog Adapter

目标：为已有 Diary document 提供大面积 Reader Dialog presentation。

设计边界：

- 日期选择先走 `openDiaryDate()`，然后由现有 document state 驱动 Reader Dialog；
- Reader 使用现有 Markdown renderer/ReadingPane seam、link resolution、TOC 和 theme；
- Header 显示 Diary date、Dialog Header Back/Close 和 Edit action；
- close 返回 Diary Home，恢复 Calendar context 与触发控件 focus；
- Reader 不创建新的 document identity、route、fetch 或 parser。

必须验证：

- existing Diary、today/past create 后的 Diary、existing future Diary；
- future missing 和 invalid date 不会产生 Reader document；
- Reader 与 existing tab/path identity 一致；
- Dialog Header Back、Escape、显式 Close 归一到同一个 presentation close policy；Browser Back 保持 router/history ownership，不被 Dialog 拦截；
- 真实 Browser Back 导致 route/tab/document state 改变时，DiaryWorkspace 只观察最终结果并 reconcile presentation；
- hidden Calendar 不接收键盘焦点，也不触发 `dayIndex` regression。

Gate：Reader Dialog 可用且无 duplicate renderer/lifecycle；Editor 尚未接入时仍可安全回退到 D5 surface。

### D6.4 — Editor Dialog Adapter

这是 D6 最高风险阶段。

目标：把 existing Editor lifecycle 呈现为 Editor Dialog，而不是创建 Diary Editor。

必须复用：

- existing `EditorPane`/Monaco model；
- `useEditorTabs`、`useTabWorkspace` 的 tab/document identity；
- existing save、dirty state、close confirmation、external-change handling；
- History、Recovery、draft persistence、fileChanges、refresh、mutation lock；
- existing keyboard shortcuts、link opening、theme 和 editor preferences。

本阶段必须先做 lifecycle spike，再做完整 presentation integration。至少要回答：

- Editor mount 到 Dialog open 的时序如何避免 Calendar synchronous unmount；
- Editor close 如何区分“关闭 Dialog”与“关闭 tab”；
- dirty document 的真实 tab/document close 如何沿用现有 confirmation；presentation-only Dialog close 如何保留 dirty state 而不触发 confirmation；
- save in flight、external change、history/recovery open 时 Dialog 如何表现；
- reopen 同一日期是否复用现有 tab/model/view state；
- Dialog Header Back/Escape/Explicit Close 是否会意外触发 route/tab close；Browser Back 是否仍由 router/history transition 触发 existing lifecycle reconciliation；
- Editor Dialog 关闭后，普通 note/editor surface 是否保持原有行为。

禁止：

- `DiaryEditor.vue`；
- Diary-specific save pipeline；
- Diary-specific history/recovery；
- hidden duplicate Monaco model；
- `openDiaryEditorDate()`；
- 以 Dialog 为由绕过现有 close confirmation 或 mutation ownership。

Gate：只有在 existing editor 的 save、dirty、history、recovery、close、reopen、shortcut 和 selection evidence 均通过后，才能进入 D6.5。任何 lifecycle ambiguity 都是 STOP，而不是用 presentation-local state 掩盖。

### D6.5 — Lifecycle regression

目标：证明 D6 presentation migration 没有改变 D1–D4 的 document contract。

回归范围：

- existing Diary date open；
- missing today/past exact create；
- missing future remains blocked；
- existing future remains editable/deletable；
- invalid/unmanaged Diary content remains outside Calendar managed projection；
- one date one document identity、no suffix、exact logical path；
- duplicate click/concurrent open 的 existing busy/lock behavior；
- Reader → Editor → save → close → reopen；
- presentation-only Dialog close 保留 dirty state/tab；真实 tab/document close 的 dirty confirmation、draft recovery、History、external changes、route sync、tab persistence；
- note/archive/ledger open/edit/close behavior unchanged；
- Archive Soft-Policy、auth、filesystem/path safety unchanged。

Gate：D4 existing lifecycle evidence全部继续通过；不允许为了 D6 Dialog 重新实现 server mutation 或调整 D4 command。

### D6.6 — Responsive / Accessibility

目标：在不重做 responsive system 的前提下，完成 Diary Home 和 Dialog 的 release-quality presentation。

必须复用 D5 matrix：

- 320 × 700；
- 375 × 812；
- 768 × 1024；
- 1280 × 800。

Calendar Home 必须保持 D5 touch-target、no-overflow、theme、locale 和 focus safety evidence。Reader/Editor Dialog 在 mobile 使用接近 fullscreen 的布局，并处理 safe-area、keyboard、scroll container 和 editor usable size。

Accessibility 必须验证：

- Dialog role、accessible name、focus entry、focus trap/containment、focus restore；
- Escape、Explicit Close、Dialog Header Back、Edit 的 keyboard behavior；Browser Back 的 router-owned behavior 不通过 Dialog keyboard policy 模拟；
- Calendar hidden 时不在 accessibility tree 中、不接受 keyboard focus；
- date、Today、prev、next 和 Edit 的 ARIA/keyboard behavior；
- Diary exists 不是 color-only；
- loading、future-missing、error 的 status/live-region semantics；
- reduced-motion 行为；
- note/archive/ledger 不受 Diary-only CSS 或 focus logic 污染。

Gate：所有 D5 responsive/a11y gate 无回归，且新增 Dialog evidence 无 keyboard trap、pageerror 或 horizontal overflow。

### D6.7 — Release Closure

目标：汇总证据，完成 D6 independent review 前的 release candidate。

必须收集：

- D6.0–D6.6 各阶段状态和 review record；
- focused unit/integration test 结果；
- desktop/tablet/mobile browser E2E 结果；
- D5 Calendar/VCalendar compatibility regression 结果；
- existing Diary lifecycle、History、Recovery 和 ordinary note regression 结果；
- typecheck、build、diff/check 结果；
- pageerror、console error、overflow 和 accessibility diagnostics；
- changed-file boundary、dependency boundary 和 rollback evidence。

Release gate：不能把 `BASELINE-LIMITED` 写成 PASS；不能以历史 D5 evidence 替代 D6 新增 Dialog evidence；GitHub CI 只有实际查询后才能记录为已验证。D6 仍需 independent review 才能标为 `REVIEW-CLOSED`。

## 6. Component boundaries

### 6.1 Boundary table

| Boundary | Owns | May consume | Must not own |
| --- | --- | --- | --- |
| Diary Workspace presentation host | Home/Dialog mode、focus context、overlay shell、Diary-only layout | Calendar surface、existing document presentation state、command callback | API、server mutation、tab identity、save/history/recovery |
| Calendar Home | Calendar rendering、month navigation、Today、marker projection、date intent | `DiaryCalendar` adapter、tree projection、i18n/theme | `openPost()`、create document、route/tab/editor lifecycle |
| Reader Dialog adapter | Reader header、close/edit actions、Markdown reading presentation | existing Markdown renderer/reading pane、same document state | 新 parser、新 reader engine、新 document fetch/create |
| Editor Dialog adapter | Editor presentation container、focus、close/back affordance | existing EditorPane/Monaco、existing tabs/lifecycle | DiaryEditor、新 save pipeline、新 tab/store、新 history/recovery |
| `openDiaryDate()` | date validation、exact path、create/open decision、future guard、busy/error | server date command、existing `openPost()`、refresh/fileChanges/lock | Dialog-specific persistence、第二个 public date command |
| Existing Vault lifecycle | document identity、tabs、raw、save、dirty、route、History、Recovery、draft | presentation callbacks | Diary-only product rules或Calendar rendering |
| Server/shared contracts | authoritative path/date/auth/mutation safety | existing request boundaries | D6 presentation state |

### 6.2 Ownership rules

- 一个 state 只有一个 owner：command、document lifecycle、Dialog presentation 不得互相复制。
- presentation adapter 可以隐藏或重新排列 existing surface，但不能改变其 authority。
- Dialog close 只改变 presentation state，不关闭 tab、不丢弃 dirty state；真正的 tab/document close 仍由 existing lifecycle 决定。
- Diary-only behavior 必须通过 scope boundary 限定；不能在全局 `FileTree`、Vault grid 或 editor CSS 中加入隐含 Diary policy。
- 新增文件或修改文件必须在对应 phase gate 前重新审计，不能因为计划列出 seam 就预先扩大 diff。

## 7. Lifecycle design

### 7.1 Date command remains the single entry point

所有 Calendar date intent、Today intent 和未来其它 Diary date entry 都进入 `openDiaryDate(date)`。Dialog 组件只接收已经解析的 date/document presentation state，不直接请求 `/api/diary/dates`、`/api/posts` 或其它 document API。

已有 D4 contract 必须保持：

| Input | Expected behavior |
| --- | --- |
| existing managed Diary | resolve exact path and open existing document |
| missing today | server-authoritative exact create, then existing open path |
| missing past date | server-authoritative exact create, then existing open path |
| missing future date | no create, stay on Home, recoverable feedback |
| invalid date | no create/open, recoverable feedback |
| unmanaged/invalid Diary content | remains outside managed Calendar identity; no automatic repair |

### 7.2 Existing document and tab identity

完成 date command 后，Dialog 需要关联同一个 logical path 和现有 tab/document state。不得：

- 因 Reader → Editor 产生第二个 tab；
- 因 close Dialog 删除 backing tab；
- 因 reopen 重新生成 document identity；
- 因 Dialog state 复制 raw 内容成为第二个 source of truth；
- 因 presentation close 触发 tab/document close、丢弃 dirty state，或绕过 real tab/document close 的 dirty confirmation、draft 或 Recovery。

### 7.3 Reader → Editor transition

Reader 的 Edit action 是 presentation mode transition，不是 create/open command：

```text
Reader Dialog
    │ edit same path / same tab
    ▼
Editor Dialog
```

Editor 的 source、model、dirty state 和 save status 必须来自 existing lifecycle。Reader 退出时不应触发额外 mutation；Editor Dialog close 只隐藏 presentation 并回到 Home，保留 tab/document/dirty state。只有 existing tab/document close 才执行既有 dirty/unsaved policy。

### 7.4 Close, Browser Back and reopen

- Explicit Close、Escape 和 Dialog Header Back 统一进入 presentation close policy；
- presentation close：回到 Calendar Home，恢复日期触发控件 focus，不改变 route、`activePath` 或 backing tab；
- Browser Back 不进入 Dialog close policy；它由 existing Vue Router/history transition 触发 route/pathMatch 与 existing tab/document lifecycle reconciliation；
- Browser Back 不被 `popstate` interception、fake Dialog history 或 router workaround 劫持；
- presentation close 不自动 `closeTab()`，不触发 dirty confirmation，不处理 discard/save；
- existing tab/document close 仍由 existing lifecycle 处理 dirty、save-in-flight、error 和 confirmation；
- 再次选中同一天时复用同一个 path、tab 和 model identity；
- 如果 route/document state 已切换到 note、其它 Diary 或空 Vault，DiaryWorkspace 必须关闭或 reconcile 不匹配的 Dialog；
- 若 existing Vault route/tab behavior 与 Dialog close 冲突，必须在 D6.0 解决 ownership，不能在 D6.4 添加平行 route。

### 7.5 Lifecycle STOP conditions

遇到以下任一情况，立即停止当前 phase 并报告：

- 需要修改 `DiaryDate`、server route、mutation policy、scopeProtocol 或 Archive policy；
- 需要第二个 Diary command、route、tab store、Editor 或 save/history/recovery pipeline；
- Calendar keep-mounted workaround 无法保留且没有等价 compatibility evidence；
- Editor Dialog 无法区分 Dialog close 与 tab close；
- dirty、save、History、Recovery 或 auth state 需要被 presentation state 复制；
- 需要新增依赖、升级 VCalendar 或改变 Vue/Vite/TypeScript；
- note/archive/ledger 出现行为或 CSS/focus regression；
- 只能通过 horizontal scroll、scale/zoom、卸载 Calendar 或降低 D5 gate 规避问题。

## 8. State machine

### 8.1 Product state machine

```text
DiaryHome
    │ select date
    ▼
DateIntentPending
    ├─ existing managed Diary ───────► DiaryReaderDialog
    ├─ missing today/past ───────────► ExactCreatePending
    │                                      │ success
    │                                      ▼
    │                              DiaryReaderDialog
    ├─ missing future ──────────────► DiaryHome + feedback
    └─ invalid/error ───────────────► DiaryHome + feedback

DiaryReaderDialog
    │ edit same document identity
    ▼
DiaryEditorDialog
    │ Dialog Close / Escape / Dialog Header Back
    ▼
DiaryHome

Browser Back is a separate router/history transition. It is not a
DiaryWorkspace state transition and is reconciled only after the
existing route/tab/document lifecycle produces its resulting state.
```

### 8.2 State ownership

| State | Owner | Meaning |
| --- | --- | --- |
| `DiaryHome` | Diary presentation host | Calendar primary surface is visible and no Dialog is active |
| `DateIntentPending` | `openDiaryDate()` orchestration + presentation bridge | Date command is resolving; no duplicate command may start |
| `ExactCreatePending` | existing server/date lifecycle | today/past missing date is undergoing approved exact create |
| `DiaryReaderDialog` | presentation host | same existing document is being rendered through existing reader seam |
| `DiaryEditorDialog` | presentation host + existing editor lifecycle | same tab/model is presented in Dialog; editor data authority remains existing lifecycle |
| `Home + feedback` | command feedback plus presentation host | future-missing/invalid/error did not create a document |

### 8.3 Invariants

- State transitions never create a second document identity.
- `DateIntentPending` is not a new server mutation path.
- Future missing cannot transition to Reader/Editor through any generic presentation shortcut.
- Closing a Dialog never implies document deletion or tab deletion.
- Reopening a date is idempotent with respect to path and tab identity.
- A Calendar lifecycle transition must not synchronously unmount the VCalendar instance that emitted the click.

## 9. Testing strategy

测试必须按 phase 增量建立，不把所有验证推迟到 D6.7。测试名称和 evidence 必须区分 D6 feature failure、D5 baseline limitation 和 environment limitation。

### 9.1 Unit tests

覆盖纯 presentation/adapter contract：

- Dialog mode transitions：Home → Reader → Editor → Home；
- Dialog Header Back/Escape/Explicit Close 的 presentation-only close policy；
- Browser Back 的真实 router/history transition，以及 DiaryWorkspace 对最终 route/tab/document state 的 reconciliation；
- focus return target 和 hidden Calendar accessibility state；
- command adapter 只调用 `openDiaryDate()`，不直接调用 API 或 `openPost()`；
- existing/missing today/past/future/invalid 的 state mapping；
- same path/same identity 的 reopen behavior；
- Dialog close 不调用 close-tab 或 delete mutation；
- Editor presentation adapter 复用既有 tab/model state。

### 9.2 Integration tests

至少覆盖：

- Calendar date click → `openDiaryDate()` → Reader Dialog；
- Today/missing today → exact create → Reader；
- missing future → no file/no tab/no Dialog；
- Reader Edit → same path Editor Dialog；
- Editor save → existing fileChanges/refresh/history seam；
- presentation-only Editor Dialog close → Home，dirty state/tab 保留且不触发 confirmation；
- real tab/document close → existing dirty confirmation；
- Browser Back → existing route/tab/document reconciliation；
- Editor Dialog close → Home，reopen → same path/tab/model；
- History/Recovery/External change in or around Dialog 不改变原有 lifecycle；
- Calendar hide/show 与 `ed47c94` keep-mounted strategy 无 `dayIndex` pageerror；
- note/archive/ledger existing open/edit/close 不受 D6 presentation 影响。

### 9.3 Browser E2E

按 desktop、tablet、mobile matrix 验证：

- 1280：Diary Home、Reader、Editor、close/reopen、no overflow；
- 768：Calendar-first layout、Dialog usable size、FileTree/ordinary Vault behavior；
- 375、320：Calendar touch target、fullscreen Dialog、safe-area、keyboard/focus、no overflow；
- existing Diary lifecycle：date click、Today、existing future、future missing、save、close、reopen；
- VCalendar compatibility：keep-mounted、open/close、pageerror = 0；
- `Diary → note → Diary` scope restoration；
- ordinary note unchanged，Archive/ledger smoke unchanged；
- Dialog ARIA name/role、Escape、Dialog Header Back、focus trap/restore、date/Edit keyboard activation；
- Browser Back 不被拦截，真实 route transition 后 Dialog/presentation 正确 reconcile；
- hidden Calendar 不可被 tab 到，不产生 stale focus 或 click。

### 9.4 Release evidence

Release 前必须保留：

- focused Vitest file/test counts and result；
- browser matrix with viewport、pass/fail、pageerror、console error；
- typecheck and production build result；
- no horizontal overflow measurements；
- changed files / dependency audit；
- History/Recovery results，真实标记 `PASS` 或 `BASELINE-LIMITED`；
- independent review result and unresolved P0/P1/P2。

不要求因为 D6 docs plan 运行任何代码测试；实现阶段再按各 phase gate 执行。

## 10. Risks

| ID | Risk | Severity | Mitigation | STOP signal |
| --- | --- | --- | --- | --- |
| R1 | Editor lifecycle duplication | High | 复用 existing Editor、tabs、save、History、Recovery；禁止 `DiaryEditor` | 需要第二套 model/save/shortcut/store |
| R2 | Dialog state 与 tab/route state 冲突 | High | 单一 `openDiaryDate()` owner；Dialog close 是 presentation-only，不改变 route、`activePath` 或 tab identity；Browser Back 保持 router/history ownership | Dialog-local action 劫持 Browser Back，或 Back/Escape/Close 触发不同 document transition |
| R3 | Calendar mounted lifecycle regression | High | 保留 `ed47c94` keep-mounted + `v-show`；用真实 browser click/open/close evidence | `dayIndex` pageerror 或必须同步卸载 Calendar |
| R4 | Mobile usability regression | High | 继承 D5 320/375/768/1280 matrix、touch target、no-overflow 和 Dialog fullscreen gate | 只能靠 scroll/scale 或降低 D5 threshold |
| R5 | Diary-only presentation 泄漏到 Vault | Medium | scope-local host/CSS/focus；note/archive/ledger regression | 普通 Vault layout、FileTree 或 scope 行为变化 |
| R6 | Dialog state ownership | Medium | `DiaryWorkspace` 只拥有 Dialog visibility、selected DiaryDate、Reader/Editor presentation mode；existing document lifecycle 拥有 document identity、editor state、save、History、Recovery | Dialog 自己保存 raw、维护 tab、创建 document 或把 presentation state 变成 lifecycle mutation |
| R7 | Reader/Editor presentation close 丢失修改 | High | Dialog close 保留 backing tab、dirty state、draft 和 Recovery，不触发 discard；只有 existing tab/document close 才委托 dirty confirmation、save-in-flight、draft/recovery | presentation adapter 自己丢 raw、bypass real close policy 或把 Dialog close 当作 tab close |
| R8 | Dialog 与 VCalendar focus/visibility 互相干扰 | High | keep-mounted + accessible hidden strategy；focus restore evidence | hidden Calendar 可聚焦或重新出现 pageerror |
| R9 | D6 演变成独立 Diary App | Medium | Markdown/Vault source of truth；不新增 database/entity/storage | 需要 Diary-specific persistence 或 identity |
| R10 | 以 feature flag/临时状态掩盖 lifecycle bug | Medium | D6.0 先定 ownership，phase gate 必须有可重复 evidence | 只能依赖 scheduler timing 或 local workaround |

## 11. Rollback strategy

### 11.1 Phase-level rollback

每个 phase 必须保持小而可逆的 diff，并在进入下一 phase 前保留 D5 fallback：

- D6.0 失败：不进入 implementation，保留 D5 architecture 和 PRD；
- D6.1 失败：移除 Diary workspace shell presentation，恢复现有 Calendar surface；
- D6.2 失败：保留 D5 Calendar Home/Calendar surface，不改变 Diary data contract；
- D6.3 失败：关闭 Reader Dialog adapter，日期仍可回到 D5 existing open path；
- D6.4 失败：不得修改或回滚 existing Editor lifecycle；保留 D5 Calendar Home 和原有 editor surface；
- D6.5 失败：停止 release，回退 presentation integration，不回退 server/domain/history/recovery；
- D6.6 失败：回退 Diary-only responsive/Dialog presentation，保留已验证的 D5 layout；
- D6.7 失败：D6 保持 `REVIEW-READY` 或 `BLOCKED`，不修改 D0–D5 closure。

### 11.2 Data and identity safety

- D6 不需要文件迁移或 metadata migration；
- 任何 rollback 都不能删除 Diary 文件、关闭/重建 identity 或清理 History/Recovery；
- Dialog fallback 必须继续使用同一个 `openDiaryDate()`、logical path 和 existing `openPost()`/tab lifecycle；
- 不允许通过 rollback 清除 dirty document 或跳过 close confirmation；
- 若 production diff 无法只回退 presentation layer，必须 STOP 并报告，不进行混合回滚。

### 11.3 Release rollback evidence

实现阶段必须记录：

- 每个 phase 的前后行为和可回退 commit boundary；
- D5 fallback 如何被重新启用/保留；
- existing Diary file、tab identity、History/Recovery 不受影响的 evidence；
- rollback 后 note/archive/ledger 的 smoke evidence。

## 12. Acceptance criteria

以下是 D6 实现与 release review 的目标 criteria，不是本 docs-only plan 的完成 evidence；在实现和 independent review 之前必须保持未勾选。

- [ ] D6.0 完成 architecture confirmation，并确认 Calendar、Dialog、command、tab、Editor ownership。
- [ ] Diary Home 存在，且 Diary scope 默认以 Calendar-first workspace 进入。
- [ ] Calendar 是 primary surface，不再表现为小型第三方 widget card。
- [ ] VCalendar `3.1.2`、现有 adapter 和 `ed47c94` keep-mounted + `v-show` workaround 保持不变。
- [ ] month view、previous/next、Today、date click、Diary marker、locale、theme 行为保持。
- [ ] Reader Dialog 使用 fullscreen/large presentation，并复用现有 Markdown renderer。
- [ ] Editor Dialog 使用 existing Editor lifecycle、EditorPane/Monaco、tabs 和 same document identity。
- [ ] 不存在 `DiaryEditor`、第二套 editor、save、Markdown、History、Recovery 或 shortcut pipeline。
- [ ] `openDiaryDate()` 仍是唯一日期 command；没有 `openDiaryEditorDate()` 或 parallel command system。
- [ ] existing Diary、today/past missing、future missing、existing future、invalid date 的行为符合 D1–D4 contract。
- [ ] one day one Diary、exact path、no suffix、local civil date semantics 不变。
- [ ] Dialog close 不删除 document、tab identity 或 dirty content，不改变 route/`activePath`，不触发 dirty discard，不静默丢失修改。
- [ ] save、dirty confirmation、external changes、History、Recovery、draft、fileChanges 和 route sync 继续由现有 lifecycle 处理。
- [ ] Calendar → Reader → Editor → Home 的 state machine 有 focused integration 和 browser evidence。
- [ ] Dialog Header Back、Escape、Explicit Close 统一为 presentation close；Browser Back 保持 Router/history ownership，不被拦截、不创建 fake history entry。
- [ ] Dialog close 不调用 router navigation、`closeTab()`、`router.back()` 或 `router.replace('/vault')`，不把 Dialog state 写入 URL。
- [ ] Browser Back 后 DiaryWorkspace 能根据最终 route/tab/document state 正确 close/reconcile presentation。
- [ ] backing route 可以保留文档 URL，而 Diary Home 作为当前 presentation；route 与 presentation 暂时不一致是有意的 D6 MVP 行为。
- [ ] refresh 不承诺恢复 Dialog；Reader/Editor deep-link 需要独立 ADR。
- [ ] 320、375、768、1280 viewport 的 Calendar/Dialog matrix 通过，无 horizontal overflow。
- [ ] D5 touch target、keyboard、ARIA、hidden Calendar focus safety 和 `dayIndex` pageerror gate 不回归。
- [ ] Diary-only FileTree 隐藏/弱化可恢复；note、archive、ledger 的 ordinary Vault layout 不变。
- [ ] filesystem、path、auth、CSRF/origin、atomic write、lock、AI mutation guard 不被绕过。
- [ ] no new dependency、no VCalendar upgrade、no Vue/Vite/TypeScript downgrade。
- [ ] History/Recovery evidence 被真实标记为 `PASS` 或 `BASELINE-LIMITED`，没有把环境限制伪装为 feature PASS。
- [ ] D6.0–D6.7 phase evidence、rollback evidence 和 independent review 均完成。
- [ ] D6 P0/P1/P2 = 0/0/0 后才可标记 `REVIEW-CLOSED`。

## 13. Status and next action

当前计划完成后的文档状态：

```text
D0–D5                 REVIEW-CLOSED
Diary Calendar MVP    COMPLETE / REVIEW-CLOSED
D6 PRD                REVIEW-READY
D6 Implementation Plan REVIEW-READY
D6 implementation     NOT STARTED
Future Mood/Task/etc. NOT STARTED / non-MVP
```

本计划不把 D6 标成 `REVIEW-CLOSED`，不代表 D6 implementation 已开始，也不创建 D7。下一步只能是对本计划进行独立 review；review 通过后，才可以单独启动 D6.0 Architecture Confirmation。

## 14. Docs-only boundary for this commit

本次 follow-up 只允许修改以下 D6 design docs：

```text
docs/design/diary-home-workspace-prd.md
docs/design/diary-home-workspace-implementation-plan.md
```

本 commit 不修改：

- `src/**`、`server/**`、`shared/**`、`e2e/**`、`tests/**`；
- `package.json`、`package-lock.json` 或任何 dependency；
- D0–D5 closure evidence 或现有 compatibility report；
- Diary domain、server API、Editor lifecycle、Calendar implementation。

验证范围只包括 `git diff --check`、changed-file audit 和 worktree status；typecheck、build、unit test、E2E、History/Recovery integration 留到实际 implementation phase。
