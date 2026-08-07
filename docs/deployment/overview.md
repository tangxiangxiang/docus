# Deployment Overview

Docus runs as one Node.js process: Hono serves `/api/*`, the built Vue application is served from `dist/`, and non-API paths fall back to `index.html` for client-side routing.

## Recommended: Docker Compose

```bash
docker compose up -d --build
```

The supplied Compose service:

- exposes container port 3000 at `127.0.0.1:3000` by default;
- bind-mounts `./src/content` as the Markdown vault;
- stores `data/` in the `docus-data` named volume;
- runs as UID/GID 1000 with a read-only root filesystem, `no-new-privileges`, and a `/tmp` tmpfs;
- checks `/api/health` every 30 seconds.

Continue with [Docker](docker.md), [Security](security.md), and [Backup and Restore](backup-and-restore.md).

## Bare-Metal Production

Use Node.js 22 for production parity:

```bash
npm ci
npm run build
NODE_ENV=production npm run start
```

The production server defaults to `127.0.0.1:3000`. Set `VAULT_DIR` if the vault is not `<working-directory>/src/content`. The process creates the protected root folders, runs server-side crash recovery, migrates document metadata, then starts accepting requests.

Run the process under a service manager and put an authenticated TLS reverse proxy in front of it if remote access is required. Docus itself does not implement user authentication or TLS.

## Health Check

```bash
curl --fail http://127.0.0.1:3000/api/health
```

A healthy response contains `ok: true` and a vault identifier used to scope browser state.
