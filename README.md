# docus

A Vue 3 + TypeScript personal knowledge base built around a small
Zettelkasten protocol. The vault lives as plain `.md` files under
`src/content/` and is served by an in-process Hono backend. The editor
is CodeMirror; the file tree and the right pane (editor + live preview)
share a VS-Code-style layout. A right-side AI chat panel rounds out
the surface — its history is persisted to a small SQLite database that
the Hono server opens on startup.

## Quick start

```bash
npm install
npm run dev          # vite + Hono middleware, http://localhost:5173
npm test             # vitest, 27 files / 223 tests
npm run build        # vue-tsc -b && vite build
```

The Hono backend (`server/`) is mounted as Vite middleware in dev, so
no separate process is required. On first run the server creates
`data/docus.db` (gitignored) and applies any pending SQL migrations
from `server/migrations/`. Endpoints are namespaced under `/api/...`
and documented inline in [server/index.ts](server/index.ts).

The AI panel calls Anthropic's Messages API. The browser never sees
the key; set `ANTHROPIC_API_KEY` in the server's environment before
starting `npm run dev`. `ANTHROPIC_MODEL` overrides the default
(`claude-sonnet-4-6`). When the key is unset, the panel shows a
banner and the send button is disabled.

## Repository layout

```
src/
  views/                 One component per route (Vault, Tags, Article, TagDetail)
  components/
    vault/               FileTree, TreeRow, EditorPane, PreviewPane, EditorTabs,
                         Breadcrumb, CommandPalette, StatusBar, TagPanel,
                         ActivityBar, AiPanel, AiSessionPicker
  composables/           useToast / useConfirm / usePrompt / useTheme
                         (UI singletons)
    zettelProtocol.ts    Pure functions: which paths are read-only / protected
                         and the user-facing error messages
    vault/               useVaultLayout, useEditorTabs, useTagFilter,
                         useAiHistory, useCurrentNote — the state and
                         side-effects split out of VaultView.vue and
                         AiPanel.vue
  lib/
    api.ts               Typed fetch wrappers for /api/posts, /api/tree, …
    ai-api.ts            Typed fetch wrappers for /api/ai/*, including
                         the streamChat SSE parser for /api/ai/chat
    search.ts            MiniSearch full-text index, built client-side
    markdown.ts, frontmatter.ts
  content/               The vault itself — three top-level folders
                         (inbox / literature / zettel) plus everything
                         the user writes
  router/                vue-router setup (vault uses a splat param)

server/
  index.ts               Top-level Hono app; mounts the sub-routers
  db.ts                  better-sqlite3 singleton + applyMigrations runner
  migrations/            Numbered .sql files, applied transactionally on
                         startup against data/docus.db
  ai/                    AI sub-app
    errors.ts            Tagged ChatError union (no-api-key / not-found /
                         empty / aborted / llm-error)
    llm.ts               streamClaude(): thin wrapper around
                         @anthropic-ai/sdk, the only file that knows
                         about the SDK
    chat.ts              runChat() orchestrator + buildSystemPrompt();
                         pure business logic, no HTTP knowledge
    messages.ts          Append/list messages; validates role ∈ {user, assistant}
    sessions.ts          Sessions CRUD
    routes.ts            Hono sub-router; the only place that knows HTTP
  tree.ts                Filesystem walker -> PostSummary[] / TreeNode[]
  paths.ts               Path validation + filesystem <-> URL mapping
  vite-plugin.ts         Mounts the Hono app as Vite middleware
  __tests__/             vitest in node mode; tests call app.fetch(req)
                         directly, with :memory: databases for the AI suite

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
toggles the Files panel, the AI button in the NavBar toggles the AI
panel.

Layout state — which side panel is open, side-panel widths, the
editor/preview split ratio — is persisted to `localStorage` under
`docus.vault.layout`. The serializer is a custom one because the
schema used to be `{ fileTreeOpen, fileTreeWidth }` and old installs
still have that shape; reads translate it forward. AI-specific
layout keys (`aiOpen`, `aiPanelWidth`) follow the same pattern.

## AI panel

The right rail of the vault hosts a chat panel styled after the
Claude Code panel in VS Code. Open it from the NavBar button
between Search and the view-mode toggle; the splitter on the panel's
right edge resizes it in the same `[220, 600]px` range as the left
side panel.

The panel is **multi-session**. Each session has an auto-derived
title (trimmed to 30 code points from the first user message) and
can be renamed, switched, or deleted from the popover opened by
clicking the title. The active session id is stored server-side and
restored on reload. Messages append optimistically: pressing Enter
inserts the user message immediately and the server's echo replaces
it once the HTTP response lands.

The composer calls Anthropic via the server. Pressing Enter opens
`POST /api/ai/chat`; the server streams tokens back over SSE and the
panel fills the assistant bubble as they arrive. The user message is
appended optimistically; the optimistic user id is replaced in place
once the server echoes its real id, and tokens append to the assistant
bubble character by character. A blinking caret sits at the end of
the in-flight bubble and disappears on `done`. Errors during the
stream finalize the bubble with the partial text plus a
`[error: <reason>]` marker; the user message is never lost.

The currently open note is sent as system context: the panel header
shows a `📎 <title>` chip when a note is open (hidden on `/tags` and
similar), and the next send includes the note's saved content. The
note is fetched once per path change by
`useCurrentNote` (module-level singleton in
[src/composables/vault/useCurrentNote.ts](src/composables/vault/useCurrentNote.ts)),
which derives the path from the `/vault/<path>` splat and caches
the server-saved body. The cached content lags the editor's unsaved
buffer by the 800ms auto-save debounce — acceptable for v1; closing
that gap is a separate spec.

When `ANTHROPIC_API_KEY` is unset, the panel shows a persistent
banner above the composer and the send button is disabled. The
configured state is read from the `/active` response on mount, so
the banner is visible before the first send.

The composable is `useAiHistory` (module-level singleton in
[src/composables/vault/useAiHistory.ts](src/composables/vault/useAiHistory.ts)).
Session and message state live in a `ref`-based store; the HTTP wire
format (including the typed `ChatEvent` SSE parser) is defined in
[src/lib/ai-api.ts](src/lib/ai-api.ts). Both are the only consumers
of the `/api/ai/*` sub-router.

## Backend

The backend is a small Hono app. Most endpoints are stateless and
read or write files under `src/content/`; the AI sub-router reads
and writes to a SQLite database.

### Persistence

The server opens `data/docus.db` via `better-sqlite3` on startup
([server/db.ts](server/db.ts)). The first run applies
`server/migrations/0001_ai_history.sql`, which creates `sessions`,
`messages`, and a single-row `settings` table (currently used for
the active session id). Migrations are tracked by a `schema_version`
table and applied transactionally; new migrations are numbered files
dropped into `server/migrations/`. WAL mode is on by default;
foreign keys are enforced.

### HTTP endpoints

**Vault / filesystem**

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

**AI / SQLite**

| Method | Path                                | Purpose                                     |
| ------ | ----------------------------------- | ------------------------------------------- |
| GET    | `/api/ai/sessions`                  | `Session[]` (most-recent first)             |
| GET    | `/api/ai/sessions/<id>/messages`    | `Message[]` (chronological)                 |
| POST   | `/api/ai/sessions`                  | Create a session (`{ title? }`)             |
| PATCH  | `/api/ai/sessions/<id>`             | Rename (`{ title }`)                        |
| DELETE | `/api/ai/sessions/<id>`             | Delete (cascades messages; clears active if needed) |
| POST   | `/api/ai/sessions/<id>/messages`    | Append a message (validates role)           |
| GET    | `/api/ai/active`                    | `{ activeId, configured }` — `configured` is `false` when no auth env var is set |
| PUT    | `/api/ai/active`                    | Set active session id (or `null`)           |
| POST   | `/api/ai/chat`                      | Streaming chat; body is `{ sessionId, content, currentNotePath?, currentNoteContent? }`, response is SSE (`user` / `token` / `done` / `error` events). Returns 503 with `{ reason: 'no-api-key' }` when no auth env var is set. |

Path validation for the filesystem routes is in
[server/paths.ts](server/paths.ts). The AI sub-router has no
filesystem involvement; its request bodies are JSON-validated by
the handlers, and SQL row mappers translate snake_case columns to
the camelCase wire format declared in `src/lib/ai-api.ts`.

### Environment variables

| Var | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | one of these is required for chat | — | The official Anthropic SDK auth-token env var. Held server-side; the browser never sees it. When neither this nor `ANTHROPIC_AUTH_TOKEN` is set, `/api/ai/chat` returns 503 and the panel's banner + disabled send button are visible. |
| `ANTHROPIC_AUTH_TOKEN` | alternative to `ANTHROPIC_API_KEY` | — | Alt env-var name used by some Anthropic-compatible proxies. The server picks the first non-empty value, so set this instead of (or in addition to) `ANTHROPIC_API_KEY` when using a proxy. |
| `ANTHROPIC_BASE_URL` | no | `https://api.anthropic.com` | Override the API endpoint. Set when using a proxy that exposes an Anthropic-compatible API. |
| `ANTHROPIC_MODEL`   | no  | `claude-sonnet-4-6` | Model id passed to the Messages API. Override when the proxy exposes different model names. |

Set them in the shell that runs `npm run dev` (e.g. in a
`.env.local` loaded by your shell, or via `export ...` in the same
terminal). A template is at [`.env.example`](.env.example) — copy
it to `.env` and fill in real values. `.env` is gitignored.

## Testing

```bash
npm test
```

223 tests across 27 files:

- **7 component tests** under `src/components/vault/__tests__/` —
  cover the file tree, context menu, drag-and-drop, inline rename,
  the kind-aware lookup that prevents a same-name file/folder
  collision from misrouting renames, and the tag panel. The
  composables `useConfirm` / `usePrompt` / `useToast` are
  `vi.mock`-ed; tree fixtures are inline literals.
- **6 composable tests** under `src/composables/vault/__tests__/` —
  cover the editor tabs state machine, the tag filter, the vault
  layout persistence, the markdown render, the `useAiHistory`
  singleton (including the new `sendAndStream` happy / error /
  busy-guard paths), and the `useCurrentNote` singleton. The AI
  singletons expose `__resetForTesting` exports to isolate state
  between tests.
- **3 lib tests** under `src/lib/__tests__/` — cover the full-text
  search index, the AI HTTP wire format (including the `streamChat`
  SSE parser), and the AI typed fetch wrappers (`fetch` is
  `vi.mock`-ed).
- **1 view test** under `src/views/__tests__/` — covers the Tags
  view.
- **10 server tests** under `server/__tests__/` — exercise the path
  validation, the PUT handler, the tree builder, the SQLite
  migration runner, the AI sessions and messages services, the AI
  HTTP sub-router (with `vi.mock` of the DB module), the LLM SDK
  wrapper, the `runChat` / `buildSystemPrompt` orchestrator, and a
  smoke test that mounts the full Hono app (including a streaming
  `POST /api/ai/chat` round-trip). The AI suite uses `:memory:`
  databases via `vi.hoisted` to inject a fresh DB per test, and
  `streamClaude` is `vi.mock`-ed at the module boundary so the
  tests don't hit the network.

VaultView itself has no dedicated tests; behavior changes there
rely on the dev server's manual smoke (open / edit / save / drag).

## Conventions

- **Composables** in `src/composables/` follow the singleton-factory
  pattern when they hold cross-component state (toasts, confirm
  queue, prompt queue, theme, AI history), and the pure-function-
  module pattern when they are stateless rules (`zettelProtocol.ts`).
- **The vault composables** (`useVaultLayout`, `useEditorTabs`,
  `useTagFilter`) are per-component factories. Cross-composable
  dependencies are taken as constructor arguments — `useTagFilter({ activePanel })`,
  `useEditorTabs({ selectPanel })` — so the coupling is typed and
  intention-revealing.
- **The AI service layer** in `server/ai/` is a flat module of
  pure functions: each function takes the open `Database` as its
  first argument and returns plain JS values. The Hono handlers in
  `server/ai/routes.ts` are the only callers; the service layer
  has no knowledge of HTTP. The LLM wrapper (`server/ai/llm.ts`)
  is the only file that imports `@anthropic-ai/sdk`; the rest of
  the module talks to it through the `streamClaude` callback
  signature, so the SDK can be `vi.mock`-ed at the module
  boundary in tests. The tagged `ChatError` union (in
  `server/ai/errors.ts`) is the only error type the service layer
  throws — every failure has a `reason` string that the route
  maps to a status code or an SSE `error` event.
- **Streaming chat wire format.** `POST /api/ai/chat` is
  server-sent events (`Content-Type: text/event-stream`) with four
  event types: `user` (saved user row id), `token` (incremental
  text), `done` (final user + assistant row ids), `error` (a
  reason string). The server uses Hono's built-in `streamSSE`;
  the client parser lives in `streamChat` (in
  [src/lib/ai-api.ts](src/lib/ai-api.ts)) and yields typed
  `ChatEvent` objects as an `AsyncGenerator`. The composable
  iterates it and updates the optimistic messages by object
  identity — that's how in-flight bubbles are distinguished from
  persisted ones.
- **Server types** (`PostSummary`, `TreeNode`, `PostDetail`) live
  in [src/lib/api.ts](src/lib/api.ts); the AI wire types (`Session`,
  `Message`) live in [src/lib/ai-api.ts](src/lib/ai-api.ts). Both
  are imported by the client and the server. The server is
  intentionally not in the `tsc` include graph (no
  `tsconfig.server.json`), but the import direction is
  `server/ -> src/lib/*` to keep one source of truth for each wire
  format.
- **Migrations** are forward-only SQL files. Each one must be
  idempotent on its own (use `CREATE TABLE IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`, etc.) and is wrapped in a
  transaction by the runner. To roll back, write a forward fix —
  never edit a committed migration.

## Deployment

Production runs in a single Docker container that hosts both the
prebuilt SPA (`dist/`) and the Hono `/api/*` backend on one port
(3000), backed by SQLite via `better-sqlite3` and an
Anthropic-compatible LLM proxy.

```bash
cp .env.example .env
$EDITOR .env
docker compose up -d --build
open http://localhost:3000
```

The Dockerfile is a three-stage build: `deps` installs everything
and compiles the `better-sqlite3` native module against the
in-container toolchain (avoids host-ABI prebuilds); `build` runs
`vue-tsc -b` and `vite build`; `runtime` copies just the
production `node_modules`, `dist/`, and `server/` into a
`node:22-bookworm-slim` with `tini` for proper SIGTERM and a
non-root user. Two named volumes persist state: `docus-data`
(SQLite + WAL — chat history) and `docus-content` (the markdown
vault). `/api/health` is wired into the Docker `HEALTHCHECK` and
into `docker-compose.yml`'s `healthcheck:`. `apt` is mirrored to
`mirrors.aliyun.com` and `/var/{cache,lib}/apt` plus `/root/.npm`
are BuildKit cache mounts, so the second build skips the download
and only re-runs the `better-sqlite3` native compile.

Full operator runbook — env vars, the `read_only` / non-root /
`no-new-privileges` hardening, port configuration, troubleshooting
(ABI mismatches, "AI not configured" banner, SPA 404, port
collisions), and switching the vault to a host bind-mount for live
editing — is in [DEPLOY.md](DEPLOY.md).

## Project history

The detailed design and plan documents for each feature live under
[docs/superpowers/](docs/superpowers/):

- [specs/](docs/superpowers/specs/) — design intent before code
  - [`2026-06-06-ai-panel-design.md`](docs/superpowers/specs/2026-06-06-ai-panel-design.md) — right-rail AI panel skeleton
  - [`2026-06-07-sqlite-ai-history.md`](docs/superpowers/specs/2026-06-07-sqlite-ai-history.md) — SQLite-backed multi-session chat history
  - [`2026-06-07-llm-integration.md`](docs/superpowers/specs/2026-06-07-llm-integration.md) — server-proxied Anthropic streaming, note context, no-key banner
- [plans/](docs/superpowers/plans/) — step-by-step implementation
  plans, often with the commit sequence already chosen
  - [`2026-06-07-sqlite-ai-history.md`](docs/superpowers/plans/2026-06-07-sqlite-ai-history.md)
  - [`2026-06-07-llm-integration.md`](docs/superpowers/plans/2026-06-07-llm-integration.md)
