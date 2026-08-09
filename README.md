# Docus

[简体中文](README.zh-CN.md) · [Documentation](docs/README.md) · [Deployment](docs/deployment/overview.md)

Docus is a self-hosted Markdown knowledge workspace for writing, organizing, versioning, linking, and optionally working with AI. Your notes remain ordinary files; Docus adds a Vue interface, safe server-side mutations, SQLite metadata, explicit Git versions, and browser draft recovery.

![Docus logo](public/logo.svg)

## Highlights

- **File-based Markdown vault** — keep readable `.md` files under `inbox`, `literature`, and `archive`.
- **Focused editor and reader** — Monaco editing, sanitized Markdown rendering, task lists, footnotes, Mermaid, Markmap, and Wiki links.
- **Resilient saves** — autosave, compare-and-swap conflict detection, atomic writes, lifecycle locks, and startup crash recovery.
- **Draft recovery** — bounded unsaved-buffer recovery in browser IndexedDB.
- **Metadata and search** — SQLite-backed titles, summaries, tags, stable document IDs, file-tree filters, and a command palette.
- **Links and backlinks** — resolve Wiki and relative Markdown links and keep references coordinated across supported renames and moves.
- **Explicit history** — create, compare, restore, and withdraw versions in the vault's own Git repository.
- **Optional AI** — Anthropic or OpenAI chat with live workspace context and validated file/metadata tools. Settings includes a manual connection test that validates the currently displayed provider, credential, Base URL, and model before use without saving transient test values; see the [AI guide](docs/user-guide/ai.md).
- **Self-hosted runtime** — one production process serves the Vue application and Hono API; Docker Compose is included.

## Quick Start

Requirements: Node.js 22 or 24, npm, and Git.

```bash
npm ci
mkdir -p src/content/inbox src/content/literature src/content/archive
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`.

The source development path requires the three vault roots to exist. The production server creates missing initial roots automatically. See [Installation](docs/getting-started/installation.md) and [Quick Start](docs/getting-started/quick-start.md) for details.

## How It Fits Together

```mermaid
flowchart LR
  Browser["Vue browser app"] -->|/api| Server["Hono server"]
  Server --> Vault["Markdown vault + vault Git"]
  Server --> DB["SQLite metadata and AI state"]
  Browser --> Drafts["IndexedDB recovery drafts"]
  Server --> AI["Anthropic or OpenAI"]
```

The browser never writes vault files directly. The server owns path validation, archive rules, filesystem transactions, SQLite coordination, history, and provider credentials. The stores have different backup semantics; read [Architecture](docs/architecture/overview.md) and [Storage](docs/architecture/storage.md) before operating a production instance.

## Vault Model

The default vault is `src/content/`. Set `VAULT_DIR` for another location.

```text
src/content/
├── inbox/       active notes and new material
├── literature/  reading and source notes
└── archive/     retained, intentionally constrained notes
```

The three roots cannot be renamed or deleted. Notes move from active roots into `archive`; archived notes cannot be renamed, deleted, or moved back out through Docus. See [Vault and Archive Protocol](docs/user-guide/vault.md).

## Production Deployment

The recommended deployment is Docker Compose:

```bash
docker compose up -d --build
curl --fail http://127.0.0.1:3000/api/health
```

By default, Compose binds only to `127.0.0.1:3000`, mounts `./src/content` as the vault, and stores SQLite plus the managed AI master key in the `docus-data` volume.

Docus does **not** provide authentication or TLS. Keep it on loopback or a private network, or put an authenticated TLS reverse proxy in front of it. Back up both the vault—including its hidden `.git`—and `data/`.

- [Deployment overview](docs/deployment/overview.md)
- [Docker guide](docs/deployment/docker.md)
- [Runtime configuration](docs/deployment/configuration.md)
- [Security checklist](docs/deployment/security.md)
- [Backup and restore](docs/deployment/backup-and-restore.md)

## Configuration

Server settings include:

| Variable | Default | Purpose |
| --- | --- | --- |
| `VAULT_DIR` | `<cwd>/src/content` | Vault root |
| `HOST` | `127.0.0.1` | Bare-metal listener address |
| `PORT` | `3000` | Bare-metal listener port |
| `DOCUS_MASTER_KEY` | unset | Explicit 32-byte AI credential master key |
| `DOCUS_MASTER_KEY_FILE` | unset | File containing the master key |

AI provider, API key, model, and optional base URL are configured in application Settings, not through provider-specific environment variables. If no explicit master key is supplied, Docus creates `data/.docus-master-key` when an API key is first saved.

See [Configuration](docs/getting-started/configuration.md) for the complete precedence and Docker-specific variables.

## Documentation

The [Documentation Hub](docs/README.md) is the canonical index.

- [User guide](docs/user-guide/overview.md)
- [Architecture](docs/architecture/overview.md)
- [Development setup](docs/development/setup.md)
- [Testing](docs/development/testing.md)
- [Design system](docs/design/icon-system.md)
- [Metadata migration](docs/migrations/document-metadata.md)
- [Historical archive](docs/archive/README.md)

Current behavior is documented outside `docs/archive/`. Dated plans, specifications, closure evidence, and implementation records are retained in the archive for traceability only.

## Development and Verification

```bash
npm run typecheck
npm run build
npm test
npm run lint:icons
```

Browser suites are available with:

```bash
npm run test:e2e
npm run test:e2e:draft-store
```

CI verifies Node.js 22 on Ubuntu for production parity and Node.js 24 on Ubuntu, macOS, and Windows for forward compatibility, along with crash-recovery, browser E2E, visual, and Docker smoke tests.

## Project Status

`package.json` currently reports version `0.0.0`. Docus is an actively developed application rather than a published stable compatibility contract. Back up real vaults before upgrading, review the [changelog](CHANGELOG.md), and validate deployment changes in a copy of your data.

## License

This repository does not currently include a license file. Do not assume rights to redistribute or reuse the project until the maintainers add explicit license terms.
