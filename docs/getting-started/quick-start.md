# Quick Start

## Run the Development Server

After [installing dependencies](installation.md) and creating the default vault directories:

```bash
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`. Vite serves the Vue application and mounts the Hono API as middleware; no second server process is needed.

On startup Docus opens `data/docus.db`, applies pending SQL migrations, reconciles interrupted file operations, and then imports current Markdown metadata. The default note vault is `src/content/`.

## First Use

1. Create or open a note under `inbox/` or `literature/`.
2. Edit the Markdown source. Docus saves after 800 ms of inactivity; `Ctrl+S` or `Command+S` saves immediately.
3. Open Document Properties to set the display title, summary, and tags.
4. Use the History panel to create a named Git version when the change is worth keeping.
5. Configure an AI provider in Settings only if you want AI chat and file tools.

## Basic Verification

```bash
npm run typecheck
npm test
npm run build
```

For feature guidance, continue with the [User Guide](../user-guide/overview.md). For a production instance, use the [Deployment Overview](../deployment/overview.md).
