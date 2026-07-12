# docus

一个基于 Vue 3 + TypeScript 的个人知识库。资料库本体是 `src/content/` 下的纯 `.md` 文件，由一个
进程内的 Hono 后台服务支撑。编辑器使用 Monaco；文件树与右侧
面板（编辑器 + 实时预览）采用类 VS Code 的布局。最右侧还有一面
AI 对话面板 —— 它的对话历史持久化在 Hono 启动时打开的一小块
SQLite 数据库里。

> **资料库是你的数据，不是项目代码。** `src/content/` 下的文件
> **不**被 docus 的 git 仓库跟踪 —— 它们属于你的笔记，不属于这个
> 工具。资料库有自己的 git 历史（`src/content/.git/`，由
> `server/history/` 维护）。docus 仓库只跟踪工具本身：源码、配置、
> 文档。

## 快速开始

```bash
npm install
npm run dev          # vite + Hono 中间件, http://localhost:5173
npm test             # vitest, 27 个文件 / 223 个测试
npm run build        # vue-tsc -b && vite build
```

Hono 后台（`server/`）在 dev 模式下作为 Vite 中间件挂载，无需单独
启动进程。首次启动时服务会创建 `data/docus.db`（已 gitignore），
并按序应用 `server/migrations/` 下的 SQL 迁移。所有端点都在
`/api/...` 命名空间下，路由表内联在
[server/index.ts](server/index.ts) 中。

AI 面板调用 Anthropic 的 Messages API。浏览器永远拿不到 key —— 启动
`npm run dev` 之前在服务端环境里设好 `ANTHROPIC_API_KEY`。
`ANTHROPIC_MODEL` 覆盖默认模型（`claude-sonnet-4-6`）。key 未设时
面板顶部显示一条常驻 banner，发送按钮被禁用。

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
    archiveProtocol.ts   纯函数：哪些路径受保护，及其对应的
                         用户提示文案
    vault/               useVaultLayout, useEditorTabs, useTagFilter,
                         useAiHistory, useCurrentNote —— 从 VaultView.vue
                         和 AiPanel.vue 拆分出来的状态与副作用
  lib/
    api.ts               /api/posts、/api/tree 等的带类型的 fetch 封装
    ai-api.ts            /api/ai/* 的带类型的 fetch 封装，包含
                         streamChat 的 SSE 解析器
    search.ts            客户端构建的 MiniSearch 全文索引
    markdown.ts, frontmatter.ts
  content/               资料库本体 —— 三个顶层目录
                         (inbox / literature / archive) 以及用户写下的所有内容。
                         不被 docus 的 git 仓库跟踪；资料库自己的历史在
                         src/content/.git/
  router/                vue-router 配置（vault 使用 splat 参数）

server/
  index.ts               顶层 Hono app，挂载各子路由
  db.ts                  better-sqlite3 单例 + applyMigrations 迁移执行器
  migrations/            按编号命名的 .sql 文件，启动时按事务顺序应用，
                         目标库为 data/docus.db
  ai/                    AI 子应用
    errors.ts            ChatError tagged union（no-api-key / not-found /
                         empty / aborted / llm-error）
    llm.ts               streamClaude()：@anthropic-ai/sdk 的薄封装，
                         整个仓库里唯一 import SDK 的文件
    chat.ts              runChat() 协调器 + buildSystemPrompt()；
                         纯业务逻辑，不感知 HTTP
    messages.ts          追加 / 列出消息；校验 role ∈ {user, assistant}
    sessions.ts          Sessions 的 CRUD
    routes.ts            Hono 子路由；唯一感知 HTTP 的层
  tree.ts                文件系统遍历 -> PostSummary[] / TreeNode[]
  paths.ts               路径校验 + 文件系统 <-> URL 映射
  linkIndex.ts           笔记间双向链接的反向索引，文件变动时更新
  linkResolve.ts         解析 markdown 里的 [[wiki]] 与 [t](path.md) 链接
  seed.ts                首次启动时向空 vault 写入几条示例笔记
  vite-plugin.ts         将 Hono app 挂载为 Vite 中间件
  prod.ts                生产入口：tsx 跑这个，把 dist/ 和 /api/* 同时挂上
  __tests__/             vitest（node 模式），测试直接调用 app.fetch(req)；
                         AI 套件用 :memory: 数据库

docs/superpowers/
  specs/                 设计文档（按特性划分）
  plans/                 实施计划（按特性划分）
```

## Archive 协议

三个顶层目录是协议的一部分，不是用户可编辑的选择：

- **`inbox/`** —— 收件桶，新内容先落在这里
- **`literature/`** —— 长篇参考资料
- **`archive/`** —— 归档笔记，目录结构受保护；可新建文件夹并在内部移动整理，不能直接新建归档笔记，需通过明确的归档流程进入

对这三个根目录的重命名、删除、重新挂载都会被客户端和服务端拒绝。
规则集中在 [src/composables/archiveProtocol.ts](src/composables/archiveProtocol.ts)
这个纯函数模块里。同一套规则同时约束两件事：右键菜单 UI（受保护行
只显示允许的操作）和文件系统写入（被阻止的操作会弹中文 toast 并
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

面板**支持多会话**。每个会话都有自动派生的标题（取首条用户消息
的前 30 个码点），可以通过点标题弹出的 popover 重命名、切换、
删除。活跃会话 id 由服务端持久化，刷新后自动恢复。消息采用乐观
更新：按下 Enter 立即插入用户消息，服务端响应回来后用真实记录
替换原占位。

composer 走服务端调用 Anthropic。按 Enter 触发 `POST /api/ai/chat`；
服务端用 SSE 把 token 推回来，面板在气泡里逐字渲染。用户消息先
乐观插入，服务端 echo 真实 id 回来后原位替换；assistant 气泡按
字符追加，末尾有闪烁光标，`done` 事件后光标消失。流式过程中出
错会让气泡以当前已收到的部分文本收尾，并附 `[error: <reason>]`
标记 —— 用户消息不会丢。

当前打开的笔记会作为 system context 一起送给模型：面板顶部在
有笔记打开时显示一个 `📎 <标题>` 小芯片（`/tags` 等路径下隐藏），
下一次 send 会带上笔记的已保存内容。笔记内容由
`useCurrentNote`（[src/composables/vault/useCurrentNote.ts](src/composables/vault/useCurrentNote.ts)
里的模块级 singleton）按路径变化拉取一次，缓存的是服务端已保存
的 body —— 与编辑器里的未保存 buffer 之间差 800ms 自动保存的
debounce，v1 接受这个延迟，缩小差距是另一个 spec 的事。

未设 `ANTHROPIC_API_KEY` 时，composer 上方会显示一条常驻 banner，
发送按钮被禁用。配置状态在挂载时通过 `/active` 响应读取，banner
在第一次 send 之前就可见。

状态层是 [src/composables/vault/useAiHistory.ts](src/composables/vault/useAiHistory.ts)
里的模块级 singleton。HTTP 线缆格式（含带类型的 `ChatEvent` SSE
解析器）定义在 [src/lib/ai-api.ts](src/lib/ai-api.ts)。两者是
`/api/ai/*` 子路由唯一的消费方。

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
| GET    | `/api/ai/active`                    | `{ activeId, configured }` —— 未设任一 auth 环境变量时 `configured` 为 `false` |
| PUT    | `/api/ai/active`                    | 设置活跃会话 id（或 `null`）               |
| POST   | `/api/ai/chat`                      | 流式对话：请求体 `{ sessionId, content, currentNotePath?, currentNoteContent? }`，响应是 SSE（`user` / `token` / `done` / `error` 事件）。未设 auth 环境变量时返回 503 + `{ reason: 'no-api-key' }` |

文件系统路由的路径校验在
[server/paths.ts](server/paths.ts)。AI 子路由不涉及文件系统；
请求体由 handler 校验 JSON 形状，SQL 行的 snake_case 列由 mapper
翻译为 `src/lib/ai-api.ts` 中声明的 camelCase 线缆格式。

### 环境变量

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | 二选一必填 | — | Anthropic 官方 SDK 的 auth-token 变量名。只在服务端持有，浏览器永远拿不到。两个 auth 变量都没设时，`/api/ai/chat` 返回 503，面板上 banner + 禁用发送按钮同时可见。 |
| `ANTHROPIC_AUTH_TOKEN` | 与上一个二选一 | — | 部分 Anthropic 兼容代理使用的别名。服务端取第一个非空值，所以走代理时设这个（或同时设）。 |
| `ANTHROPIC_BASE_URL` | 否 | `https://api.anthropic.com` | 覆盖 API endpoint。代理暴露的是 Anthropic 兼容 API 时填这里。 |
| `ANTHROPIC_MODEL`   | 否 | `claude-sonnet-4-6` | 传给 Messages API 的 model id。代理暴露的模型名不同时覆盖这里。 |

在跑 `npm run dev` 的 shell 里设（用 shell 加载的 `.env.local`、
或在同一终端 `export` 都行）。[.env.example](.env.example) 是模板，
复制成 `.env` 再填实际值。`.env` 已 gitignore。

## 测试

```bash
npm test
```

223 个测试，分布在 27 个文件中：

- **7 个组件测试**（`src/components/vault/__tests__/`）—— 覆盖文件
  树、右键菜单、拖放、内联重命名、防止"同名文件/目录"重命名串扰
  的 kind 感知查找，以及 TagPanel。`useConfirm` / `usePrompt` /
  `useToast` 三个 composable 用 `vi.mock` 替换；树结构 fixture 是
  内联的字面量。
- **6 个 composable 测试**（`src/composables/vault/__tests__/`）——
  覆盖编辑器标签页状态机、tag filter、vault layout 持久化、markdown
  渲染、`useAiHistory` singleton（含新增的 `sendAndStream` 正常
  / 异常 / 忙时拦截分支），以及 `useCurrentNote` singleton。AI
  singleton 暴露 `__resetForTesting` 导出，用来在测试间隔离状态。
- **3 个 lib 测试**（`src/lib/__tests__/`）—— 覆盖全文搜索索引、
  AI 线缆格式（含 `streamChat` 的 SSE 解析器），以及 AI 的带类型
  fetch 封装（`fetch` 用 `vi.mock` 替换）。
- **1 个视图测试**（`src/views/__tests__/`）—— 覆盖 Tags 视图。
- **10 个后台测试**（`server/__tests__/`）—— 覆盖路径校验、PUT
  handler、tree builder、SQLite 迁移执行器、AI sessions/messages
  service、AI HTTP 子路由（用 `vi.mock` 替换 DB 模块）、LLM SDK
  封装、`runChat` / `buildSystemPrompt` 协调器，以及一个挂载完整
  Hono app 的 smoke 测试（含一次 `POST /api/ai/chat` 流式往返）。
  AI 套件通过 `vi.hoisted` 注入 `:memory:` 数据库，每个测试拿到一份
  干净的 DB；`streamClaude` 在模块边界用 `vi.mock` 替换，测试不会
  触达真实网络。

VaultView 本身没有专门测试，相关行为变更依赖 dev server 手动验证
（打开 / 编辑 / 保存 / 拖动）。

## 约定

- `src/composables/` 下的 composable 遵循两种模式：跨组件状态用
  singleton-factory（toast、confirm queue、prompt queue、theme、
  AI history），无状态规则用 pure-function-module
  （`archiveProtocol.ts`）。
- 资料库相关的 composable（`useVaultLayout` / `useEditorTabs` /
  `useTagFilter`）是 per-component factory。跨 composable 的依赖
  通过构造器参数显式传入 —— `useTagFilter({ activePanel })`、
  `useEditorTabs({ selectPanel })` —— 这种耦合是带类型的、意图
  自明的。
- `server/ai/` 下的 AI service 层是纯函数模块：每个函数把打开的
  `Database` 作为第一个参数，返回普通 JS 值。Hono handler 是
  唯一的调用方；service 层对 HTTP 一无所知。LLM 封装
  （`server/ai/llm.ts`）是整个仓库里唯一 import `@anthropic-ai/sdk`
  的文件，其余通过 `streamClaude` 回调签名与之通信 —— 测试时
  SDK 可以在模块边界被 `vi.mock` 替换。tagged `ChatError` union
  （在 `server/ai/errors.ts`）是 service 层唯一抛出的错误类型，每
  个失败都带一个 `reason` 字符串，由路由映射成状态码或 SSE
  `error` 事件。
- **流式对话的线缆格式。** `POST /api/ai/chat` 是 server-sent events
  （`Content-Type: text/event-stream`），四种事件类型：`user`（用户
  消息落库后的真实 id）、`token`（增量文本）、`done`（最终用户 +
  assistant 行 id）、`error`（reason 字符串）。服务端用 Hono 内置
  的 `streamSSE`；客户端解析器是 [src/lib/ai-api.ts](src/lib/ai-api.ts)
  里的 `streamChat`，以 `AsyncGenerator<ChatEvent>` 的形式逐个
  yield 出来。composable 迭代它，按对象身份（identity）识别乐观
  插入的消息并就地更新 —— 这就是进行中的气泡与已落库气泡的区分
  依据。
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

## 部署

生产部署走 Docker：单个容器同时托管 Vue SPA（`dist/`）和 Hono
`/api/*` 后端，统一在 3000 端口监听（由 `@hono/node-server` 提供），
SQLite 由 `better-sqlite3` 支撑，AI 走 Anthropic 兼容的 LLM 代理。

```bash
cp .env.example .env
$EDITOR .env
docker compose up -d --build
open http://localhost:3000
```

`Dockerfile` 是三阶段构建：`deps` 装全依赖并编译 `better-sqlite3`
的原生模块（用容器内的 toolchain，绕开宿主机 ABI 的 prebuilds）；
`build` 跑 `vue-tsc -b` 加 `vite build`；`runtime` 只把产线
`node_modules`、`dist/`、`server/` 拷进一个最小化的
`node:22-bookworm-slim`，加 `tini` 处理 SIGTERM、用非 root 用户。
两个命名卷持久化数据：`docus-data`（SQLite + WAL —— 聊天历史
在这里）和 `docus-content`（markdown 笔记库）。`/api/health` 接入
Docker `HEALTHCHECK` 和 `docker-compose.yml` 的 `healthcheck:`。
apt 源切到了 `mirrors.aliyun.com`（国内构建 905s → 65s），`/var/{cache,lib}/apt`
和 `/root/.npm` 都是 BuildKit cache mount，第二次构建会跳过下载
只重跑 `better-sqlite3` 的原生编译。

完整运维手册 —— 环境变量、端口配置、`read_only` / 非 root /
`no-new-privileges` 加固、故障排查（ABI 不匹配、"AI not configured"
banner、SPA 404、端口冲突）、以及把笔记库改成宿主机 bind mount
以便本地编辑器直接改 —— 在 [DEPLOY.md](DEPLOY.md)。

## 项目历史

每个特性的详细设计和实施计划位于
[docs/superpowers/](docs/superpowers/)：

- [specs/](docs/superpowers/specs/) —— 编码前的设计意图
  - [`2026-06-06-ai-panel-design.md`](docs/superpowers/specs/2026-06-06-ai-panel-design.md) —— 右栏 AI 面板骨架
  - [`2026-06-07-sqlite-ai-history.md`](docs/superpowers/specs/2026-06-07-sqlite-ai-history.md) —— SQLite 持久化的多会话聊天历史
  - [`2026-06-07-llm-integration.md`](docs/superpowers/specs/2026-06-07-llm-integration.md) —— 服务端代理的 Anthropic 流式、笔记上下文、缺 key banner
- [plans/](docs/superpowers/plans/) —— 逐步实施计划，通常连 commit
  顺序都已选好
  - [`2026-06-07-sqlite-ai-history.md`](docs/superpowers/plans/2026-06-07-sqlite-ai-history.md)
  - [`2026-06-07-llm-integration.md`](docs/superpowers/plans/2026-06-07-llm-integration.md)
