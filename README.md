# docus

A Vue 3 + TypeScript personal knowledge base built around a small
Zettelkasten protocol. The vault lives as plain `.md` files under
`src/content/` and is served by an in-process Hono backend. The editor
is CodeMirror; the file tree and the right pane (editor + live preview)
share a VS-Code-style layout.

## Quick start

```bash
npm install
npm run dev          # vite + Hono middleware, http://localhost:5173
npm test             # vitest, 9 files / 48 tests
npm run build        # vue-tsc -b && vite build
```

The Hono backend (`server/`) is mounted as Vite middleware in dev, so
no separate process is required. Endpoints are namespaced under
`/api/...` and documented inline in [server/index.ts](server/index.ts).

## Repository layout

```
src/
  views/                 One component per route (Vault, Tags, Article, TagDetail)
  components/
    vault/               FileTree, TreeRow, EditorPane, PreviewPane, EditorTabs,
                         Breadcrumb, CommandPalette, StatusBar, TagPanel, ActivityBar
  composables/           useToast / useConfirm / usePrompt / useTheme
                         (UI singletons)
    zettelProtocol.ts    Pure functions: which paths are read-only / protected
                         and the user-facing error messages
    vault/               useVaultLayout, useEditorTabs, useTagFilter — the
                         state and side-effects split out of VaultView.vue
  lib/
    api.ts               Typed fetch wrappers for /api/...
    search.ts            MiniSearch full-text index, built client-side
    markdown.ts, frontmatter.ts
  content/               The vault itself — three top-level folders
                         (inbox / literature / zettel) plus everything
                         the user writes
  router/                vue-router setup (vault uses a splat param)

server/
  index.ts               All HTTP routes
  tree.ts                Filesystem walker -> PostSummary[] / TreeNode[]
  paths.ts               Path validation + filesystem <-> URL mapping
  vite-plugin.ts         Mounts the Hono app as Vite middleware
  __tests__/             vitest in node mode; tests call app.fetch(req) directly

docs/superpowers/
  specs/                 Design docs (per feature)
  plans/                 Implementation plans (per feature)
```

## The Zettelkasten protocol

The three top-level folders are part of the spec, not user-editable
choices:

- **`inbox/`** — capture bucket. Anything new lands here.
- **`literature/`** — long-form reference material.
- **`zettel/`** — permanent notes. The entire subtree is read-only.

Rename, delete, and re-parenting of these roots are rejected by the
client and the server. The rules live in
[src/composables/zettelProtocol.ts](src/composables/zettelProtocol.ts)
as a flat module of pure functions. The same rules gate both the
context-menu UI (read-only rows hide write buttons) and the
filesystem writes (a blocked op shows a Chinese toast and returns
early).

Adding a fourth protected root, or changing the user-facing messages,
means editing one file.

## The vault

The vault lives at `/vault` and accepts a path splat: `/vault/<path>`.
Open via the file tree, ⌘P / Ctrl+P command palette, or by deep-linking
to a path.

Editor tabs hold unsaved state per file. Edits auto-save 800ms after
the last keystroke; the debounce lives in `useEditorTabs`. ⌘S saves
immediately, ⌘W closes the active tab (with a confirm if dirty), ⌘B
toggles the Files panel.

Layout state — which side panel is open, side-panel width, and the
editor/preview split ratio — is persisted to `localStorage` under
`docus.vault.layout`. The serializer is a custom one because the
schema used to be `{ fileTreeOpen, fileTreeWidth }` and old installs
still have that shape; reads translate it forward.

## Backend

The backend is a small Hono app with these endpoints:

| Method | Path                       | Purpose                                     |
| ------ | -------------------------- | ------------------------------------------- |
| GET    | `/api/tree`                | `TreeNode[]` (folders + files, sorted)      |
| GET    | `/api/posts`               | `PostSummary[]` (flat post metadata)        |
| GET    | `/api/posts/<path>`        | Raw markdown + parsed frontmatter           |
| POST   | `/api/posts`               | Create a new post                           |
| PUT    | `/api/posts/<path>`        | Save raw content                            |
| PATCH  | `/api/posts/<path>`        | Rename within folder (`name`) or move (`targetPath`) |
| DELETE | `/api/posts/<path>`        | Delete a file                               |
| POST   | `/api/folders`             | Create an empty folder                      |
| PATCH  | `/api/folders/<path>`      | Single-segment folder rename                |
| DELETE | `/api/folders/<path>`      | Recursive folder delete (requires `?recursive=true`) |
| GET    | `/api/health`              | `{ ok: true }`                              |

Path validation is in [server/paths.ts](server/paths.ts). Every path
segment is a lowercase kebab; the server rejects anything that
resolves outside `src/content/`.

## Testing

```bash
npm test
```

48 tests across 9 files:

- 6 component tests under `src/components/vault/__tests__/` — cover
  the file tree, context menu, drag-and-drop, inline rename, and the
  kind-aware lookup that prevents a same-name file/folder collision
  from misrouting renames. The composables `useConfirm` / `usePrompt`
  / `useToast` are `vi.mock`-ed; tree fixtures are inline literals.
- 3 server tests under `server/__tests__/` — exercise the path
  validation, the PUT handler, and the tree builder against a
  temporary `content/` directory.

VaultView itself has no dedicated tests; behavior changes there rely
on the dev server's manual smoke (open / edit / save / drag).

## Conventions

- **Composables** in `src/composables/` follow the singleton-factory
  pattern when they hold cross-component state (toasts, confirm queue,
  prompt queue, theme), and the pure-function-module pattern when
  they are stateless rules (`zettelProtocol.ts`).
- **The vault composables** (`useVaultLayout`, `useEditorTabs`,
  `useTagFilter`) are per-component factories. Cross-composable
  dependencies are taken as constructor arguments — `useTagFilter({ activePanel })`,
  `useEditorTabs({ selectPanel })` — so the coupling is typed and
  intention-revealing.
- **Server types** (`PostSummary`, `TreeNode`, `PostDetail`) live in
  [src/lib/api.ts](src/lib/api.ts) and are imported by both the
  client and the server. The server is intentionally not in the
  `tsc` include graph (no `tsconfig.server.json`), but the import
  direction is `server/ -> src/lib/api` to keep one source of truth
  for the JSON wire format.

## Project history

The detailed design and plan documents for each feature live under
[docs/superpowers/](docs/superpowers/):

- [specs/](docs/superpowers/specs/) — design intent before code
- [plans/](docs/superpowers/plans/) — step-by-step implementation
  plans, often with the commit sequence already chosen
