# Docus — Naive UI Foundation PRD

**日期：** 2026-09-07  
**模块：** Global UI Foundation  
**状态：** Product Review: Ready for Review  
**类型：** 架构重构 / UI Foundation  
**优先级：** P1  
**基线：** main @ 0ba48906037dbc97d90f208ed917ff87b1cd476a

## 1. 产品概述

Docus 当前已经形成多个稳定 Workspace：

~~~
Note   → 我知道什么
Diary  → 我经历了什么
Ledger → 我的钱发生了什么
~~~

随着产品逐渐成熟，Docus 已经不再处于“快速验证单个页面”的阶段，而开始面临一个跨 Workspace 的长期问题：

> 功能已经可用，但整体 UI 仍然缺乏统一、成熟、精致的产品感。

当前大量基础 UI 能力由 Docus 自行实现或各 Workspace 独立实现，包括：

~~~
Button
Input
Textarea
Select
Date control
Dialog
Confirm
Prompt
Toast
Dropdown
Popover
Tabs
Loading
Empty State
Focus / Hover / Disabled states
Light / Dark adaptation
~~~

这种模式在早期开发阶段灵活且低依赖，但随着 Docus 页面数量、Workspace 数量和交互复杂度增长，会不断增加：

~~~
视觉不一致
交互状态不一致
Accessibility 维护成本
Dark / Light 双主题维护成本
CSS 规模
重复实现
跨 Workspace 视觉漂移
~~~

本次重构引入 **Naive UI**，建立统一的 Docus UI Foundation。

核心定位冻结为：

> **Naive UI = Docus 的基础交互组件层**
>
> **Docus = 自己的产品视觉、信息架构和业务布局层**

本次重构不是把 Docus 改造成 Naive UI Demo，也不是用组件库重新定义 Note、Diary、Ledger、Vault 的产品形态。

Naive UI 是基础设施。

Docus 仍然拥有自己的产品语言。

## 2. 背景与问题

当前 Docus 的主要问题不是某一个 Button 或 Card “不好看”，而是 UI Foundation 缺少一个统一 authority。

不同区域可能独立决定：

~~~
padding
height
radius
border
font-size
hover
pressed
disabled
focus
loading
dialog spacing
form validation
popover behavior
dark mode treatment
~~~

单独看每个页面都可用，但跨页面比较时容易产生：

> 可用，但不精致。

本次重构要解决的不是单纯的 CSS 美化，而是建立一个长期可维护的 UI architecture。

## 3. 产品目标

本次项目完成后，Docus 应具备统一的：

~~~
Design Token System
Theme Authority
Primitive Components
Overlay Infrastructure
Feedback Infrastructure
Form Infrastructure
Interaction States
Accessibility Baseline
Light / Dark behavior
~~~

并使：

~~~
Note
Diary
Ledger
Vault
Global Chrome
Settings
Authentication
~~~

能够共享同一个 UI Foundation。

最终目标：

~~~
功能一致
视觉一致
交互一致
主题一致
Accessibility 一致
代码维护方式一致
~~~

同时必须保留各 Workspace 自己的产品个性。

## 4. 非目标

本次重构不实现：

- 重做 Note 产品结构；
- 重做 Diary 信息架构；
- 重做 Ledger Dashboard；
- 重做 Vault 文件树业务模型；
- 重做 Router；
- 重做 API；
- 重做 Store；
- 修改 Server；
- 修改数据库；
- 修改 Markdown rendering；
- 替换 Shiki；
- 替换 Mermaid；
- 替换 Markmap；
- 替换 Monaco；
- 替换 ECharts；
- 引入 Tailwind；
- 引入第二套 UI Component Library；
- 重做 Docus branding；
- 新增 Workspace；
- 新增 Ledger 功能；
- 新增 Diary 功能；
- 新增 Note 功能。

特别说明：

> 本项目不是“把所有 HTML tag 换成 Naive UI component”。

迁移必须具有明确的 UI Foundation 收益。

## 5. 核心架构原则

### 5.1 Naive UI 负责基础交互

以下能力原则上由 Naive UI 提供：

| 类型 | Authority |
| --- | --- |
| Button | Naive UI |
| Input | Naive UI |
| Textarea | Naive UI |
| Select | Naive UI |
| DatePicker | Naive UI |
| Checkbox | Naive UI |
| Radio | Naive UI |
| Switch | Naive UI |
| Form | Naive UI |
| Form Validation | Naive UI |
| Modal / Dialog | Naive UI |
| Drawer | Naive UI |
| Dropdown | Naive UI |
| Tooltip | Naive UI |
| Popover | Naive UI |
| Tabs | Naive UI |
| Pagination | Naive UI |
| Empty | Naive UI |
| Skeleton | Naive UI |
| Spin / Loading | Naive UI |
| Message | Naive UI |
| Notification | Naive UI |

### 5.2 Docus 负责产品表达

以下能力继续由 Docus 自己拥有：

| 类型 | Authority |
| --- | --- |
| Design Tokens | Docus |
| Theme semantics | Docus |
| Page Layout | Docus |
| Workspace Layout | Docus |
| Global product hierarchy | Docus |
| Ledger Dashboard | Docus |
| Ledger domain components | Docus |
| Diary page layout | Docus |
| Diary domain components | Docus |
| Note editor layout | Docus |
| Vault file tree domain structure | Docus |
| Vault pane architecture | Docus |
| Navbar product structure | Docus |
| ECharts | Existing |
| Markdown | Existing |
| Shiki | Existing |
| Mermaid | Existing |
| Markmap | Existing |
| Monaco | Existing |

冻结原则：

~~~
Naive UI 决定“控件如何正确工作”。

Docus 决定“产品应该如何组织和表达”。
~~~

## 6. Card 使用原则

NCard 不作为 Docus 默认布局组件。

只有当一个区域本身就是明确独立的信息对象时，才允许考虑 Card。

禁止为了迁移而把：

~~~
Ledger Cashflow
Account Group
Period Summary
Diary content
Vault pane
~~~

机械包进：

~~~vue
<NCard>
~~~

页面层级优先继续通过：

~~~
Typography
Whitespace
Divider
Surface
Grid
Flex
~~~

建立。

目标是避免：

~~~
Card
  Card
    Card
~~~

形成组件库式 UI。

## 7. Menu 使用边界

NMenu 只用于真正的 Menu / Navigation primitive。

适合：

~~~
用户菜单
设置菜单
简单侧边导航
Dropdown menu
~~~

不自动接管：

~~~
Vault 文件树
note / diary / ledger Workspace switch
复杂 domain tree
~~~

Vault Tree 继续属于 Vault domain component。

## 8. Tabs 使用边界

简单的内容区域切换可以使用 NTabs。

例如：

~~~
属性
历史
大纲
~~~

但如果一个 Tab：

- 对应独立 Route；
- 是 Workspace 一级导航；
- 有独立生命周期；
- 是产品 IA 的正式节点；

则不得为了使用 NTabs 把它降级成 component-local state。

Route authority 必须保留。

## 9. Wrapper 原则

禁止建立无价值的机械 wrapper，例如：

~~~
DButton
DInput
DSelect
DCheckbox
DCard
~~~

如果内部只是：

~~~vue
<NButton v-bind="$attrs">
  <slot />
</NButton>
~~~

则不允许创建。

业务组件可以直接使用：

~~~vue
<NButton />
<NInput />
<NSelect />
~~~

只有形成稳定 Docus 产品语义时才允许封装。

例如：

~~~
DocusDangerConfirm
DocusWorkspaceEmptyState
LedgerMoneyInput
LedgerAccountPicker
DiaryDateNavigator
~~~

这些封装必须提供真实 domain value，而不是隐藏 Naive UI API。

## 10. Docus Design Token Architecture

Docus Semantic Tokens 是整个 UI 系统的 source of truth。

架构固定为：

~~~
Docus Semantic Tokens
        ↓
Naive UI Theme Overrides
        ↓
Naive UI Components
        ↓
Docus Domain Components
        ↓
Docus Workspace
~~~

不得反转为：

~~~
Naive UI default theme
        ↓
Docus looks like Naive UI
~~~

## 11. Token 第一版范围

第一版至少定义以下 semantic tokens。

### 11.1 Color

~~~
--docus-bg
--docus-surface-1
--docus-surface-2

--docus-text-1
--docus-text-2
--docus-text-3

--docus-border
--docus-divider

--docus-accent
--docus-accent-hover
--docus-accent-pressed

--docus-positive
--docus-negative
--docus-warning
--docus-info
~~~

### 11.2 Radius

~~~
--docus-radius-sm
--docus-radius-md
--docus-radius-lg
~~~

### 11.3 Spacing

~~~
--docus-space-1
--docus-space-2
--docus-space-3
--docus-space-4
--docus-space-5
--docus-space-6
~~~

### 11.4 Typography

~~~
--docus-font-size-xs
--docus-font-size-sm
--docus-font-size-md
--docus-font-size-lg
~~~

不要求第一阶段一次建立大型 enterprise design token taxonomy。

目标是建立：

> 少量、稳定、有语义、长期可维护的 token。

## 12. Legacy Token Compatibility

当前项目已有：

~~~
--bg
--bg-soft
--text
--text-h
--text-muted
--border
--accent
--accent-hover
~~~

第一阶段不得一次性删除这些 token。

必须提供 compatibility alias，例如：

~~~css
--bg: var(--docus-bg);
--bg-soft: var(--docus-surface-1);

--text-h: var(--docus-text-1);
--text: var(--docus-text-2);
--text-muted: var(--docus-text-3);

--border: var(--docus-border);

--accent: var(--docus-accent);
--accent-hover: var(--docus-accent-hover);
~~~

迁移过程中：

~~~
新代码
→ 优先使用 --docus-* token

旧代码
→ compatibility alias 保持稳定
~~~

旧 token 的删除只能发生在 Cleanup Phase。

## 13. Theme Authority

现有 useTheme() 继续作为 Docus application theme authority。

不得让 NConfigProvider 创建第二套 theme state。

主题链路冻结为：

~~~
OS Preference / localStorage
            ↓
         useTheme
            ↓
       light | dark
            ↓
 ┌──────────┼──────────┐
 ▼          ▼          ▼
CSS Tokens  Naive UI   ECharts
~~~

useTheme() 继续负责：

~~~
theme state
localStorage
data-theme
theme switching
~~~

Naive UI 只是 theme consumer。

## 14. Light / Dark 一致性

所有 Naive UI migration 必须同时支持：

~~~
Light
Dark
~~~

不得出现：

> Light 已完成，Dark 后续再处理。

每一个 Phase 的完成标准都包含 Light / Dark parity。

## 15. Naive UI Theme Overrides

新增统一 Naive UI theme mapping。

推荐位置：

~~~
src/ui/naiveTheme.ts
~~~

其职责：

~~~
Docus Semantic Tokens
        ↓
GlobalThemeOverrides
~~~

它不是第二套 design system。

禁止在这里随意产生新的：

~~~
brand color
radius
spacing
typography
~~~

如果 Naive UI 需要某个视觉值，应优先从 Docus semantic tokens 获取。

## 16. Token Single Source of Truth

原则上禁止长期维护：

~~~
CSS tokens 一套颜色
+
TypeScript theme constants 一套颜色
~~~

形成两个 source of truth。

Phase 0 必须验证：

Naive UI themeOverrides 对 CSS Custom Properties 的支持范围。

如果目标字段可以可靠使用：

~~~
var(--docus-accent)
~~~

则优先直接引用 CSS token。

只有 Naive UI API 存在明确技术限制时，Implementation Plan 才允许建立受控 TS token mirror。

## 17. Root Provider Architecture

Naive UI Provider 不直接散落在各个 Workspace。

必须建立统一 Root。

推荐：

~~~
src/ui/DocusUiRoot.vue
~~~

结构概念：

~~~
DocusUiRoot
  └─ NConfigProvider
       └─ NDialogProvider
            └─ NMessageProvider
                 └─ NNotificationProvider
                      └─ App
~~~

App.vue 不承担 provider bootstrap。

## 18. 第一版 Provider 范围

第一版只引入确有使用价值的 Provider：

~~~
NConfigProvider
NDialogProvider
NMessageProvider
NNotificationProvider
~~~

不因为 Naive UI 提供某 Provider 就全部挂载。

例如：

NLoadingBarProvider

只有出现明确全局 Loading Bar 产品需求时再引入。

## 19. Global Feedback Migration

当前 Docus 已有：

~~~
ToastHost
ConfirmHost
PromptHost
~~~

目标不是立即删除业务层 API，而是先替换底层实现。

现有：

~~~
useToast
useConfirm
usePrompt
~~~

属于有价值的 Docus semantic abstraction。

因此优先策略：

~~~
业务层 API 保持
        ↓
底层 implementation
custom host → Naive UI
~~~

## 20. Toast

目标：

~~~
ToastHost
→ NMessage / NNotification
~~~

原则：

短暂即时反馈：

~~~
success
info
warning
error
~~~

优先由 NMessage 承担。

需要更长信息、标题或较重反馈时可使用 NNotification。

具体映射由 Implementation Plan 冻结。

业务调用方不应因为迁移发生大规模改写。

## 21. Confirm

目标：

~~~
ConfirmHost
→ NDialog
~~~

现有：

~~~
useConfirm()
~~~

继续作为 Docus confirm semantic API。

它负责表达：

~~~
用户意图
危险等级
确认文案
~~~

Naive UI 负责：

~~~
focus trap
overlay
keyboard
ESC
buttons
a11y
~~~

## 22. Prompt

PromptHost 不要求强行替换成一个 Naive UI built-in API。

允许建立：

~~~
Docus Prompt semantics
+
NModal / NDialog
+
NInput
~~~

目标是保留：

~~~
usePrompt()
~~~

调用语义，同时统一：

~~~
overlay
input
focus
buttons
validation presentation
~~~

## 23. Form Strategy

新 Form 优先使用：

~~~
NForm
NFormItem
Naive UI validation
~~~

已有复杂 Form 不要求在 Phase 1 立即重写。

Form migration 按 Workspace 逐步进行。

禁止仅为了组件库一致性重写稳定 domain validation。

Domain validation authority 必须保留。

例如：

~~~
Server validation
Ledger domain validation
Diary access semantics
Auth semantics
~~~

不得迁移成纯 UI validation authority。

## 24. Primitive Strategy

以下原生控件应逐步收敛到 Naive UI：

~~~
button
input
textarea
select
checkbox
radio
switch
date picker
~~~

但迁移必须是产品语义等价迁移。

不能因为 Naive UI 默认 API 不同就改变：

~~~
routing
keyboard behavior
date semantics
validation authority
loading state
disabled state
business events
~~~

## 25. DatePicker 特别规则

DatePicker 迁移时必须保留领域 authority。

例如 Ledger：

~~~
Server today authority
Ledger timezone
future validation
anchorDate
canonical URL
~~~

这些均不属于 Naive UI。

Naive UI 只负责：

> 用户如何选择日期。

不得让 DatePicker 自己成为 financial date authority。

## 26. Workspace Migration Boundary

迁移 Workspace 时遵循：

~~~
Naive UI 接管 primitives
Docus 保留 domain components
~~~

示例：

### Ledger

可以迁移：

~~~
Button
Select
DatePicker
Dialog
Form
Input
Loading / Empty primitive
~~~

不迁移：

~~~
Dashboard hierarchy
Metric layout
Cashflow layout
Account list
Category bars
Period Summary
Trend composition
~~~

### Diary

可以迁移：

~~~
Date controls
Buttons
Dialog
Form
Inputs
Tabs where appropriate
~~~

不迁移：

~~~
Diary content layout
Diary calendar product behavior
Diary timeline / content hierarchy
~~~

### Vault

可以迁移：

~~~
Button
Dropdown
Tooltip
Dialog
Input
simple Tabs
~~~

不迁移：

~~~
FileTree domain model
pane architecture
editor lifecycle
document rendering
command model
~~~

## 27. Migration Order

整个项目冻结为以下迁移阶段。

### Phase 0 — Architecture Spike

目标：

验证：

~~~
Naive UI 与当前 Vue/Vite/TypeScript 兼容性
themeOverrides
CSS var mapping
bundle impact
test environment
Teleport
Provider hooks
Dark / Light integration
E2E implications
~~~

本阶段不得大面积迁移 UI。

### Phase 1 — UI Foundation

完成：

~~~
Naive UI dependency
DocusUiRoot
NConfigProvider
Theme mapping
tokens.css
legacy aliases
provider baseline
~~~

但业务 UI 基本保持不变。

### Phase 2 — Feedback / Overlay

迁移：

~~~
ToastHost
ConfirmHost
PromptHost
适合迁移的 Dialog
~~~

保持：

~~~
useToast
useConfirm
usePrompt
~~~

调用契约尽可能稳定。

### Phase 3 — Primitive Controls

迁移跨项目重复度最高的：

~~~
Button
Input
Textarea
Select
Checkbox
Radio
Switch
DatePicker
~~~

不要求一个 commit 全项目完成。

可以按小批次迁移，但 Phase 退出时必须确定 canonical implementation。

### Phase 4 — Shared Chrome

迁移：

~~~
NavBar 中适合的 Button
Dropdown
Tooltip
简单 menu control
Settings controls
Auth shared controls
~~~

不得改变：

~~~
note / diary / ledger
Workspace navigation semantics
route behavior
~~~

### Phase 5 — Diary

Diary 作为第一个完整 Workspace migration validation target。

原因：

- 产品边界清晰；
- 交互足够丰富；
- 风险低于 Vault；
- 可以验证 Date / Dialog / Form / Controls；
- 不需要立即扰动刚完成 UI 稳定化的 Ledger。

### Phase 6 — Ledger

迁移：

~~~
buttons
date picker
scope select
forms
dialogs
inputs
loading / empty primitives where appropriate
~~~

保留当前 Ledger Visual Language。

不得因为 Naive UI 重构重新设计 Dashboard。

### Phase 7 — Vault / Note

最后迁移风险最高的：

~~~
Vault
Note
~~~

原因：

~~~
File tree
Editor
Preview
Pane lifecycle
Tabs
Keyboard
Focus
Scroll
Command palette
Markdown rendering
~~~

交互高度复杂。

必须等 Foundation 已在其他 Workspace 验证稳定后再进入。

### Phase 8 — Cleanup

最终清理：

~~~
unused custom primitive CSS
obsolete Host
deprecated compatibility styles
legacy primitive classes
dead utilities
duplicate focus styles
duplicate theme rules
~~~

Legacy token 只允许在此阶段评估删除。

## 28. Migration Incrementality

禁止 Big Bang migration。

不得提交：

> Replace all Docus UI with Naive UI

这种一次覆盖整个项目的变更。

每个阶段必须：

~~~
独立可运行
独立可测试
独立可回滚
独立可 review
~~~

## 29. Canonical Implementation Rule

短期迁移期间允许：

~~~
Legacy Primitive
+
Naive UI Primitive
~~~

并存。

但每个 Phase 完成时必须明确：

> 对本阶段覆盖范围，哪一种实现是 canonical。

禁止长期出现：

~~~
页面 A → NButton
页面 B → .primary-button
页面 C → 自制 Button 2
~~~

而没有迁移计划。

## 30. Visual Preservation

本项目不是全站 redesign。

迁移的第一优先级：

~~~
Behavior Preservation
Visual Consistency
Interaction Quality
~~~

不是：

~~~
全部页面看起来像 Naive UI 默认主题。
~~~

现有已经被用户认可的 UI，应优先视觉保真迁移。

特别是：

~~~
Ledger Dashboard
~~~

当前视觉方向必须作为 migration baseline 保留。

## 31. Theme Acceptance

每个迁移后的组件必须覆盖：

~~~
default
hover
active / pressed
focus-visible
disabled
loading
error where applicable
~~~

并同时验证：

~~~
Light Mode
Dark Mode
~~~

## 32. Accessibility

引入 Naive UI 的目标之一是降低基础交互 accessibility 自研成本。

迁移不得降低现有：

~~~
keyboard navigation
focus visibility
aria labeling
dialog semantics
screen reader behavior
loading status
error alerts
~~~

Naive UI 自带 accessibility 不意味着无需测试。

Domain-level accessible naming 仍属于 Docus。

## 33. Focus Strategy

现有 Docus 已有全局 :focus-visible 规则。

迁移期间必须避免出现：

~~~
Naive UI focus ring
+
Docus global focus ring
~~~

形成 double focus indicator。

Phase 0 / 1 必须明确：

~~~
Native / Docus component
Naive component
Vault custom component
~~~

各自的 focus authority。

最终用户看到的 focus indicator 应统一、清晰、非重复。

## 34. Overlay / Teleport

Naive UI Dialog / Dropdown / Popover 等可能使用 Teleport。

必须验证：

~~~
z-index
Vault pane
Navbar
Modal
Auth page
Diary dialog
Ledger dialog
scroll lock
body class
dark/light theme inheritance
~~~

不得出现：

~~~
overlay 被 pane 截断
popover 跑到错误层级
modal 被 navbar 压住
Vault body lock 冲突
~~~

## 35. Router Preservation

Naive UI migration 不允许改变：

~~~
route structure
browser back / forward
route query
deep link
workspace route semantics
~~~

Tabs、Menu、Button 可以改变实现，但 URL authority 不变。

## 36. Store / Server Boundary

UI Foundation 不得侵入：

~~~
Store state machine
API contract
Server semantics
database
domain projection
~~~

UI component 只能消费现有 domain state。

禁止出现：

> 因为 NForm 方便，所以把 domain validation 搬到 component。

## 37. ECharts

ECharts 保留。

Naive UI 不替代数据可视化。

Ledger 趋势等继续使用：

~~~
ECharts
~~~

Theme 颜色可以从 Docus semantic tokens 获取。

## 38. Markdown / Content Rendering

以下保持原实现：

~~~
Markdown-it
Shiki
Mermaid
Markmap
KaTeX
Monaco
~~~

Naive UI 不进入 content rendering pipeline。

## 39. Bundle Strategy

Naive UI 引入后必须关注客户端 bundle。

实现应优先：

~~~
按需 import
tree-shaking friendly
不全局注册全部 component
~~~

禁止为了方便一次性暴露整个 Naive UI component set。

Phase 0 必须记录 baseline 和 Spike 后 bundle 变化。

## 40. Root Bootstrap

当前应用 bootstrap 应由：

~~~
router
+
Docus UI root
~~~

组成。

推荐目标：

~~~
main.ts
  ↓
DocusUiRoot
  ↓
App
~~~

main.ts 继续保持轻量。

不得把大量 Theme / Overlay business logic 直接塞入 main.ts。

## 41. File Architecture

目标结构建议：

~~~
src/
├── ui/
│   ├── DocusUiRoot.vue
│   ├── naiveTheme.ts
│   ├── tokens.css
│   └── ...
│
├── components/
│   ├── diary/
│   ├── ledger/
│   ├── vault/
│   └── ...
│
├── composables/
│   ├── useTheme.ts
│   ├── useToast.ts
│   ├── useConfirm.ts
│   ├── usePrompt.ts
│   └── ...
~~~

src/ui 只存放 UI Foundation。

不要把业务组件搬入 src/ui。

## 42. Testing Strategy

每个 Phase 至少覆盖：

~~~
Unit
Typecheck
Build
Relevant Integration
Relevant Browser E2E
Light / Dark
Keyboard
Exact-head CI
~~~

Overlay migration 额外覆盖：

~~~
focus
ESC
confirm
cancel
busy
double submit
close behavior
~~~

## 43. Visual Regression Strategy

对于 UI migration，视觉回归测试是正式 gate。

已有稳定 surface 应尽量保留 baseline。

如果视觉变化是 intentional：

必须明确记录变化原因。

不得用：

> Naive UI 默认就是这样

作为视觉变化理由。

## 44. Phase Exit Criteria

每个 Phase 只有满足以下条件才允许关闭。

1. 本 Phase 定义的 migration scope 已完成。
2. 已确定 canonical implementation。
3. 不存在未记录的 Legacy / New 双体系。
4. Light Mode PASS。
5. Dark Mode PASS。
6. Keyboard PASS。
7. Focus state PASS。
8. Disabled / Loading state PASS。
9. Relevant unit tests PASS。
10. Relevant E2E PASS。
11. Typecheck PASS。
12. Build PASS。
13. No unapproved domain behavior change。
14. No unapproved route change。
15. Exact-head CI PASS。

## 45. Epic Completion Criteria

整个 Naive UI Foundation Epic 只有在以下条件全部满足时关闭：

- Naive UI Foundation 已稳定；
- Docus semantic tokens 成为 UI source of truth；
- Theme authority 唯一；
- Root Provider 唯一；
- Global feedback / overlay 已统一；
- Primitive control canonical implementation 已明确；
- Note / Diary / Ledger / Vault 已完成计划范围内迁移；
- 已无无主的重复 primitive system；
- Legacy CSS debt 已清理；
- Light / Dark 一致；
- Accessibility 没有明显退步；
- 所有主路径 E2E 通过；
- CI 完整通过；
- Docus 保留自己的 Workspace 视觉和 IA。

## 46. 成功标准

本项目成功不是：

~~~
Naive UI component 数量很多
~~~

而是用户能感知到：

~~~
Button 更一致
Input 更一致
Dialog 更成熟
Forms 更统一
Hover / Focus / Disabled 更精致
Light / Dark 更完整
不同 Workspace 像同一个产品
~~~

工程侧应感知到：

~~~
基础 UI 重复代码减少
基础交互 bug 减少
新页面不再重新造 Button / Input / Dialog
Theme 调整成本下降
CSS primitive debt 降低
Accessibility 基线提高
~~~

## 47. Anti-goals

如果迁移完成后 Docus 看起来像：

~~~
Naive UI Admin
组件库 Showcase
企业后台模板
~~~

则本项目失败。

最终应该仍然明显是：

> **Docus**

只是基础交互更加统一、成熟、精致。

## 48. 冻结决策

以下决策在 Product Review 中视为当前冻结 baseline：

### Architecture

~~~
Naive UI = Primitive / Interaction Foundation
Docus = Product / Domain / Layout Authority
~~~

### Theme

~~~
Docus Semantic Tokens = Source of Truth
Naive UI Theme = Consumer
~~~

### Appearance Authority

~~~
useTheme = 唯一 Light / Dark authority
~~~

### Provider

~~~
独立 DocusUiRoot 包裹 App
~~~

### Wrappers

~~~
禁止机械 wrapper
允许有真实 domain semantics 的 wrapper
~~~

### Migration

~~~
Incremental
不是 Big Bang
~~~

### Workspace Order

~~~
Foundation
→ Overlay / Feedback
→ Primitives
→ Shared Chrome
→ Diary
→ Ledger
→ Vault / Note
→ Cleanup
~~~

### Existing technologies

~~~
ECharts 保留
Markdown 保留
Shiki 保留
Mermaid 保留
Markmap 保留
Monaco 保留
~~~

## 49. Open Questions

Product Review 当前只需要重点确认以下问题：

### Q1. Phase 0 是否允许只做技术 Spike、不产生用户可见 UI 变化？

推荐：**允许。**

### Q2. Legacy semantic token alias 是否保留到最终 Cleanup Phase？

推荐：**是。**

### Q3. useToast / useConfirm / usePrompt 是否保持为 Docus public composable API？

推荐：**是。**

### Q4. Ledger 是否必须在 Diary 之后迁移？

推荐：**是。**

原因是 Ledger 当前刚完成视觉稳定化，不适合作为第一个完整 Workspace migration target。

### Q5. Vault 与 Note 是否作为最后一组高风险迁移？

推荐：**是。**

## 50. Product Review Exit Criteria

Product Review 通过前必须确认：

- Naive UI 与 Docus 的职责边界无歧义；
- Token ownership 无歧义；
- Theme authority 无歧义；
- Provider architecture 无歧义；
- Wrapper policy 无歧义；
- Card / Menu / Tabs 使用边界明确；
- Feedback / Overlay migration strategy 明确；
- Workspace migration order 明确；
- Big Bang migration 被明确禁止；
- Ledger Visual Language 要求保留；
- Vault / Note 高风险顺序明确；
- Existing renderer / editor / ECharts 不迁移；
- Phase exit criteria 可执行；
- 没有要求业务层因 UI library 改变 domain behavior；
- Blocking Open Questions = 0。

这份 PRD 进入正式 **Product Review**。

它的核心定位不是“安装 Naive UI 的 PRD”，而是 **Docus UI Foundation 重构 PRD**。后续 Implementation Plan 负责回答：

~~~
Naive UI 具体版本
具体 Provider nesting
themeOverrides 字段
哪些文件先迁
每一阶段 commit sequence
测试如何改
CSS 如何逐步退出
bundle baseline 怎么测
~~~

这样产品职责与实现职责保持清晰。

