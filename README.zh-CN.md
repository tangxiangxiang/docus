# docus

一个基于 Vue 3 + TypeScript 的个人知识库，围绕一套小型 Zettelkasten
协议构建。资料库本体是 `src/content/` 下的纯 `.md` 文件，由一个
进程内的 Hono 后台服务支撑。编辑器使用 CodeMirror；文件树与右侧
面板（编辑器 + 实时预览）采用类 VS Code 的布局。

## 快速开始

```bash
npm install
npm run dev          # vite + Hono 中间件, http://localhost:5173
npm test             # vitest, 9 个文件 / 48 个测试
npm run build        # vue-tsc -b && vite build
```

Hono 后台（`server/`）在 dev 模式下作为 Vite 中间件挂载，无需单独
启动进程。所有端点都在 `/api/...` 命名空间下，路由表内联在
[server/index.ts](server/index.ts) 中。

## 目录结构

```
src/
  views/                 一个组件对应一个路由（Vault / Tags / Article / TagDetail）
  components/
    vault/               FileTree, TreeRow, EditorPane, PreviewPane, EditorTabs,
                         Breadcrumb, CommandPalette, StatusBar, TagPanel, ActivityBar
  composables/           useToast / useConfirm / usePrompt / useTheme
                         （UI 单例）
    zettelProtocol.ts    纯函数：哪些路径是只读 / 受保护，及其对应的
                         用户提示文案
    vault/               useVaultLayout, useEditorTabs, useTagFilter —
                         从 VaultView.vue 拆分出来的状态与副作用
  lib/
    api.ts               /api/... 的带类型的 fetch 封装
    search.ts            客户端构建的 MiniSearch 全文索引
    markdown.ts, frontmatter.ts
  content/               资料库本体 —— 三个顶层目录
                         (inbox / literature / zettel) 以及用户写下的所有内容
  router/                vue-router 配置（vault 使用 splat 参数）

server/
  index.ts               所有 HTTP 路由
  tree.ts                文件系统遍历 -> PostSummary[] / TreeNode[]
  paths.ts               路径校验 + 文件系统 <-> URL 映射
  vite-plugin.ts         将 Hono app 挂载为 Vite 中间件
  __tests__/             vitest（node 模式），测试直接调用 app.fetch(req)

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
标签页（有未保存修改时会确认），`⌘B` 切换 Files 面板。

布局状态 —— 当前打开的侧栏、侧栏宽度、编辑器/预览分割比例 ——
持久化到 `localStorage` 的 `docus.vault.layout` 键。序列化器是
自定义的，因为早期 schema 是 `{ fileTreeOpen, fileTreeWidth }`，
老用户可能仍是这个形态；读取时会前向翻译到新 schema。

## 后台

后台是一个小型 Hono app，端点如下：

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

路径校验在 [server/paths.ts](server/paths.ts)。每个路径段必须是
小写 kebab；任何解析后落到 `src/content/` 之外的请求都会被拒绝。

## 测试

```bash
npm test
```

48 个测试，分布在 9 个文件中：

- 6 个组件测试，位于 `src/components/vault/__tests__/` —— 覆盖文件
  树、右键菜单、拖放、内联重命名，以及防止"同名文件/目录"重命名
  串扰的 kind 感知查找。`useConfirm` / `usePrompt` / `useToast` 三个
  composable 用 `vi.mock` 替换；树结构 fixture 是内联的字面量。
- 3 个后台测试，位于 `server/__tests__/` —— 围绕临时 `content/`
  目录测试路径校验、PUT handler，以及 tree builder。

VaultView 本身没有专门测试，相关行为变更依赖 dev server 手动验证
（打开 / 编辑 / 保存 / 拖动）。

## 约定

- `src/composables/` 下的 composable 遵循三种模式：跨组件状态用
  singleton-factory（toast、confirm queue、prompt queue、theme），
  无状态规则用 pure-function-module（`zettelProtocol.ts`）。
- 资料库相关的 composable（`useVaultLayout` / `useEditorTabs` /
  `useTagFilter`）是 per-component factory。跨 composable 的依赖
  通过构造器参数显式传入 —— `useTagFilter({ activePanel })`、
  `useEditorTabs({ selectPanel })` —— 这种耦合是带类型的、意图
  自明的。
- 后台类型（`PostSummary` / `TreeNode` / `PostDetail`）定义在
  [src/lib/api.ts](src/lib/api.ts)，客户端和服务端都从这里 import。
  服务端目前故意不在 `tsc` include 图中（没有 `tsconfig.server.json`），
  但 import 方向是 `server/ -> src/lib/api`，让 JSON 线缆格式只有
  一个真相来源。

## 项目历史

每个特性的详细设计和实施计划位于
[docs/superpowers/](docs/superpowers/)：

- [specs/](docs/superpowers/specs/) —— 编码前的设计意图
- [plans/](docs/superpowers/plans/) —— 逐步实施计划，通常连 commit
  顺序都已选好
