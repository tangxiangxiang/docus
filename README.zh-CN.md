# docus

一个基于 Vue 3 + TypeScript 的个人知识库，围绕一套小型 Zettelkasten
协议构建。资料库本体是 `src/content/` 下的纯 `.md` 文件，由一个
进程内的 Hono 后台服务支撑。编辑器使用 CodeMirror；文件树与右侧
面板（编辑器 + 实时预览）采用类 VS Code 的布局。最右侧还有一面
AI 对话面板 —— 它的对话历史持久化在 Hono 启动时打开的一小块
SQLite 数据库里。

## 快速开始

```bash
npm install
npm run dev          # vite + Hono 中间件, http://localhost:5173
npm test             # vitest, 24 个文件 / 192 个测试
npm run build        # vue-tsc -b && vite build
```

Hono 后台（`server/`）在 dev 模式下作为 Vite 中间件挂载，无需单独
启动进程。首次启动时服务会创建 `data/docus.db`（已 gitignore），
并按序应用 `server/migrations/` 下的 SQL 迁移。所有端点都在
`/api/...` 命名空间下，路由表内联在
[server/index.ts](server/index.ts) 中。

## 目录结构

```
src/
  views/                 一个组件对应一个路由（Vault / Tags / Article / TagDetail）
  components/
    vault/               FileTree, TreeRow, EditorPane, PreviewPane, EditorTabs,
                         Breadcrumb, CommandPalette, StatusBar, TagPanel,
                         ActivityBar, AiPanel, AiSessionPicker
  composables/           useToast / useConfirm / usePrompt / useTheme
                         （UI 单例）
    zettelProtocol.ts    纯函数：哪些路径是只读 / 受保护，及其对应的
                         用户提示文案
    vault/               useVaultLayout, useEditorTabs, useTagFilter,
                         useAiHistory —— 从 VaultView.vue 和 AiPanel.vue
                         拆分出来的状态与副作用
  lib/
    api.ts               /api/posts、/api/tree 等的带类型的 fetch 封装
    ai-api.ts            /api/ai/* 的带类型的 fetch 封装
    search.ts            客户端构建的 MiniSearch 全文索引
    markdown.ts, frontmatter.ts
  content/               资料库本体 —— 三个顶层目录
                         (inbox / literature / zettel) 以及用户写下的所有内容
  router/                vue-router 配置（vault 使用 splat 参数）

server/
  index.ts               顶层 Hono app，挂载各子路由
  db.ts                  better-sqlite3 单例 + applyMigrations 迁移执行器
  migrations/            按编号命名的 .sql 文件，启动时按事务顺序应用，
                         目标库为 data/docus.db
  ai/                    AI 子应用：sessions / messages / routes
  tree.ts                文件系统遍历 -> PostSummary[] / TreeNode[]
  paths.ts               路径校验 + 文件系统 <-> URL 映射
  vite-plugin.ts         将 Hono app 挂载为 Vite 中间件
  __tests__/             vitest（node 模式），测试直接调用 app.fetch(req)；
                         AI 套件用 :memory: 数据库

docs/superpowers/
  specs/                 设计文档（按特性划分）
  plans/                 实施计划（按特性划分）
```

## Zettelkasten 协议

三个顶层目录是协议的一部分，不是用户可编辑的选择：

- **`inbox/`** —— 收件桶，新内容先落在这里
- **`literature/`** —— 长篇参考资料
- **`zettel/`** —— 永久笔记，整个子树只读

对这三个根目录的重命名、删除、重新挂载都会被客户端和服务端拒绝。
规则集中在 [src/composables/zettelProtocol.ts](src/composables/zettelProtocol.ts)
这个纯函数模块里。同一套规则同时约束两件事：右键菜单 UI（只读行
隐藏写操作按钮）和文件系统写入（被阻止的操作会弹中文 toast 并
提前 return）。

要新增第四个受保护的根目录，或修改提示文案，只需改这一个文件。

## 资料库

资料库位于 `/vault`，支持路径 splat：`/vault/<path>`。可通过文件
树、`⌘P` / `Ctrl+P` 命令面板，或直接深链到某个路径打开。

编辑器标签页为每个文件保留未保存状态。编辑停止 800ms 后自动保存；
debounce 逻辑位于 `useEditorTabs`。`⌘S` 立即保存，`⌘W` 关闭当前
标签页（有未保存修改时会确认），`⌘B` 切换 Files 面板，NavBar
上的 AI 按钮切换 AI 面板。

布局状态 —— 当前打开的侧栏、侧栏宽度、编辑器/预览分割比例、
AI 面板的开关和宽度 —— 持久化到 `localStorage` 的
`docus.vault.layout` 键。序列化器是自定义的，因为早期 schema 是
`{ fileTreeOpen, fileTreeWidth }`，老用户可能仍是这个形态；读取
时会前向翻译到新 schema。AI 相关的键（`aiOpen`、`aiPanelWidth`）
沿用同一套模式。

## AI 面板

资料库最右边的栏位是 AI 对话面板，样式参考 VS Code 中的 Claude
Code。从 NavBar 上 Search 按钮和视图切换按钮之间的 AI 按钮打开；
面板右边缘的 splitter 调整宽度，范围与左侧栏一致（220–600px）。

面板支持**多会话**。每个会话都有自动派生的标题（取首条用户消息
的前 30 个码点），可以通过点标题弹出的 popover 重命名、切换、
删除。活跃会话 id 由服务端持久化，刷新后自动恢复。消息采用乐观
更新：按下 Enter 立即插入用户消息，服务端响应回来后用真实记录
替换原占位。

composer 目前是 `console.debug` 级别的 —— 发消息只会把内容写进
数据库，不会调用任何 LLM。接入模型是独立的后续工作，spec 中已
明确列为 out of scope。

状态层是 [src/composables/vault/useAiHistory.ts](src/composables/vault/useAiHistory.ts)
（模块级 singleton）。HTTP 线缆格式定义在
[src/lib/ai-api.ts](src/lib/ai-api.ts)。两者是 `/api/ai/*` 子路由
唯一的消费方。

## 后台

后台是一个小型 Hono app。大部分端点是无状态的，读取或写入
`src/content/` 下的文件；AI 子路由读写 SQLite 数据库。

### 持久化

服务启动时通过 `better-sqlite3` 打开 `data/docus.db`
（[server/db.ts](server/db.ts)）。首次运行会应用
`server/migrations/0001_ai_history.sql`，建立 `sessions`、
`messages` 和一个单行 `settings` 表（目前用于存活跃会话 id）。
迁移通过 `schema_version` 表追踪，每个文件由执行器按事务应用；
新增迁移只需把编号更大的 .sql 文件放进 `server/migrations/`。
默认开启 WAL 模式，并启用外键约束。

### HTTP 端点

**资料库 / 文件系统**

| Method | Path                       | 说明                                       |
| ------ | -------------------------- | ------------------------------------------ |
| GET    | `/api/tree`                | `TreeNode[]`（目录 + 文件，已排序）        |
| GET    | `/api/posts`               | `PostSummary[]`（扁平的 post 元数据）      |
| GET    | `/api/posts/<path>`        | 原始 markdown + 解析后的 frontmatter       |
| POST   | `/api/posts`               | 新建 post                                  |
| PUT    | `/api/posts/<path>`        | 保存原始内容                               |
| PATCH  | `/api/posts/<path>`        | 目录内重命名（`name`）或移动（`targetPath`）|
| DELETE | `/api/posts/<path>`        | 删除文件                                   |
| POST   | `/api/folders`             | 新建空目录                                 |
| PATCH  | `/api/folders/<path>`      | 单段目录重命名                             |
| DELETE | `/api/folders/<path>`      | 递归删除目录（需 `?recursive=true`）       |
| GET    | `/api/health`              | `{ ok: true }`                             |

**AI / SQLite**

| Method | Path                                | 说明                                       |
| ------ | ----------------------------------- | ------------------------------------------ |
| GET    | `/api/ai/sessions`                  | `Session[]`（按更新时间倒序）              |
| GET    | `/api/ai/sessions/<id>/messages`    | `Message[]`（按时间正序）                  |
| POST   | `/api/ai/sessions`                  | 新建会话（`{ title? }`）                   |
| PATCH  | `/api/ai/sessions/<id>`             | 重命名（`{ title }`）                      |
| DELETE | `/api/ai/sessions/<id>`             | 删除（级联删除消息；若被删的是活跃会话则清空活跃 id）|
| POST   | `/api/ai/sessions/<id>/messages`    | 追加消息（校验 role）                      |
| GET    | `/api/ai/active`                    | 活跃会话 id（或 `null`）                   |
| PUT    | `/api/ai/active`                    | 设置活跃会话 id（或 `null`）               |

文件系统路由的路径校验在
[server/paths.ts](server/paths.ts)。AI 子路由不涉及文件系统；
请求体由 handler 校验 JSON 形状，SQL 行的 snake_case 列由 mapper
翻译为 `src/lib/ai-api.ts` 中声明的 camelCase 线缆格式。

## 测试

```bash
npm test
```

192 个测试，分布在 24 个文件中：

- **7 个组件测试**（`src/components/vault/__tests__/`）—— 覆盖文件
  树、右键菜单、拖放、内联重命名、防止"同名文件/目录"重命名串扰
  的 kind 感知查找，以及 TagPanel。`useConfirm` / `usePrompt` /
  `useToast` 三个 composable 用 `vi.mock` 替换；树结构 fixture 是
  内联的字面量。
- **5 个 composable 测试**（`src/composables/vault/__tests__/`）——
  覆盖编辑器标签页状态机、tag filter、vault layout 持久化、markdown
  渲染，以及 `useAiHistory` singleton。AI singleton 暴露了
  `__resetForTesting` 导出，用来在测试间隔离状态。
- **3 个 lib 测试**（`src/lib/__tests__/`）—— 覆盖全文搜索索引、
  AI 线缆格式，以及 AI 的带类型 fetch 封装（`fetch` 用 `vi.mock`
  替换）。
- **1 个视图测试**（`src/views/__tests__/`）—— 覆盖 Tags 视图。
- **8 个后台测试**（`server/__tests__/`）—— 围绕临时 `content/`
  目录测试路径校验、PUT handler、tree builder、SQLite 迁移执行器、
  AI sessions/messages service、AI HTTP 子路由（用 `vi.mock` 替换
  DB 模块），以及一个挂载完整 Hono app 的 smoke 测试。AI 套件通过
  `vi.hoisted` 注入 `:memory:` 数据库，每个测试拿到一份干净的 DB。

VaultView 本身没有专门测试，相关行为变更依赖 dev server 手动验证
（打开 / 编辑 / 保存 / 拖动）。

## 约定

- `src/composables/` 下的 composable 遵循三种模式：跨组件状态用
  singleton-factory（toast、confirm queue、prompt queue、theme、
  AI history），无状态规则用 pure-function-module
  （`zettelProtocol.ts`）。
- 资料库相关的 composable（`useVaultLayout` / `useEditorTabs` /
  `useTagFilter`）是 per-component factory。跨 composable 的依赖
  通过构造器参数显式传入 —— `useTagFilter({ activePanel })`、
  `useEditorTabs({ selectPanel })` —— 这种耦合是带类型的、意图
  自明的。
- `server/ai/` 下的 AI service 层是纯函数模块：每个函数把打开的
  `Database` 作为第一个参数，返回普通 JS 值。Hono handler 是
  唯一的调用方，service 层对 HTTP 一无所知 —— 这样业务逻辑可以在
  不启 server 的情况下测试。
- 后台类型（`PostSummary` / `TreeNode` / `PostDetail`）定义在
  [src/lib/api.ts](src/lib/api.ts)，AI 线缆类型（`Session` /
  `Message`）定义在 [src/lib/ai-api.ts](src/lib/ai-api.ts)，
  客户端和服务端都从这里 import。服务端目前故意不在 `tsc` include
  图中（没有 `tsconfig.server.json`），但 import 方向是
  `server/ -> src/lib/*`，让每种 JSON 线缆格式只有一个真相来源。
- **迁移** 是只进不退的 SQL 文件。每个文件自身必须幂等（用
  `CREATE TABLE IF NOT EXISTS`、`CREATE INDEX IF NOT EXISTS` 等），
  并由执行器包在事务里。要回滚，写一个向前的 fix —— 不要修改
  已提交的迁移。

## 项目历史

每个特性的详细设计和实施计划位于
[docs/superpowers/](docs/superpowers/)：

- [specs/](docs/superpowers/specs/) —— 编码前的设计意图
  - [`2026-06-06-ai-panel-design.md`](docs/superpowers/specs/2026-06-06-ai-panel-design.md) —— 右栏 AI 面板骨架
  - [`2026-06-07-sqlite-ai-history.md`](docs/superpowers/specs/2026-06-07-sqlite-ai-history.md) —— SQLite 持久化的多会话聊天历史
- [plans/](docs/superpowers/plans/) —— 逐步实施计划，通常连 commit
  顺序都已选好
  - [`2026-06-07-sqlite-ai-history.md`](docs/superpowers/plans/2026-06-07-sqlite-ai-history.md)
