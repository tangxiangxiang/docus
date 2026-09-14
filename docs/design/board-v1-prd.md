# PRD - Board 白板

**日期：** 2026-09-14
**模块：** Board
**状态：** 📋 规划中
**版本：** V1
**优先级：** P1

---

## 1. 产品定义

Board 是 Docus 内置的无限白板 Workspace。

它用于承载不适合以线性文档表达的内容，例如：

* 思维整理
* 灵感草稿
* 流程设计
* 系统架构
* 关系梳理
* 自由绘制
* Note 之间的空间组织

Docus 当前的一等 Workspace 定义为：

```text
Note    → 我知道什么
Diary   → 我经历了什么
Ledger  → 我的钱发生了什么
Board   → 我的想法如何关联
```

Board 与 Note 属于平级 Workspace。

Board 不是 Note 的一种类型，也不依附于 Note 存在。

---

# 2. 背景

Note 擅长表达具有明确阅读顺序的线性内容。

例如：

```text
标题

段落

段落

代码

图片

列表
```

但在以下场景中，线性文档并不是最合适的表达方式：

```text
需求
  ↓
设计 ─────→ 数据库
  │           │
  ↓           ↓
前端 ←────── API
```

或者：

```text
          Ledger
             │
      ┌──────┴──────┐
      ↓             ↓
   Account      Transaction
      │             │
      └──────┬──────┘
             ↓
          Statistics
```

这些内容更依赖：

* 空间位置
* 连线关系
* 分组
* 图形
* 自由布局

因此 Docus 需要一个独立的空间型 Workspace。

Board 即承担这一职责。

---

# 3. 产品目标

Board V1 的目标不是构建完整的专业设计工具。

第一阶段只需要实现一个：

> 简单、可靠、可长期保存，并且与 Docus 整体体验一致的个人无限白板。

V1 应完成以下完整闭环：

```text
创建 Board
    ↓
进入白板
    ↓
绘制 / 编辑
    ↓
自动保存
    ↓
退出
    ↓
重新打开
    ↓
恢复上一次内容
```

同时支持：

```text
重命名
删除
搜索
导出
深色模式
```

---

# 4. 非目标

以下能力不属于 Board V1：

* 多人实时协作
* 在线共享编辑
* 评论系统
* Board 权限系统
* Presentation Mode
* Board Template
* AI 自动生成白板
* Mind Map 自动布局
* Mermaid 转白板
* Kanban
* Database View
* 富交互 Note Card
* Ledger Card
* Diary Card
* Query Card
* Board 嵌套
* Board 历史版本
* 实时云同步冲突解决

这些功能可以在后续版本中单独规划。

---

# 5. 技术方案

Board V1 使用：

```text
@excalidraw/excalidraw
```

作为底层 Infinite Canvas Engine。

Excalidraw 负责：

```text
Canvas
├── Shape
├── Rectangle
├── Diamond
├── Ellipse
├── Arrow
├── Line
├── Free Draw
├── Text
├── Image
├── Selection
├── Multi Selection
├── Resize
├── Rotate
├── Zoom
├── Pan
├── Undo
├── Redo
└── Export Scene
```

Docus 不重新实现上述基础能力。

---

# 6. 架构原则

## 6.1 Excalidraw 只是画布引擎

Board 的产品模型不能直接等同于 Excalidraw。

整体关系：

```text
Docus
  │
  └── Board
        │
        ├── Board List
        ├── Board Metadata
        ├── Board Service
        ├── Board Storage
        ├── Search
        ├── Autosave
        ├── Resource Reference
        │
        └── Excalidraw
              │
              └── Canvas Engine
```

即：

> Board 属于 Docus。

> Excalidraw 属于 Board 的编辑器实现。

---

## 6.2 禁止直接把 Excalidraw 当业务模型

不得出现类似设计：

```text
Board = Excalidraw JSON
```

而应该：

```text
Board
├── Metadata
├── Scene
└── Assets
```

例如：

```ts
interface Board {
  id: string
  title: string

  scene: BoardScene

  createdAt: number
  updatedAt: number
}
```

其中：

```ts
interface BoardScene {
  elements: ExcalidrawElement[]
  appState: Partial<AppState>
  files: BinaryFiles
}
```

未来即使替换 Excalidraw：

```text
Excalidraw
     ↓
其他 Canvas Engine
```

Board 本身依然可以存在。

---

# 7. Board 信息架构

Board 作为 Docus 一级 Workspace。

侧边栏：

```text
Home

Note
Diary
Ledger
Board

────────────

Search
Settings
```

点击：

```text
Board
```

进入 Board 列表。

---

# 8. Board 列表

## 8.1 页面结构

Board 首页负责管理所有白板。

建议结构：

```text
┌──────────────────────────────────────────────┐
│ Board                              + New Board│
├──────────────────────────────────────────────┤
│                                              │
│ Search boards...                             │
│                                              │
│ ┌────────────┐ ┌────────────┐ ┌────────────┐ │
│ │            │ │            │ │            │ │
│ │ Thumbnail  │ │ Thumbnail  │ │ Thumbnail  │ │
│ │            │ │            │ │            │ │
│ ├────────────┤ ├────────────┤ ├────────────┤ │
│ │ 架构设计    │ │ Ledger     │ │ Ideas      │ │
│ │ 2 min ago  │ │ Yesterday  │ │ Sep 10     │ │
│ └────────────┘ └────────────┘ └────────────┘ │
│                                              │
└──────────────────────────────────────────────┘
```

---

# 9. Board Card

每一个 Board 以 Card 展示。

Card 包含：

```text
Thumbnail

Title

Updated Time
```

例如：

```text
┌─────────────────────────┐
│                         │
│        Thumbnail        │
│                         │
├─────────────────────────┤
│ Ledger Architecture     │
│ Updated 2 minutes ago   │
└─────────────────────────┘
```

---

# 10. Thumbnail

Board 应支持生成预览图。

Thumbnail 用于 Board 列表快速识别内容。

生成时机：

```text
Board 保存
      ↓
Scene 改变
      ↓
延迟生成 Thumbnail
```

Thumbnail 不要求每次 Scene 改变立即刷新。

可以使用 Debounce。

例如：

```text
Scene changed

      ↓

Autosave
      ↓

Debounce 2 ~ 5 seconds
      ↓

Generate Thumbnail
```

避免频繁进行图片生成。

---

# 11. 创建 Board

点击：

```text
+ New Board
```

直接创建空 Board。

默认名称：

```text
Untitled Board
```

随后立即进入编辑器。

流程：

```text
New Board

   ↓

Create board record

   ↓

Generate board id

   ↓

Open Board Editor
```

不弹出创建 Modal。

目标是降低创建成本。

---

# 12. Board Editor

编辑器整体采用沉浸式设计。

建议：

```text
┌───────────────────────────────────────────────┐
│ ←  Untitled Board                    ···      │
├───────────────────────────────────────────────┤
│                                               │
│                                               │
│                                               │
│                Excalidraw                     │
│                                               │
│                                               │
│                                               │
└───────────────────────────────────────────────┘
```

进入 Board 后，应尽可能减少 Docus 自身 UI 对画布空间的占用。

---

# 13. Header

Board 顶部仅保留必要操作。

左侧：

```text
←

Board Title
```

右侧：

```text
Saved

...

```

禁止在 Header 中堆积大量按钮。

Excalidraw 已有的工具，不应在 Docus Header 中重复。

---

# 14. Board 标题

标题支持直接编辑。

例如：

```text
Ledger Architecture
```

点击标题：

```text
Ledger Architecture
        ↓
[input]
```

Blur 或 Enter：

```text
Save title
```

如果标题为空：

```text
Untitled Board
```

---

# 15. 自动保存

Board 不提供手动 Save 按钮。

所有修改自动保存。

包括：

* 新增 Element
* 删除 Element
* 移动 Element
* Resize
* 修改文本
* 修改颜色
* 修改连线
* 修改图片
* 修改 Board Title

状态：

```text
Saving...

Saved
```

正常情况下只短暂出现。

---

# 16. Autosave 策略

禁止：

```text
onChange
   ↓
立即写数据库
```

因为 Excalidraw 拖动 Element 时可能连续触发大量 Change。

应使用 Debounce。

例如：

```text
Excalidraw onChange
        ↓
Update local state
        ↓
Debounce
        ↓
Board Service
        ↓
Storage
```

建议：

```text
500ms ~ 1000ms
```

范围内保存。

具体时间由实现阶段决定。

---

# 17. 离开页面时保存

如果用户在 Debounce 尚未触发时离开：

```text
Board
 ↓
Navigation
```

必须执行一次：

```text
flush()
```

确保最后一次 Scene Change 被持久化。

包括：

```text
Back
Route Change
Close Board
Application Close
```

在技术允许范围内最大程度保证数据不丢失。

---

# 18. Scene 数据

Excalidraw Scene 主要包含：

```text
elements
appState
files
```

Docus 需要保存：

```text
elements
```

必须保存。

---

## appState

只保存能够恢复用户工作环境且适合持久化的字段。

不要直接无脑持久化整个 AppState。

原因：

AppState 中包含大量运行时状态。

例如：

```text
selectedElementIds
contextMenu
openDialog
draggingElement
editingElement
```

这些状态不应该进入持久层。

需要建立：

```text
BoardPersistentAppState
```

只保存必要内容。

例如：

```text
viewBackgroundColor
theme
gridSize
zoom
scrollX
scrollY
```

最终字段根据 Excalidraw API 决定。

---

# 19. Files / Assets

图片等二进制资源不应该直接长期依赖 Excalidraw 内部临时状态。

需要通过 Docus Asset Layer 管理。

逻辑：

```text
Board
  │
  └── Image Element
          │
          ↓
       fileId
          │
          ↓
     Docus Asset
```

长期目标：

```text
Asset
├── image
├── attachment
└── other binary resource
```

Board 不重新建立一套完全独立于 Docus 的附件体系。

---

# 20. 删除 Board

Card Context Menu：

```text
Rename
Delete
```

删除属于破坏性操作。

必须确认：

```text
Delete board?

This board will be permanently deleted.

Cancel
Delete
```

V1 暂不提供：

```text
Trash
Restore
```

如果 Docus 已经存在统一 Trash 系统，则应接入统一 Trash。

---

# 21. 重命名

支持两处重命名：

```text
Board Card
    ↓
Context Menu
    ↓
Rename
```

以及：

```text
Board Editor
    ↓
Title
```

二者修改的是同一 Metadata。

---

# 22. 搜索

Board List 支持标题搜索。

V1：

```text
Search by Board Title
```

不要求搜索：

```text
Element Text
```

原因：

Scene 内全文搜索需要额外建立索引机制。

后续再加入。

---

# 23. 排序

Board 默认：

```text
updatedAt DESC
```

即最近编辑的 Board 排在最前面。

V1 暂不提供复杂排序切换。

---

# 24. 导出

Board 支持：

```text
Export PNG
Export SVG
```

入口：

```text
...
  ↓
Export
  ├── PNG
  └── SVG
```

可以优先复用 Excalidraw 官方导出能力。

---

# 25. Excalidraw UI

原则：

> 优先使用 Excalidraw 自己成熟的编辑器 UI。

不要为了追求 Docus 风格而过早重写：

```text
Toolbar
Color Picker
Stroke Settings
Shape Picker
Text Settings
Zoom
Selection UI
```

V1 保持 Excalidraw 原生行为。

Docus 仅对外围 UI 做统一。

---

# 26. Theme

Board 必须适配 Docus：

```text
Light
Dark
System
```

当 Docus Theme 改变：

```text
Docus Theme
     ↓
Board
     ↓
Excalidraw Theme
```

Excalidraw Theme 应同步变化。

---

# 27. Board 背景

Board Background 默认应与当前 Theme 协调。

Light：

```text
light canvas
```

Dark：

```text
dark canvas
```

用户修改 Canvas Background 后：

```text
User Setting
```

优先级高于默认 Theme。

具体行为需避免切换 Theme 时覆盖用户主动设置的背景颜色。

---

# 28. Fullscreen 思维

Board 属于强空间型 Workspace。

因此在 Board Editor 中，侧边栏可以考虑自动收起。

建议：

```text
进入 Board

     ↓

保持 Docus Sidebar 状态

或者

提供沉浸模式
```

V1 不强制全屏。

但设计时必须确保：

> Canvas 是页面视觉主体。

---

# 29. 键盘快捷键

优先继承 Excalidraw 自身快捷键。

Docus 不应重复拦截常用 Canvas Shortcut。

特别需要检查：

```text
Cmd / Ctrl + Z
Cmd / Ctrl + Shift + Z
Cmd / Ctrl + C
Cmd / Ctrl + V
Cmd / Ctrl + A
Delete
Backspace
Space
```

Board 激活状态下：

Excalidraw 应拥有这些快捷键的优先处理权。

---

# 30. Docus Shortcut 冲突

如果 Docus 存在全局快捷键：

```text
Cmd + K
Cmd + P
Cmd + N
...
```

需要明确：

```text
Global Shortcut
vs
Board Shortcut
```

的优先级。

原则：

Board 正在进行文本编辑时：

```text
Input / Text Editing
```

Docus 不得错误拦截键盘输入。

---

# 31. Board 与 Note 的关系

V1 中：

```text
Board
```

和：

```text
Note
```

是两个独立 Workspace。

不要求第一版实现 Note Card。

但是 Board 的技术设计必须为未来 Resource Reference 留出能力。

---

# 32. Resource Reference

未来 Docus 应具有统一资源引用模型：

```text
Resource Reference
├── Note
├── Diary
├── Ledger
├── Board
└── File
```

建议使用：

```ts
interface DocusResourceReference {
  type: 'note' | 'diary' | 'ledger' | 'board' | 'file'
  id: string
}
```

---

# 33. Excalidraw customData

未来需要将 Docus Resource 与 Element 绑定时，可以使用：

```text
customData
```

例如：

```ts
{
  customData: {
    docus: {
      type: 'resource',
      resourceType: 'note',
      resourceId: 'xxx'
    }
  }
}
```

但是：

> V1 不实现该能力。

当前只预留设计，不进入开发范围。

---

# 34. Internal Link

未来可以设计 Docus Internal Link：

```text
docus://note/{id}
docus://board/{id}
docus://diary/{id}
docus://ledger/{id}
```

Board 点击内部链接时由 Docus Router 接管。

该能力同样不属于 V1 必须项。

---

# 35. 数据模型

建议 Board Metadata：

```ts
interface Board {
  id: string

  title: string

  scene: BoardScene

  thumbnail?: string

  createdAt: number
  updatedAt: number
}
```

实际实现应根据 Docus 当前 Storage Architecture 调整。

---

# 36. BoardScene

建议：

```ts
interface BoardScene {
  version: number

  elements: readonly ExcalidrawElement[]

  appState: BoardPersistentAppState

  files: BinaryFiles
}
```

其中：

```text
version
```

非常重要。

不能假定未来 Scene Schema 永远不变化。

---

# 37. Scene Version

初始：

```text
version = 1
```

未来升级：

```text
V1 Scene
   ↓
Migration
   ↓
V2 Scene
```

例如：

```ts
migrateBoardScene(scene)
```

避免以后升级 Excalidraw 或 Board 数据模型时无法迁移已有白板。

---

# 38. 数据兼容原则

不要把数据库里的 Scene 当成不可控 JSON 黑盒。

需要明确：

```text
Board Schema Version

Docus Version

Excalidraw Data
```

之间的边界。

未来升级 `@excalidraw/excalidraw` 时必须验证已有 Scene 的兼容性。

---

# 39. 错误恢复

如果 Board Scene 加载失败：

不能直接显示空白白板并自动覆盖。

否则可能造成原始数据永久丢失。

正确行为：

```text
Load Scene
    ↓
Parse Failed
    ↓
STOP
    ↓
Show Error
```

禁止：

```text
Parse Failed
    ↓
Empty Scene
    ↓
Autosave
    ↓
覆盖原始数据
```

这是 Board 最重要的数据安全原则之一。

---

# 40. 保存异常

如果 Autosave 失败：

Header：

```text
Save failed
```

不得显示：

```text
Saved
```

用户继续编辑时，本地状态仍应保留。

再次发生变化或者恢复正常后可以重新尝试保存。

---

# 41. Loading

打开 Board：

```text
Loading Board
```

Scene 完成读取之前：

不要先初始化一个可编辑 Empty Excalidraw 再异步替换。

否则容易产生：

```text
empty scene
     ↓
onChange
     ↓
autosave
     ↓
覆盖旧数据
```

推荐：

```text
Load Board
    ↓
Scene Ready
    ↓
Mount Excalidraw
```

---

# 42. Empty State

没有任何 Board：

```text
No boards yet

Turn ideas into a visual space.

[Create Board]
```

避免放过多说明。

---

# 43. Board List Context Menu

V1：

```text
Open

Rename

────────

Delete
```

如果单击 Card 已经负责 Open，则 Context Menu 中可以省略 Open。

---

# 44. Editor Menu

Editor 顶部：

```text
...
```

V1：

```text
Export
 ├── PNG
 └── SVG

────────

Delete Board
```

重命名直接点击 Title，不需要重复放入菜单。

---

# 45. 页面刷新

Web 环境刷新页面：

```text
F5
```

Board 必须能够：

```text
boardId
   ↓
Load Metadata
   ↓
Load Scene
   ↓
Restore Canvas
```

刷新不能导致 Board 状态丢失。

---

# 46. URL

Board 建议拥有独立 Route。

例如：

```text
/board
```

Board List。

具体 Board：

```text
/board/:boardId
```

例如：

```text
/board/01K...
```

这样 Board 可以：

* 浏览器刷新
* Back / Forward
* Bookmark
* 后续 Internal Link

---

# 47. 搜索系统集成

如果 Docus 已经存在全局 Search：

V1 至少应允许搜索到：

```text
Board Title
```

搜索结果：

```text
Board

Ledger Architecture
Updated yesterday
```

点击直接：

```text
/board/:boardId
```

---

# 48. 性能目标

普通个人 Board 应保持流畅。

需要避免：

```text
onChange
  ↓
React global state
  ↓
整个 Docus rerender
```

Excalidraw Scene 更新不能频繁触发无关 Workspace 重渲染。

Board State 应尽量局部化。

---

# 49. 大型 Board

V1 不需要针对超大型 Scene 做复杂虚拟化。

但是需要避免人为制造性能问题：

* 不在每次 Pointer Move 写数据库
* 不在每次 Change 生成 Thumbnail
* 不在每次 Change JSON Deep Clone 多次
* 不在 Scene 变化时触发整个应用状态树更新

---

# 50. 可访问性

Board 自身复杂 Canvas Accessibility 主要依赖 Excalidraw。

Docus 外围 UI 必须保证：

```text
Button
Menu
Title Input
Delete Dialog
Board Card
```

具备正常 Keyboard Focus。

---

# 51. V1 功能范围

Board V1 最终 Scope：

```text
Board
├── Board 一级导航
│
├── Board List
│   ├── List / Grid
│   ├── Thumbnail
│   ├── Title
│   ├── Updated Time
│   ├── Search
│   ├── Create
│   ├── Rename
│   └── Delete
│
├── Board Editor
│   ├── Excalidraw
│   ├── Rename
│   ├── Autosave
│   ├── Save Status
│   ├── Dark Mode
│   └── Export
│       ├── PNG
│       └── SVG
│
├── Storage
│   ├── Metadata
│   ├── Scene
│   ├── Assets
│   ├── Schema Version
│   └── Error Recovery
│
└── Docus Integration
    ├── Router
    ├── Search
    └── Theme
```

---

# 52. V1 不包含

明确排除：

```text
❌ Collaboration

❌ Share Link

❌ Comments

❌ Note Card

❌ Diary Card

❌ Ledger Card

❌ Board Card

❌ Custom Shape

❌ AI Board

❌ Template

❌ Mind Map

❌ Kanban

❌ Presentation

❌ Version History

❌ Element Full Text Search

❌ Mobile Advanced Editing

❌ Cloud Conflict Resolution
```

---

# 53. 后续版本方向

## V1.1

优先考虑：

```text
Insert Note
```

用户：

```text
Board
  ↓
Insert
  ↓
Note
```

选择一个 Note：

```text
REQ-002 Ledger
```

生成一个简单的 Board Element：

```text
┌─────────────────────────────┐
│ 📝 REQ-002 Ledger           │
└─────────────────────────────┘
```

点击：

```text
Open Note
```

此阶段仍不需要富 React Card。

---

# 54. V1.2

可以进一步支持：

```text
Resource Reference
```

包括：

```text
Note
Board
Diary
Ledger
```

形成 Docus Workspace 之间的空间关联能力。

---

# 55. 长期方向

如果未来 Board 演变成：

```text
Canvas Application
```

而不仅仅是：

```text
Whiteboard
```

例如出现大量：

```text
Interactive Note Card
Database Card
Ledger Widget
Query Result
Task Widget
Embedded App
```

届时应重新评估 Excalidraw 是否仍然适合作为底层 Canvas Engine。

但 V1 不为这个假设提前增加复杂度。

---

# 56. 产品原则

Board 开发过程中遵循以下原则：

### 1. Board 是 Docus 的产品，Excalidraw 是实现

不能反过来。

### 2. 先完成可靠白板，再做知识关联

不要第一版就开发复杂 Note Card。

### 3. 数据安全优先于交互炫技

任何加载和保存逻辑都不能存在静默覆盖用户数据的风险。

### 4. 优先复用 Excalidraw

不要重复开发已经成熟的 Canvas 能力。

### 5. 保持 Workspace 边界

```text
Note ≠ Board
```

两者互相引用，但互不从属。

---

# 57. 验收标准

## 创建

* 可以从 Board 首页创建新 Board。
* 创建后自动进入 Editor。
* 默认标题为 `Untitled Board`。
* 不需要填写 Modal。

## 编辑

* 可以正常使用 Excalidraw 基础绘图工具。
* 可以移动、删除、修改 Element。
* Undo / Redo 正常。
* 图片插入正常。

## 保存

* Scene 修改后自动保存。
* 用户不需要点击 Save。
* 保存期间可以显示 `Saving...`。
* 完成后显示 `Saved`。
* 离开页面前最后一次修改不会因为 Debounce 丢失。

## 恢复

* 关闭 Board 后重新进入，内容完全恢复。
* 刷新页面后内容完全恢复。
* Viewport 在合理范围内恢复。

## 数据安全

* Scene 加载失败不能覆盖原数据。
* Scene 未加载完成前不能触发空 Scene Autosave。
* 保存失败不能错误显示 `Saved`。

## Board 管理

* 可以重命名。
* 可以删除。
* 删除需要确认。
* 默认按最近更新时间排序。

## 搜索

* Board List 可以按照标题搜索。
* Docus Global Search 可以找到 Board Title。

## Theme

* Light Mode 正常。
* Dark Mode 正常。
* 跟随 Docus Theme。

## Export

* 可以导出 PNG。
* 可以导出 SVG。

## 性能

* 正常规模 Board 编辑过程中无明显卡顿。
* 拖动 Element 不会持续写入数据库。
* Scene Change 不会导致整个 Docus 页面频繁重渲染。

---

# 58. 最终定义

Board V1 可以概括为：

```text
一个属于 Docus 的、
以 Excalidraw 为画布引擎的、
本地持久化的、
独立无限白板 Workspace。
```

它首先解决：

> 「我需要一个空间来组织和连接我的想法。」

而不是第一版就解决：

> 「我要构建一个完整的可编程 Canvas 平台。」

先把白板本身做到稳定、自然、可靠，再逐步让：

```text
Note
Diary
Ledger
Board
```

在这个空间中真正产生连接。

这版我特意把 **“加载失败禁止空 Scene 覆盖原数据”**、**Autosave flush**、**Scene Version** 和 **Excalidraw 不能等于 Board 业务模型** 写进了 PRD，我觉得这几个点后面实现时非常重要，否则白板功能很容易“看起来简单，实际上埋数据丢失的坑”。
