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

## 2. 背景

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

## 3. 产品目标

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

## 4. 非目标

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

## 5. 技术方案

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

## 6. 架构原则

### 6.1 Excalidraw 只是画布引擎

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

### 6.2 禁止直接把 Excalidraw 当业务模型

不得出现类似设计：

```text
Board = Excalidraw JSON
```

而应该：

```text
Board
├── Metadata
├── Engine
├── Scene Version
├── Engine Data
└── Assets
```

例如：

```ts
interface Board {
  id: string
  title: string

  engine: 'excalidraw'

  sceneVersion: number

  scene: BoardScene

  createdAt: number
  updatedAt: number
}
```

其中：

```ts
interface BoardScene {
  engineData: unknown
  persistentAppState: BoardPersistentAppState
  assetRefs: readonly string[]
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

## 7. Board 信息架构

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

## 8. Board 列表

### 8.1 页面结构

Board 首页负责管理所有白板。

V1 采用纯 Gallery Home，不提供 Folder、FileTree 或 Board Directory。
首页固定由 Recent 和 All Boards 两个画廊区域组成；All Boards 默认按
`updatedAt DESC` 排序。

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

## 9. Board Card

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

## 10. Thumbnail

Board 应支持生成预览图。

Thumbnail 用于 Board 列表快速识别内容。

生成时机：

```text
Scene 保存成功
      ↓
Thumbnail 标记为 dirty
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

## 11. 创建 Board

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

## 12. Board Editor

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

## 13. Header

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

## 14. Board 标题

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

## 15. 自动保存

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

## 16. Autosave 策略

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

## 17. 离开页面时保存

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

对于 Docus 内部 Route Leave、Back 和 Close Board，应主动等待 `flush()`，
尽量确保最后一次 Scene Change 被持久化。

包括：

```text
Back
Route Change
Close Board
Application Close
```

`beforeunload` 只能作为 Browser Refresh、Tab Close 等场景下的 Best Effort，
不能作为数据安全机制；突发关闭由本地 Crash Checkpoint 提供额外恢复能力。

---

## 18. Scene 数据

Excalidraw Scene 主要包含：

```text
elements
appState
files
```

Docus 的持久层由 Board Domain 和 Canvas Engine Adapter 共同定义。
Engine-specific data 由 Adapter 序列化；`BinaryFiles` 只作为 Excalidraw
运行时数据组装，不与 Docus Asset Store 双重长期保存。

Docus 需要持久化 `engineData`（其中必须包含可恢复的 elements 数据）、
`persistentAppState` 和 `assetRefs`。这些字段由 Board Domain 与
`BoardEngineAdapter` 共同定义；Excalidraw `BinaryFiles` 仅在运行时组装。

---

### appState

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
gridSize
zoom
scrollX
scrollY
```

`theme` 不属于 Board Scene 的持久状态。Theme 由 Docus 全局状态负责，
Board 只持久化用户主动设置的 Canvas Background 等 Board-owned 字段。

最终字段根据 Excalidraw API 决定。

---

## 19. Files / Assets

图片等二进制资源不应该直接长期依赖 Excalidraw 内部临时状态。

长期持久化时必须以 Docus Asset Layer 作为图片和二进制资源的唯一真相源。

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

Scene 只保存 `fileId` 对应的 `assetRefs`。打开 Board 时由 Scene 和 Docus
Assets 组装 Excalidraw 所需的 `BinaryFiles`；不得同时长期保存完整的
Scene `BinaryFiles` 副本和 Asset Store 副本。

长期目标：

```text
Asset
├── image
├── attachment
└── other binary resource
```

Board 不重新建立一套完全独立于 Docus 的附件体系。

---

## 20. 删除 Board

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

## 21. 重命名

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

## 22. 搜索

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

## 23. 排序

Board 默认：

```text
updatedAt DESC
```

即最近编辑的 Board 排在最前面。

V1 暂不提供复杂排序切换。

---

## 24. 导出

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

## 25. Excalidraw UI

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

## 26. Theme

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

Theme 的 Source of Truth 是 Docus 全局主题，不属于 Board Scene 持久状态。
Board 只拥有用户主动设置的 Canvas Background 等 Board-owned 字段。

---

## 27. Board 背景

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

## 28. Fullscreen 思维

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

## 29. 键盘快捷键

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

## 30. Docus Shortcut 冲突

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

## 31. Board 与 Note 的关系

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

## 32. Resource Reference

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

## 33. Excalidraw customData

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

## 34. Internal Link

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

## 35. 数据模型

建议 Board Metadata：

```ts
interface Board {
  id: string

  title: string

  engine: 'excalidraw'

  sceneVersion: number

  scene: BoardScene

  thumbnail?: string

  createdAt: number
  updatedAt: number
}
```

实际实现应根据 Docus 当前 Storage Architecture 调整。

---

## 36. BoardScene

建议：

```ts
interface BoardScene {
  engineData: unknown

  persistentAppState: BoardPersistentAppState

  assetRefs: readonly string[]
}
```

其中，Board 的 `sceneVersion` 表示当前 Board Scene Schema 版本，非常重要。
`engineData` 的具体格式由 `BoardEngineAdapter` 管理，Board Service 不直接
依赖 Excalidraw 类型。不能假定未来 Scene Schema 永远不变化。

---

## 37. Scene Version

初始：

```text
sceneVersion = 1
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

## 38. 数据兼容原则

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

## 39. 错误恢复

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

## 40. 保存异常

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

## 41. Loading

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

## 42. Empty State

没有任何 Board：

```text
No boards yet

Turn ideas into a visual space.

[Create Board]
```

避免放过多说明。

---

## 43. Board List Context Menu

V1：

```text
Open

Rename

────────

Delete
```

如果单击 Card 已经负责 Open，则 Context Menu 中可以省略 Open。

---

## 44. Editor Menu

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

## 45. 页面刷新

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

## 46. URL

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

## 47. 搜索系统集成

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

## 48. 性能目标

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

## 49. 大型 Board

V1 不需要针对超大型 Scene 做复杂虚拟化。

但是需要避免人为制造性能问题：

* 不在每次 Pointer Move 写数据库
* 不在每次 Change 生成 Thumbnail
* 不在每次 Change JSON Deep Clone 多次
* 不在 Scene 变化时触发整个应用状态树更新

---

## 50. 可访问性

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

## 51. V1 功能范围

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

## 52. V1 不包含

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

## 53. 后续版本方向

### V1.1

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

## 54. V1.2

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

## 55. 长期方向

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

## 56. 产品原则

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

## 57. 验收标准

### 创建

* 可以从 Board 首页创建新 Board。
* 创建后自动进入 Editor。
* 默认标题为 `Untitled Board`。
* 不需要填写 Modal。

### 编辑

* 可以正常使用 Excalidraw 基础绘图工具。
* 可以移动、删除、修改 Element。
* Undo / Redo 正常。
* 图片插入正常。

### 保存

* Scene 修改后自动保存。
* 用户不需要点击 Save。
* 保存期间可以显示 `Saving...`。
* 完成后显示 `Saved`。
* 离开页面前最后一次修改不会因为 Debounce 丢失。

### 恢复

* 关闭 Board 后重新进入，内容完全恢复。
* 刷新页面后内容完全恢复。
* Viewport 在合理范围内恢复。

### 数据安全

* Scene 加载失败不能覆盖原数据。
* Scene 未加载完成前不能触发空 Scene Autosave。
* 保存失败不能错误显示 `Saved`。

### Board 管理

* 可以重命名。
* 可以删除。
* 删除需要确认。
* 默认按最近更新时间排序。

### 搜索

* Board List 可以按照标题搜索。
* Docus Global Search 可以找到 Board Title。

### Theme

* Light Mode 正常。
* Dark Mode 正常。
* 跟随 Docus Theme。

### Export

* 可以导出 PNG。
* 可以导出 SVG。

### 性能

* 正常规模 Board 编辑过程中无明显卡顿。
* 拖动 Element 不会持续写入数据库。
* Scene Change 不会导致整个 Docus 页面频繁重渲染。

---

## 58. 最终定义

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

---

## 59. Board V1 开发约束补充（冻结）

以下内容是已经确认的产品与架构决策。

Implementation Plan 和后续编码必须遵守这些约束。

如果当前 PRD 中存在与以下内容冲突、含糊或未定义的部分，以本补充为准，并同步修正 PRD。

---

### 1. Board 首页采用纯 Gallery Home

Board V1 首页已经确定采用纯画廊式首页。

结构：

```text
Board

[ Search boards... ]                         [ + New Board ]

Recent
────────────────────────────────────────────────────────
[ Thumbnail ]  [ Thumbnail ]  [ Thumbnail ]  [ Thumbnail ]

All Boards
────────────────────────────────────────────────────────
[ Thumbnail ]  [ Thumbnail ]  [ Thumbnail ]  [ Thumbnail ]
[ Thumbnail ]  [ Thumbnail ]  [ Thumbnail ]  [ Thumbnail ]
```

Board Card 至少包含：

```text
Thumbnail
Title
Updated Time
```

默认：

```text
All Boards = updatedAt DESC
```

Recent 展示最近编辑的若干 Board。

---

### 2. V1 不实现 Folder / FileTree

Board V1 明确不包含：

```text
❌ Folder
❌ Folder Tree
❌ Board Directory
❌ 左侧文件树
❌ Board 拖入文件夹
❌ Folder 创建 / 删除 / 重命名
```

不要直接复用：

```text
src/components/vault/FileTree.vue
```

作为 Board UI。

现有 FileTree 已经包含：

```text
Note
Tag
Diary
Archive
Metadata
Document Lifecycle
```

等 Vault 领域逻辑，它不是通用 Board 组件。

因此：

```text
Board Home ≠ FileTree
```

不要为了未来可能出现的 Folder 需求，提前重构现有 FileTree 或建立复杂的 Workspace Tree Framework。

未来如确认需要目录组织，再从：

```text
Recent
All Boards
```

演进为：

```text
Recent
Folders
All Boards
```

---

### 3. Excalidraw 必须通过 React Island 集成

Docus 当前前端主体技术栈为：

```text
Vue 3
Vue Router
Vite
TypeScript
```

而：

```text
@excalidraw/excalidraw
```

是 React Component。

因此禁止在 Vue 组件体系中无边界地混用 React 状态。

应建立明确的 Bridge：

```text
BoardEditor.vue
      │
      ▼
ExcalidrawHost
      │
      ▼
React createRoot()
      │
      ▼
<Excalidraw />
```

推荐类似：

```text
Vue Workspace
    │
    └── BoardEditor.vue
            │
            └── ExcalidrawHost.ts
                    │
                    └── React Root
                            │
                            └── Excalidraw
```

---

#### 3.1 React Island 边界

React 只负责：

```text
Excalidraw rendering
Excalidraw API
Scene event bridge
```

Vue 负责：

```text
Board lifecycle
Routing
Metadata
Save status
Board title
Docus theme
Board service
```

禁止：

```text
Excalidraw 高频 onChange
        ↓
Vue Global Store
        ↓
整个 Docus 响应式更新
```

Scene 的高频变化必须限制在 Board Editor 局部边界内。

---

#### 3.2 按需加载

React、React DOM 和 Excalidraw 必须尽量只在：

```text
/board/:boardId
```

进入 Board Editor 时加载。

不要让：

```text
Note
Diary
Ledger
Login
Setup
```

等页面承担 Excalidraw 的初始 Bundle 成本。

优先使用：

```text
dynamic import
lazy loading
code splitting
```

---

### 4. Board Domain 不等于 Excalidraw 数据

必须保持：

```text
Board
    ≠
Excalidraw JSON
```

Board 是 Docus Domain。

Excalidraw 是 Board 当前使用的 Canvas Engine。

建议明确以下边界：

```text
Board
├── metadata
├── engine
├── sceneVersion
├── engineData
└── assets
```

例如：

```ts
interface Board {
  id: string
  title: string

  engine: 'excalidraw'

  sceneVersion: number

  scene: BoardScene

  createdAt: number
  updatedAt: number
}
```

---

### 5. 增加 Canvas Engine Adapter 边界

不要让 Board Service 到处直接依赖 Excalidraw API。

建议存在类似：

```text
BoardEngineAdapter
```

职责：

```text
load scene
serialize scene
deserialize scene
export PNG
export SVG
generate thumbnail
normalize persistent app state
```

例如概念模型：

```ts
interface BoardEngineAdapter {
  serialize(...)
  deserialize(...)
  exportPng(...)
  exportSvg(...)
  generateThumbnail(...)
}
```

V1 只有：

```text
ExcalidrawBoardEngineAdapter
```

即可。

目的不是为了现在实现第二种 Canvas Engine。

而是为了明确：

```text
哪些属于 Docus
哪些属于 Excalidraw
```

避免 Excalidraw 类型泄漏到整个 Board Domain。

不要为了这一点做过度抽象。

保持最小必要 Adapter 即可。

---

### 6. Scene Schema 必须版本化

Board Scene 必须包含：

```text
sceneVersion
```

初始：

```text
sceneVersion = 1
```

加载时：

```text
Stored Scene
    ↓
Read version
    ↓
Migration
    ↓
Current Scene
```

应为未来预留：

```ts
migrateBoardScene(...)
```

不要假设：

```text
Excalidraw 当前 JSON
```

会永远与未来版本兼容。

---

### 7. 不要持久化完整 Excalidraw AppState

Excalidraw 的：

```text
AppState
```

包含大量临时 UI 状态。

禁止直接：

```text
JSON.stringify(appState)
```

完整写入持久层。

应建立：

```text
BoardPersistentAppState
```

只保存确实需要恢复的字段。

例如：

```text
zoom
scrollX
scrollY
gridSize
viewBackgroundColor
```

最终字段以实际 Excalidraw API 和需求为准。

不要保存：

```text
selectedElementIds
editingElement
draggingElement
contextMenu
openDialog
```

等运行时状态。

---

### 8. Theme 不属于 Board Scene 的持久状态

Docus Theme 是全局 Source of Truth。

因此：

```text
Docus Theme
      ↓
Excalidraw Theme
```

禁止 Board Scene 单独持久化一个长期有效的：

```text
theme
```

并在重新打开 Board 后覆盖 Docus 当前 Theme。

正确关系：

```text
Light / Dark / System
        ↓
Docus Theme
        ↓
Board Editor
        ↓
Excalidraw
```

但是：

```text
viewBackgroundColor
```

可以属于 Board 自身状态。

因为用户可能主动设置某个 Board 的背景。

因此：

```text
Theme
→ Docus-owned

Canvas Background
→ Board-owned
```

两者必须区分。

---

### 9. BinaryFiles 与 Docus Asset 必须只有一个 Source of Truth

当前 PRD 中存在潜在冲突：

一方面：

```ts
BoardScene {
  files: BinaryFiles
}
```

另一方面又要求：

```text
图片由 Docus Asset Layer 管理
```

V1 实现时必须消除这个双重真相源。

长期持久层应以：

```text
Docus Asset
```

作为图片 / 二进制资源的 Source of Truth。

概念模型：

```text
Board
  │
  └── Scene Element
          │
          └── fileId
                │
                ▼
           Docus Asset
```

打开 Board 时：

```text
Board Scene
+
Docus Assets
     ↓
组装
     ↓
Excalidraw BinaryFiles
```

即：

```text
BinaryFiles
```

主要作为 Excalidraw runtime 数据。

不要同时长期保存：

```text
Scene 内一份完整 BinaryFiles
+
Asset Store 再保存一份
```

从而产生双副本和一致性问题。

---

### 10. Asset 删除必须考虑引用关系

不要简单地：

```text
删除 Board
    ↓
删除所有相关图片
```

除非确认该 Asset 只属于该 Board。

需要明确资产所有权策略。

至少保证：

```text
Asset 不会因为错误 GC
而导致其他内容引用失效
```

V1 如果 Board Asset 完全私有，可以采用：

```text
boardId scoped assets
```

但这个决定必须显式写进 Implementation Plan。

---

### 11. Autosave 使用 Debounce，但必须区分内存状态与持久状态

推荐：

```text
Excalidraw onChange
       ↓
latestSceneRef
       ↓
mark dirty
       ↓
debounce
       ↓
Board save
```

不要让每次 Pointer Move：

```text
写数据库
```

建议保存 Debounce：

```text
500ms ~ 1000ms
```

具体值实现阶段确定。

---

### 12. Route Change 可以 flush，但不能依赖 beforeunload 保证数据安全

对于 Docus 内部导航：

```text
Board
  ↓
Route Leave
```

应主动：

```text
await flush()
```

尽量保证最后的修改持久化。

但是：

```text
Browser Refresh
Tab Close
Browser Crash
Process Kill
Network Failure
```

场景中不能假设异步 Server Save 一定执行完成。

因此：

```text
beforeunload flush
```

只能作为 Best Effort。

不能作为数据安全机制。

---

### 13. Board 需要本地 Crash Checkpoint

Board 应参考 Docus 已有 Draft / Recovery 的产品思想。

目标是：

即使：

```text
Server Autosave
```

尚未成功，而页面突然关闭，

仍尽量可以恢复最近编辑内容。

建议架构：

```text
Excalidraw onChange
        │
        ├── debounce → Server Persist
        │
        └── local checkpoint
```

Local checkpoint 可以使用项目中合适的本地持久化方式。

Implementation Plan 应明确：

```text
checkpoint 写入时机
checkpoint key
checkpoint 清理时机
server 保存成功后的 reconciliation
恢复策略
```

但不要无必要地直接复用整个 Note Draft Recovery 系统。

优先复用其思想和通用基础能力，而不是强行共享 Note 领域代码。

---

### 14. Board Load 必须 Fail Closed

这是 P0 数据安全要求。

禁止：

```text
Load Board
    ↓
Load Failed
    ↓
Mount Empty Board
    ↓
onChange
    ↓
Autosave
    ↓
覆盖原数据
```

必须：

```text
Load Board
    ↓
Validate Scene
    ↓
Success
    ↓
Mount Excalidraw
```

失败：

```text
Load Board
    ↓
Parse / Migration / Asset Error
    ↓
STOP
    ↓
Error Recovery UI
```

此时：

```text
Autosave disabled
```

不能把 Empty Scene 写回。

---

### 15. Initial Mount 必须避免 Empty Scene Autosave

Excalidraw 首次初始化时可能产生状态变化。

因此需要区分：

```text
loading
hydrating
ready
error
```

至少在：

```text
ready
```

之前禁止业务 Autosave。

推荐类似：

```text
Load Board Data
      ↓
Load Assets
      ↓
Migrate Scene
      ↓
Mount Excalidraw
      ↓
Hydration Completed
      ↓
autosaveEnabled = true
```

---

### 16. Save 状态必须基于真实持久化结果

允许：

```text
Saving...
Saved
Save failed
```

禁止：

```text
debounce timer 执行
    ↓
立即显示 Saved
```

正确：

```text
Save request
    ↓
Server success
    ↓
Saved
```

失败：

```text
Save failed
```

但用户当前 Scene 仍必须保留在内存 / checkpoint 中。

---

### 17. 必须考虑并发保存顺序

高频编辑时可能出现：

```text
Save A
Save B
```

如果：

```text
B 先完成
A 后完成
```

不能让旧 Scene A 覆盖新 Scene B。

Implementation Plan 必须说明至少一种处理方式：

```text
serial save queue
```

或者：

```text
revision / expectedVersion
```

或者：

```text
latest-write token
```

总之必须保证：

```text
旧请求不能覆盖新状态
```

---

### 18. Board Metadata 与 Scene 保存应明确边界

以下数据：

```text
title
createdAt
updatedAt
thumbnail
engine
sceneVersion
```

属于 Board Metadata。

以下：

```text
elements
persistentAppState
assetRefs
```

属于 Scene。

不要把所有内容塞进一个巨大 JSON 后再整体覆写。

Implementation Plan 应明确：

```text
Metadata Store
Scene Store
Asset Store
```

之间的关系。

不要求必须三张数据库表。

但领域边界必须明确。

---

### 19. Thumbnail 不能绑定每次 Scene Change

Thumbnail 属于派生数据。

推荐：

```text
Scene save success
      ↓
thumbnail dirty
      ↓
long debounce / idle
      ↓
generate thumbnail
```

不要：

```text
pointer move
   ↓
render SVG / Canvas
   ↓
generate thumbnail
```

建议采用比 Autosave 更长的 Debounce。

例如：

```text
2s ~ 5s
```

Implementation Plan 可根据性能测试确定。

---

### 20. Thumbnail 生成失败不能影响 Scene 保存

必须保证：

```text
Scene 保存成功
Thumbnail 生成失败
```

时 Board 本身仍然是：

```text
Saved
```

Thumbnail 属于非关键派生数据。

可以保留旧 thumbnail 或显示 fallback。

---

### 21. Board Editor 不应该重复 Excalidraw 工具

Docus Header 只负责：

```text
Back
Board Title
Save Status
Board Menu
```

Excalidraw 已有：

```text
Shape
Arrow
Text
Color
Stroke
Zoom
Undo
Redo
```

不要重新在 Docus Header 中实现一套。

V1 优先使用 Excalidraw 原生 Editor UI。

---

### 22. Shortcut Ownership 必须明确

Board Editor 激活时：

```text
Ctrl/Cmd + Z
Ctrl/Cmd + C
Ctrl/Cmd + V
Ctrl/Cmd + A
Delete
Backspace
Space
```

优先属于 Excalidraw。

Docus Global Shortcut 不得错误拦截。

特别是在：

```text
Excalidraw text editing
input
textarea
contenteditable
```

场景。

Implementation Plan 应列出与现有 Docus shortcut system 的冲突检查。

---

### 23. 路由保持独立

Board 使用独立 Router：

```text
/board
/board/:boardId
```

不要把 Board 塞进：

```text
/vault/*
```

或 Note 文件路径体系。

Board 是一级 Workspace。

---

### 24. Board 不应该成为特殊类型的 Note

禁止设计：

```ts
note.type = 'board'
```

或者：

```text
src/content/xxx.board.md
```

作为 Board Domain 的基础模型。

Board 应拥有自己独立的 Domain / Storage。

Board 和 Note 后续通过：

```text
Resource Reference
```

互相连接，而不是继承关系。

---

### 25. Resource Reference V1 只预留，不实现

可以预留：

```ts
interface DocusResourceReference {
  type: 'note' | 'diary' | 'ledger' | 'board' | 'file'
  id: string
}
```

以及未来：

```text
Excalidraw customData
```

的绑定能力。

但是 V1 不开发：

```text
Note Card
Diary Card
Ledger Card
Board Card
```

不要因为已经预留接口就提前实现。

---

### 26. 不提前开发 Custom Shape Framework

V1 使用 Excalidraw 原生：

```text
Rectangle
Ellipse
Diamond
Text
Arrow
Line
Image
Free Draw
```

即可。

不要为了未来 Note Card：

```text
fork Excalidraw
修改 Excalidraw core
开发 Docus Shape Engine
```

除非 Implementation 过程中发现真正的 blocker。

---

### 27. 删除 Board 的行为必须明确

V1 当前产品定义是：

```text
Delete Board
→ confirmation
→ permanent delete
```

如果实现过程中发现 Docus 已经存在可复用的统一 Trash Domain，可以重新评估接入。

否则不要为了 Board V1 新开发全局 Trash 系统。

删除时至少处理：

```text
metadata
scene
board-private assets
thumbnail
local checkpoint
```

---

### 28. Search V1 只搜索 Board Metadata

V1：

```text
Search Board Title
```

即可。

不要实现：

```text
Scene text full-text search
OCR
Shape indexing
Asset indexing
```

这些属于后续版本。

---

### 29. 保持 Board State 局部化

不要把整个：

```text
elements[]
```

长期放入 Docus 全局 Pinia / reactive state。

Board Editor 自己持有当前 Scene。

全局层只需要关心：

```text
boardId
title
saveStatus
updatedAt
```

等必要状态。

这样可以避免：

```text
拖动 Shape
    ↓
整个 App rerender
```

---

### 30. PRD Markdown 层级需要同步整理

当前 PRD 标题存在类似：

```text
# PRD
## 1.
# 2.
# 3.
```

这种层级不一致。

同步修正为统一结构，例如：

```text
# PRD - Board 白板

## 1. 产品定义

## 2. 背景

## 3. 产品目标

### 3.1 ...
```

这属于文档质量问题，不影响产品功能，但应在 Implementation Plan 前整理。

---

### 31. Implementation Plan 必须明确回答的问题

在开始编码前，请输出 Implementation Plan，并明确回答：

```text
1. Vue 与 React/Excalidraw 如何隔离？
2. React/Excalidraw 如何按需加载？
3. Board Domain Model 如何定义？
4. Board Scene 如何版本化？
5. 哪些 AppState 字段持久化？
6. Theme 与 Canvas Background 的 Source of Truth 分别是什么？
7. BinaryFiles 与 Docus Asset 如何映射？
8. Autosave 如何 debounce？
9. 如何防止旧 Save 覆盖新 Save？
10. Route Leave 如何 flush？
11. Browser Crash / Tab Close 如何恢复？
12. Loading 阶段如何避免 Empty Scene 覆盖？
13. Thumbnail 在何时生成？
14. Board 首页如何实现 Recent + All Boards？
15. 为什么不复用 FileTree.vue？
16. Board Router 如何加入现有 App Shell？
17. Board Shortcut 如何避免与 Docus 冲突？
18. 删除 Board 时如何清理 Scene / Asset / Thumbnail / Checkpoint？
```

这些问题回答清楚以后，再进入编码。

---

### 最终原则

Board V1 必须保持：

```text
产品简单
架构边界清晰
数据安全优先
Excalidraw 可替换但不过度抽象
不提前开发未来功能
```

最终目标仍然只是：

```text
Create Board
    ↓
Draw
    ↓
Autosave
    ↓
Close
    ↓
Reopen
    ↓
Everything is still there
```

任何超出这个闭环的复杂度，都需要证明其对 V1 是必要的。

这里面我尤其建议你把 **第 9、12、13、17** 留着。

因为白板真正容易出事故的地方不是“画不出来”，而是：

**图片资产双份保存、空 Scene 覆盖、关闭时最后几秒数据丢失、旧保存请求反过来覆盖新 Scene。**

这几个坑一旦进生产，处理起来会比 UI 问题麻烦很多。
