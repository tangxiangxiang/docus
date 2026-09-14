# Board V1 Implementation Plan

**日期：** 2026-09-14
**模块：** Board
**状态：** Ready for Implementation
**依据：** `docs/design/board-v1-prd.md`
**目标版本：** Board V1

---

## 1. 实现目标

Board V1 只完成以下核心闭环：

```
Board Home
    ↓
Create Board
    ↓
Open Editor
    ↓
Draw / Edit / Insert Image
    ↓
Autosave
    ↓
Close / Refresh
    ↓
Reopen
    ↓
Exact Scene Restored
```

同时完成：

```
Gallery Home
Rename
Delete
Search by title
Thumbnail
PNG / SVG Export
Light / Dark Theme
Crash Checkpoint
Revision Conflict Protection
Image Asset Persistence
```

不扩大到：

```
Folder
FileTree
Collaboration
Sharing
Templates
AI Board
Mind Map
Resource Card
Custom Shape
Version History
Cloud Sync
Full Asset GC
```

---

# 2. 总体架构

最终结构：

```
Docus
│
├── Vue App Shell
│   │
│   ├── BoardHomeView
│   │
│   └── BoardEditorView
│           │
│           └── ExcalidrawHost.vue
│                    │
│                    ▼
│              React Island
│                    │
│            BoardReactErrorBoundary
│                    │
│                    ▼
│               Excalidraw
│
├── Board Feature
│   ├── API
│   ├── Domain
│   ├── Save Coordinator
│   ├── Checkpoint
│   ├── Engine Adapter
│   └── Thumbnail
│
└── Server
    ├── Board Domain
    ├── Asset Domain
    ├── SQLite
    └── data/assets/
```

核心原则：

```
Vue owns Board product lifecycle

React owns Excalidraw rendering

BoardEngineAdapter owns Excalidraw translation

SQLite owns Board metadata / scene metadata

data/assets owns binary bytes

IndexedDB owns unsaved crash recovery
```

---

# 3. Dependency Strategy

新增：

```
@excalidraw/excalidraw
react
react-dom
@types/react
@types/react-dom
```

不要默认增加：

```
@vitejs/plugin-react
```

第一版 React Island 不使用 JSX。

使用：

```
React.createElement(...)
createRoot(...)
```

实现 Island。

原因：

```
现有 Vite
  +
Vue Plugin
  +
dynamic Board Editor chunk
```

已经足够承载一个隔离的 React subtree。

这样不需要改变整个 Docus 的 Vite 编译体系。

只有实际安装后的兼容性 Spike 证明必须增加 React Vite Plugin 时才能调整。

Excalidraw CSS 也从 React Island chunk 内按需加载。

---

# 4. Shared Protocol

新增：

```
shared/boardProtocol.ts
shared/assetProtocol.ts
```

Board Domain：

```
interface BoardMetadata {
  id: string
  title: string
  thumbnail?: string
  createdAt: number
  updatedAt: number
}

interface BoardSceneRecord {
  boardId: string
  engine: 'excalidraw'
  sceneVersion: number
  revision: number
  scene: BoardScene
}

interface BoardScene {
  engineData: unknown
  persistentAppState: BoardPersistentAppState
  assetRefs: readonly string[]
}

interface BoardPersistentAppState {
  zoom?: number
  scrollX?: number
  scrollY?: number
  gridSize?: number | null
  viewBackgroundColor?: string
}
```

Server authoritative fields：

```
engine
sceneVersion
revision
```

只能属于：

```
BoardSceneRecord
```

---

# 5. Asset ID 与 Excalidraw File ID 必须分离

不要：

```
Excalidraw fileId
=
Docus assetId
```

Docus 自己生成：

```
assetId = crypto.randomUUID()
```

Excalidraw Engine Adapter 内部维护：

```
interface ExcalidrawEngineDataV1 {
  elements: unknown[]

  fileMap: Record<
    string, // Excalidraw fileId
    string  // Docus assetId
  >
}
```

例如：

```
Excalidraw fileId
       │
       ▼
   fileMap
       │
       ▼
Docus Asset ID
```

这样未来替换 Canvas Engine 时：

```
Docus Asset ID
```

不会依赖 Excalidraw 的 ID 规则。

`BoardScene.assetRefs`：

```
=
unique(fileMap.values())
```

Adapter serialize 时必须校验二者一致。

---

# 6. Database Migration

当前 migration 到 `0029`。

预定新增：

```
0030_asset_foundation.sql
0031_board_foundation.sql
```

实施前重新检查 main 最新 migration。

如果届时已有新的 migration：

```
只向后顺延编号
不得修改已经存在的 migration
```

---

## 6.1 assets

```
CREATE TABLE assets (
  id TEXT PRIMARY KEY NOT NULL,

  mime_type TEXT NOT NULL,

  byte_size INTEGER NOT NULL,

  sha256 TEXT NOT NULL,

  storage_key TEXT NOT NULL UNIQUE,

  created_at INTEGER NOT NULL
);
```

Binary 本身：

```
不存 SQLite BLOB
```

保存到：

```
data/assets/
```

例如：

```
data/assets/<asset-id>
```

文件名不使用用户原始 filename。

---

## 6.2 asset_references

建立通用引用表：

```
CREATE TABLE asset_references (
  asset_id TEXT NOT NULL
    REFERENCES assets(id) ON DELETE RESTRICT,

  owner_type TEXT NOT NULL,

  owner_id TEXT NOT NULL,

  purpose TEXT NOT NULL,

  created_at INTEGER NOT NULL,

  PRIMARY KEY (
    asset_id,
    owner_type,
    owner_id,
    purpose
  )
);
```

Board V1 使用：

```
owner_type = board

purpose =
  scene
  thumbnail
```

不要把表命名成：

```
board_assets
```

因为这是 Docus Asset Layer。

未来：

```
Note
Diary
Board
...
```

都可以使用它。

---

# 7. Board Tables

## boards

```
CREATE TABLE boards (
  id TEXT PRIMARY KEY NOT NULL,

  title TEXT NOT NULL,

  created_at INTEGER NOT NULL,

  updated_at INTEGER NOT NULL
);
```

不保存：

```
engine
sceneVersion
revision
```

---

## board_scenes

```
CREATE TABLE board_scenes (
  board_id TEXT PRIMARY KEY NOT NULL
    REFERENCES boards(id) ON DELETE CASCADE,

  engine TEXT NOT NULL,

  scene_version INTEGER NOT NULL,

  revision INTEGER NOT NULL,

  engine_data_json TEXT NOT NULL,

  persistent_app_state_json TEXT NOT NULL
);
```

约束：

```
engine = excalidraw

sceneVersion = 1

revision initial = 0
```

第一笔成功 Scene Save：

```
0 → 1
```

---

# 8. 为什么 assetRefs 不再存 JSON Column

Domain 仍然暴露：

```
BoardScene.assetRefs
```

但 physical persistence 使用：

```
asset_references
```

作为关系型 Source of Truth。

Server 读取：

```
board_scenes
+
asset_references
      ↓
BoardScene
```

保存：

```
Scene JSON
+
assetRefs
      ↓
SQLite transaction
      ↓
update board_scenes
replace scene asset references
update boards.updated_at
```

这样可以直接回答：

```
一个 Asset 是否仍被引用？
```

而不需要扫描所有 Scene JSON。

---

# 9. Asset Storage Service

新增建议：

```
server/assets/
├── repository.ts
├── service.ts
├── storage.ts
├── routes.ts
└── types.ts
```

`storage.ts` 保存：

```
data/assets/
```

Binary 写入复用：

```
writeCreateOnlyDurableFile()
```

确保：

```
create only
fsync
sha256
no accidental overwrite
```

---

# 10. Asset API

挂载：

```
/api/assets
```

所有接口继续受现有：

```
authBoundary
```

保护。

---

## PUT /api/assets/:assetId

客户端提前生成 UUID。

请求：

```
PUT /api/assets/{assetId}

Content-Type: image/png
<body binary>
```

支持 V1 图片 MIME：

```
image/png
image/jpeg
image/webp
image/gif
image/avif
```

V1 不接受 SVG Asset。

SVG Export 不受影响。

创建成功：

```json
{
  "id": "...",
  "mimeType": "image/png",
  "byteSize": 123456,
  "sha256": "..."
}
```

---

## Idempotency

Crash Recovery 可能重复上传同一个 asset。

所以：

```
assetId already exists
+
sha256 same
→ return existing asset success
```

如果：

```
assetId same
+
hash different
→ 409 ASSET_ID_CONFLICT
```

---

## GET /api/assets/:assetId

读取：

```
Asset metadata
   ↓
safe storage path
   ↓
binary stream
```

设置：

```
Content-Type
X-Content-Type-Options: nosniff
```

---

# 11. Board Server Domain

新增：

```
server/board/
├── repository.ts
├── service.ts
├── validation.ts
├── errors.ts
└── routes/
    ├── index.ts
    └── shared.ts
```

不要塞进：

```
server/routes/posts.ts
```

或 Vault Domain。

在：

```
server/index.ts
```

挂载：

```ts
app.route('/api/board', boardRoutes)
app.route('/api/assets', assetRoutes)
```

---

# 12. Board API

## GET /api/board

返回：

```ts
BoardMetadata[]
```

Server：

```
ORDER BY updated_at DESC, id DESC
```

Board Home：

```
Recent = first N
All Boards = all
```

建议：

```
Recent = first 6
```

---

## POST /api/board

无 request body 或空 body。

Server transaction：

```
Generate Board ID

INSERT boards
  title = Untitled Board

INSERT board_scenes
  engine = excalidraw
  scene_version = 1
  revision = 0
  engine_data_json = null
  persistent_app_state_json = {}
```

Canonical Empty Scene：

```
engineData = null
persistentAppState = {}
assetRefs = []
```

注意：

```
POST /board
```

不能因为创建空白 Board 而加载 Excalidraw。

---

## GET /api/board/:id

返回：

```ts
{
  metadata: BoardMetadata
  sceneRecord: BoardSceneRecord
}
```

不返回 binary asset bytes。

---

## PATCH /api/board/:id

V1：

```json
{
  "title": "Ledger Architecture"
}
```

空标题统一 normalize：

```
Untitled Board
```

更新：

```
boards.title
boards.updated_at
```

---

# 13. Scene Save API

## PUT /api/board/:id/scene

Request：

```ts
interface SaveBoardSceneRequest {
  expectedRevision: number

  engine: 'excalidraw'
  sceneVersion: number

  scene: BoardScene
}
```

服务端执行：

```
1. Validate request envelope

2. Verify every assetRef exists

3. Verify referenced asset binary is readable

4. BEGIN SQLite transaction

5. SELECT current revision

6. currentRevision != expectedRevision
      → Conflict

7. UPDATE board_scenes
      revision = revision + 1

8. Replace asset_references
      purpose = scene

9. UPDATE boards.updated_at

10. COMMIT
```

Response：

```json
{
  "revision": 13,
  "updatedAt": 1789370000000
}
```

---

# 14. Optimistic Concurrency

使用：

```
expectedRevision
```

而不是只依赖客户端 Queue。

推荐数据库更新：

```sql
UPDATE board_scenes
SET
  ...
  revision = revision + 1
WHERE
  board_id = ?
  AND revision = ?;
```

检查：

```
changes === 1
```

否则：

```
409 BOARD_SCENE_CONFLICT
```

Response：

```json
{
  "code": "BOARD_SCENE_CONFLICT",
  "currentRevision": 13
}
```

Server 不自动 merge。

---

# 15. Thumbnail API

Thumbnail 作为 Docus Asset 保存。

流程：

```
Scene Save success
      ↓
mark thumbnail dirty
      ↓
3s debounce / idle
      ↓
Adapter generate PNG
      ↓
PUT /api/assets/:thumbnailAssetId
      ↓
PUT /api/board/:id/thumbnail
```

新增：

```
PUT /api/board/:id/thumbnail
```

Body：

```json
{
  "assetId": "..."
}
```

Server：

```
replace asset reference
purpose = thumbnail
```

非常重要：

```
更新 Thumbnail
不得更新 boards.updated_at
```

否则：

```
Scene Save
   ↓
3 秒后 Thumbnail Save
   ↓
updatedAt 再变化
   ↓
Board 排序无意义漂移
```

Thumbnail 失败：

```
Scene 仍是 Saved
```

---

# 16. Delete API

## DELETE /api/board/:id

V1 当前没有跨 Workspace 通用 Trash。

所以：

```
Permanent Delete
```

Server transaction：

```
collect board asset refs
delete asset_references
delete board
  ↓ cascade board_scene
commit
```

Commit 后：

```
for candidate assets
  if reference count == 0
    attempt safe cleanup
```

删除 Asset 失败：

```
留下 orphan Asset
```

不能：

```
回滚已经成功的 Board Delete
```

因为：

```
orphan > dangling reference
```

安全得多。

---

# 17. Frontend Feature Structure

新增：

```
src/features/board/
├── api.ts
├── domain.ts
├── boardErrors.ts
├── saveCoordinator.ts
├── checkpointStore.ts
├── checkpointReconciliation.ts
├── assetClient.ts
├── thumbnailScheduler.ts
│
└── engine/
    ├── BoardEngineAdapter.ts
    └── excalidraw/
        ├── adapter.ts
        ├── engineData.ts
        ├── reactIsland.ts
        └── ReactErrorBoundary.ts
```

Vue components：

```
src/components/board/
├── BoardCard.vue
├── BoardGallery.vue
├── BoardEditorHeader.vue
└── ExcalidrawHost.vue
```

Views：

```
src/views/
├── BoardHomeView.vue
└── BoardEditorView.vue
```

---

# 18. BoardEngineAdapter

Domain interface：

```ts
interface BoardEngineAdapter {
  deserialize(
    scene: BoardScene,
    assets: ResolvedAsset[],
  ): EngineInitialData

  serialize(
    runtimeScene: unknown,
  ): BoardSceneSerializationResult

  generateThumbnail(...): Promise<Blob>

  exportPng(...): Promise<Blob>

  exportSvg(...): Promise<string>
}
```

Domain 层不能 import：

```
ExcalidrawElement
AppState
BinaryFiles
```

这些只能存在于：

```
engine/excalidraw/*
```

内部。

---

# 19. Excalidraw Adapter V1

内部格式：

```ts
interface ExcalidrawEngineDataV1 {
  elements: unknown[]

  fileMap: Record<string, string>
}
```

其中：

```
key   = Excalidraw fileId
value = Docus assetId
```

Adapter 负责：

```
Excalidraw elements
Excalidraw AppState
Excalidraw BinaryFiles
        ↕
BoardScene
```

---

# 20. Persistent AppState

只持久化：

```
zoom
scrollX
scrollY
gridSize
viewBackgroundColor
```

不持久化：

```
selectedElementIds
editingElement
draggingElement
contextMenu
openDialog
theme
```

Theme：

```
Docus Theme
      ↓
Excalidraw prop
```

Canvas Background：

```
Board Scene
```

---

# 21. React Island

`ExcalidrawHost.vue` 不直接 import React。

Mount 时：

```ts
const island = await import(
  '../features/board/engine/excalidraw/reactIsland'
)
```

所以：

```
Board Home
```

不会下载：

```
React
React DOM
Excalidraw
```

React Island：

```
React Root
   ↓
BoardReactErrorBoundary
   ↓
Excalidraw
```

Vue → React：

```
initialData
theme
callbacks
```

React → Vue：

```
onSceneChange
onAssetsChanged
onFatalError
```

---

# 22. Router

新增：

```
/board
/board/:boardId
```

建议：

```ts
{
  path: '/board',
  name: 'board',
  component: () => import('../views/BoardHomeView.vue'),
  meta: {
    fullWidth: true,
    workspace: true,
    sidebar: false,
  },
}

{
  path: '/board/:boardId',
  name: 'board-editor',
  component: () => import('../views/BoardEditorView.vue'),
  meta: {
    fullWidth: true,
    workspace: true,
    sidebar: false,
    immersive: true,
  },
}
```

给 RouteMeta 增加：

```ts
immersive?: boolean
```

---

# 23. App Shell

Board Home：

```
使用 compact Docus workspace navbar
```

Board Editor：

```
隐藏 global NavBar
```

因为 Editor 自己拥有：

```
Back
Title
Save status
Menu
```

App.vue：

```
Vault
Ledger
Board Home
→ workspace chrome

Board Editor
→ immersive chrome
```

Editor 页面：

```
--navbar-h = 0
```

最大化 Canvas。

---

# 24. NavBar

不要修改：

```
shared/scopeProtocol.ts
```

不要添加：

```
ScopeKey = board
```

因为：

```
ScopeKey
=
Vault content roots
```

而：

```
Board
=
Independent Workspace
```

当前：

```
Note
Diary
Ledger
```

的 Navbar 区域增加一个视觉一致的：

```
Board
```

route button。

逻辑上分成：

```
Note / Diary
→ Vault Scope

Ledger / Board
→ Workspace Route
```

Board 激活时：

```
只高亮 Board
```

不要因为 `activeScope = note` 而同时高亮 Note。

---

# 25. Board Home

`BoardHomeView.vue`：

```
Header
Search
Recent
All Boards
```

数据：

```
GET /api/board
```

搜索：

```
client-side title filtering
```

不需要为 V1 建全文索引。

创建：

```
POST /api/board
   ↓
router.push('/board/{id}')
```

卡片 Context Menu：

```
Rename
Delete
```

---

# 26. Editor Loading State Machine

BoardEditorView：

```
idle
 ↓
loading
 ↓
hydrating
 ↓
ready
```

错误：

```
error
conflict
```

完整 Load：

```
GET Board
    ↓
Read engine
sceneVersion
revision
    ↓
migrateBoardScene()
    ↓
Validate BoardScene
    ↓
Load referenced Assets
    ↓
Load local Checkpoint
    ↓
Reconcile Checkpoint
    ↓
Adapter.deserialize()
    ↓
Mount ExcalidrawHost
    ↓
ready
    ↓
Enable Autosave
```

禁止：

```
先 mount empty Excalidraw
然后再 load Scene
```

---

# 27. Crash Checkpoint 存储选择

不要使用：

```
localStorage
```

Scene 可能很大，而且图片恢复还需要 Blob。

Board 使用：

```
IndexedDB
```

不增加第三方 dependency。

DB：

```
docus-board-recovery
```

Object Stores：

```
checkpoints
pending-assets
```

---

# 28. Checkpoint

逻辑对象：

```ts
interface BoardCheckpoint {
  boardId: string

  sceneVersion: number

  baseRevision: number

  localRevision: number

  scene: BoardScene

  savedAt: number
}
```

key：

```
boardId
```

---

# 29. Pending Asset Recovery

图片刚加入 Canvas 时，可能发生：

```
Image added
   ↓
Browser crashes
   ↓
Asset upload 还没完成
```

只保存 `BoardScene` 不够。

因此 IndexedDB 同时保存：

```ts
interface PendingBoardAsset {
  assetId: string
  boardId: string

  engineFileId: string

  mimeType: string

  blob: Blob

  createdAt: number
}
```

流程：

```
Excalidraw new BinaryFile
      ↓
Generate Docus assetId
      ↓
Update engine fileMap
      ↓
Persist Pending Asset to IndexedDB
      ↓
Write Checkpoint
      ↓
Async Asset Upload
```

Asset Server upload 成功：

```
Pending Asset 可以删除
```

因为 binary 已经成为 Server Asset。

---

# 30. Recovery Asset Resolution

打开 Board：

```
for each assetRef
    ↓
try Server Asset
```

如果 Server Asset 不存在，但：

```
IndexedDB pending asset exists
```

则：

```
re-upload
```

之后继续 Recovery。

如果：

```
Server missing
AND
Local pending missing
```

则：

```
Fail Closed
```

不能删除 Image Element 后继续打开。

---

# 31. Save Coordinator

不要把 Save 逻辑塞进：

```
BoardEditorView.vue
```

建立：

```
saveCoordinator.ts
```

内部状态：

```text
currentServerRevision
localRevision

latestScene
dirty

saveInFlight
conflict
lastSavedLocalRevision
```

---

# 32. Save Coalescing

不需要保存每一个 localRevision。

例如：

```
Revision 21
Revision 22
Revision 23
Revision 24
```

发生在一个 Save 请求期间。

完成当前 Save 后：

```
直接保存最新 24
```

不需要：

```
22
23
24
```

逐个写库。

即：

```
queue ordering
+
latest snapshot coalescing
```

---

# 33. Save Algorithm

每次变化：

```
onChange
   ↓
Adapter.serialize()
   ↓
latestScene = snapshot
   ↓
localRevision++
   ↓
write checkpoint
   ↓
schedule debounce
```

Debounce：

```
800ms
```

建议 V1 固定为：

```
800ms
```

而不是继续保留范围。

---

## Save execution

```
capture:
  scene
  localRevision
  currentServerRevision

      ↓

ensure pending assets persisted

      ↓

PUT scene
expectedRevision = currentServerRevision

      ↓

success

      ↓

currentServerRevision = response.revision
```

---

# 34. Checkpoint Advance

假设：

```
save localRevision = 10
```

保存过程中用户继续编辑：

```
localRevision = 11
```

Server 10 成功后：

```
不能删除整个 Checkpoint
```

应该：

```
baseRevision = returned server revision

keep localRevision = 11
keep latest local Scene
rewrite checkpoint
```

只有：

```
lastSavedLocalRevision
==
current localRevision
```

才清理 Checkpoint。

---

# 35. Conflict State

收到：

```
409 BOARD_SCENE_CONFLICT
```

之后：

```
STOP automatic scene saves
```

不能自动不停重试。

状态：

```
conflict
```

保存：

```
local Scene
Checkpoint
```

V1 不自动 merge。

Recovery UI 至少：

```
Server changed elsewhere.

Reload server version
Keep local recovery copy
```

如果选择 reload：

```
明确确认后
清理 local checkpoint
重新 load Server Scene
```

绝对不能 silent overwrite。

---

# 36. Route Leave

Vue Router：

```ts
onBeforeRouteLeave
```

执行：

```ts
await saveCoordinator.flush()
```

结果：

### success

```
leave
```

### failure / conflict

显示确认：

```
Changes could not be saved to the server.
A local recovery copy is available.

Stay
Leave Anyway
```

如果：

```
Leave Anyway
```

Checkpoint 必须保留。

---

# 37. beforeunload

不把网络 Save 寄托于：

```
beforeunload
```

只做：

```
Best Effort
```

核心安全依赖：

```
频繁 IndexedDB Checkpoint
```

---

# 38. Image Asset Pipeline

用户插入图片：

```
Excalidraw file
    ↓
Adapter detects new engineFileId
    ↓
Generate Docus assetId
    ↓
fileMap[engineFileId] = assetId
    ↓
IndexedDB pending asset
    ↓
Asset upload
    ↓
Server asset committed
    ↓
Scene may save assetRef
```

Scene Save 前：

```ts
await ensureAssetsReady(assetRefs)
```

任一失败：

```
Scene 不发送
Save failed
Checkpoint 保留
```

---

# 39. Theme

BoardEditor：

```ts
useTheme()
```

把：

```
light / dark
```

作为 React Island prop。

Theme 改变：

```
rerender React Root props
```

不能修改：

```
BoardScene.theme
```

Canvas background：

```
viewBackgroundColor
```

---

# 40. Shortcut Boundary

React Island active：

```
Ctrl/Cmd+Z
Ctrl/Cmd+C
Ctrl/Cmd+V
Ctrl/Cmd+A
Delete
Backspace
Space
```

由 Excalidraw 优先处理。

Docus global shortcut：

```
如果 event target 在
input
textarea
contenteditable
Excalidraw root
```

不能抢事件。

重点增加自动测试：

```
Excalidraw text editing
不会触发 Docus shortcut
```

---

# 41. Export

Editor Menu：

```
Export PNG
Export SVG
Delete
```

Export：

```
BoardEngineAdapter
```

完成。

不经过 Server。

文件名：

```
{sanitized-board-title}.png
{sanitized-board-title}.svg
```

---

# 42. Thumbnail Scheduler

新增：

```
thumbnailScheduler.ts
```

触发：

```
Scene server save success
```

而不是：

```
onChange
```

采用：

```
3000ms debounce
```

如果浏览器支持：

```
requestIdleCallback
```

可以在 debounce 后进一步 idle 执行。

没有则直接执行。

---

# 43. Implementation Slices

整个 V1 不建议一次性编码完成。

按以下 Slice 实现。

---

## B0 — Compatibility Spike

目标：

```
证明 Vue + React Island + Excalidraw 可构建
```

改动：

```
package.json
package-lock.json

最小 React Island spike
```

验证：

```
npm run typecheck
npm run build
```

必须证明：

```
Board Home chunk 不包含 Excalidraw
Board Editor 才加载 React / Excalidraw
```

完成后删除临时 Spike UI，只留下确认后的正式集成基础。

建议 commit：

```
chore(board): validate excalidraw react island
```

---

## B1 — Storage Foundation

实现：

```
0030_asset_foundation.sql
0031_board_foundation.sql

shared/assetProtocol.ts
shared/boardProtocol.ts

server/assets/*
server/board/repository.ts
server/board/service.ts
```

完成：

```
Asset persistence
Board CRUD storage
Scene revision CAS
```

测试：

```
migration
repository
asset durable write
revision conflict
```

建议 commit：

```
feat(board): add storage foundation
```

---

## B2 — Board HTTP API

实现：

```
server/board/routes/*
server/assets/routes.ts
server/index.ts
```

完成：

```
GET boards
POST board
GET board
PATCH title
PUT scene
PUT thumbnail
DELETE board
PUT asset
GET asset
```

测试：

```
auth protected
404
validation
409 revision conflict
missing asset
idempotent asset upload
```

建议 commit：

```
feat(board): add board and asset APIs
```

---

## B3 — Gallery Home + Navigation

实现：

```
BoardHomeView.vue
BoardCard.vue
BoardGallery.vue
src/features/board/api.ts

router
App.vue
NavBar.vue
i18n
```

完成：

```
Board nav
Recent
All Boards
Search
Create
Rename
Delete
```

不得：

```
修改 FileTree.vue
把 Board 加到 ScopeKey
```

建议 commit：

```
feat(board): add gallery workspace
```

---

## B4 — Canvas Engine / React Island

实现：

```
BoardEngineAdapter
Excalidraw adapter
React Island
Error Boundary
ExcalidrawHost
BoardEditorView
BoardEditorHeader
```

此 Slice 只要求：

```
Load empty Board
Draw
Serialize
Basic theme
```

暂时可以手动触发 Save。

目的：

```
先证明 Engine Boundary
```

再做复杂 Autosave。

建议 commit：

```
feat(board): integrate excalidraw editor
```

---

## B5 — Autosave + Revision

实现：

```
saveCoordinator.ts
debounce
coalescing queue
expectedRevision
save status
flush
route leave
conflict state
```

重点测试：

```
changes during save
old response
conflict
flush latest revision
save failure
```

建议 commit：

```
feat(board): add revision-safe autosave
```

---

## B6 — Crash Recovery

实现：

```
IndexedDB checkpoint
checkpoint reconciliation
pending asset store
recovery UI
fail closed
```

测试：

```
newer checkpoint
older checkpoint
server ahead
damaged checkpoint
refresh during unsaved work
```

建议 commit：

```
feat(board): add crash recovery
```

---

## B7 — Image Assets

实现：

```
Excalidraw BinaryFiles
fileMap
asset upload
asset reload
pending asset recovery
asset reference transaction
```

测试：

```
insert image
save
refresh
image survives

asset upload failure
scene not committed

missing referenced asset
fail closed
```

建议 commit：

```
feat(board): persist canvas assets
```

---

## B8 — Thumbnail / Export / Polish

实现：

```
Thumbnail Scheduler
PNG Export
SVG Export
Dark Mode polish
keyboard ownership
loading/error surfaces
```

建议 commit：

```
feat(board): complete v1 editor experience
```

---

## B9 — E2E Closure

增加真实浏览器测试：

```
Create Board
Draw
Wait Saved
Reload
Scene restored

Rename
Return Gallery
Title updated

Insert image
Reload
Image restored

Dark mode
Export
Delete
```

同时运行：

```
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

如果项目完整 E2E 太重，至少新增：

```
Board-specific Playwright suite
```

建议 commit：

```
test(board): close v1 lifecycle
```

---

# 44. Unit Test Matrix

至少覆盖：

## Domain

```
BoardScene validation
sceneVersion migration
persistentAppState normalization
fileMap ↔ assetRefs consistency
```

## Save Coordinator

```
single save
debounced save
save coalescing
edit while saving
save failure
revision conflict
flush
```

## Checkpoint

```
create
advance
clear
server ahead
corrupt checkpoint
pending asset
```

## Server

```
create
list ordering
rename
delete
revision increment
expectedRevision conflict
missing asset rejection
asset ref replacement
thumbnail does not update updatedAt
```

## Asset

```
durable create
same ID same hash retry
same ID different hash conflict
missing physical file
unreferenced cleanup
```

---

# 45. Integration Tests

特别增加：

```
两个客户端读取 revision 3

Client A save
→ revision 4

Client B expectedRevision 3
→ 409
```

必须证明：

```
B 无法覆盖 A
```

---

# 46. Data Safety Tests

这是 Board V1 最重要的一组测试。

必须模拟：

```
Load Scene parse failure
Migration failure
Asset missing
Checkpoint corrupt
Asset upload failure
Scene save failure
Thumbnail failure
Route leave during debounce
Browser reload before autosave
```

每个测试都验证：

```
旧 Server Scene 没有被 Empty Scene 覆盖
```

---

# 47. Performance Gate

V1 不需要 Benchmark Framework。

但必须手动/自动确认：

```
拖动 Shape
→ 不产生连续 HTTP Save

onChange
→ 不更新 App global reactive state

Board Home
→ 不加载 Excalidraw chunk

Thumbnail
→ 不在 Pointer Move 过程中生成
```

---

# 48. Files Explicitly Not To Reuse

不要复用或改造成 Board：

```
src/components/vault/FileTree.vue
src/composables/vault/useScopeFilter.ts
Vault document lifecycle
Note draft domain
Diary namespace
Ledger Store
```

可以复用：

```
authFetch
useTheme
useToast
useConfirm
usePrompt
router auth guards
SQLite migration runner
durable file utilities
Naive UI foundation
App Shell
```

---

# 49. Implementation Decisions Already Closed

Implementation 时不要重新讨论：

```
Board 是否独立 Workspace
→ Yes

Excalidraw 是否采用
→ Yes

Board Home 是否 FileTree
→ No

V1 是否 Folder
→ No

是否 React Island
→ Yes

是否自动保存
→ Yes

是否 Scene Revision
→ Yes

是否 Crash Checkpoint
→ Yes

是否 Docus Asset 为 binary Source of Truth
→ Yes
```

---

# 50. Implementation Plan 仍允许自行决定的事项

下面属于 implementation detail，可以在编码阶段根据实际 API 调整：

```
Excalidraw 当前版本的具体 API 名称

Persistent AppState 精确字段转换

Thumbnail export 参数

Board Card 精确尺寸

Recent 响应式显示数量

具体 Error UI 文案

Asset / Scene JSON 最终 size limit

requestIdleCallback fallback 细节
```

但不得改变已经冻结的领域边界。

---

# 51. Definition of Done

Board V1 只有满足以下条件才能关闭：

```
[ ] /board 是独立 Gallery Home

[ ] 不依赖 FileTree

[ ] /board/:id 使用隔离 React Island

[ ] Board Home 不加载 React / Excalidraw

[ ] 创建 Board 无 Modal

[ ] Draw 正常

[ ] Text / Shape / Arrow / Free Draw 正常

[ ] Image 可以插入并持久化

[ ] Autosave 有真实 Saved 状态

[ ] 高频 drag 不持续请求 Server

[ ] Server revision 单调递增

[ ] stale expectedRevision 返回 Conflict

[ ] Crash Checkpoint 可以恢复

[ ] Missing Asset Fail Closed

[ ] Empty Scene 无法覆盖损坏/加载失败的数据

[ ] Refresh 恢复 Scene

[ ] Viewport 恢复

[ ] Theme 跟随 Docus

[ ] Canvas Background 独立保存

[ ] Thumbnail 正常生成

[ ] Thumbnail failure 不影响 Scene Saved

[ ] PNG Export

[ ] SVG Export

[ ] Rename

[ ] Delete + Confirm

[ ] Search Title

[ ] CI typecheck / unit / integration / build 通过

[ ] Board lifecycle E2E 通过
```

---

# 52. 实施顺序

严格按照：

```
B0 Compatibility
        ↓
B1 Storage
        ↓
B2 HTTP API
        ↓
B3 Gallery
        ↓
B4 Canvas
        ↓
B5 Autosave
        ↓
B6 Recovery
        ↓
B7 Assets
        ↓
B8 Polish
        ↓
B9 Closure
```

不要：

```
一口气实现整个 Board V1
```

每一个 Slice：

```
实现
→ Test
→ Build
→ Review
→ Commit
→ 再进入下一 Slice
```

这样如果 Excalidraw、Asset 或 Recovery 某一层出现问题，不会把整个 Board 功能一起拖进不可审查的大提交。
