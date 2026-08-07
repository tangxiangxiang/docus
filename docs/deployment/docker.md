# Docker Deployment

## Prepare the Vault

Compose bind-mounts the host's `./src/content` at `/app/src/content`. On Linux or NAS hosts, make it writable by UID/GID 1000, which is the container user:

```bash
mkdir -p src/content/inbox src/content/literature src/content/archive
sudo chown -R 1000:1000 src/content
```

Do not treat this directory as disposable application state. It is the note vault and contains its own `.git/` history after History is used.

## Start

```bash
docker compose up -d --build
docker compose ps
```

Open `http://localhost:3000`. The host binding defaults to loopback even though the process inside the container must listen on `0.0.0.0`.

## Data Mounts

| Container path | Compose source | Contents |
| --- | --- | --- |
| `/app/src/content` | Host bind mount `./src/content` | Markdown bodies, vault `.git/`, vault `.docus/`, and vault-local ignore files. |
| `/app/data` | Named volume `docus-data` | `docus.db`, SQLite WAL/SHM files, and the auto-managed `.docus-master-key`. |
| `/tmp` | tmpfs | Ephemeral process scratch space. |

The root filesystem is read-only. Only the two data mounts and `/tmp` are writable.

## Logs and Health

```bash
docker compose logs -f docus
docker inspect --format '{{.State.Health.Status}}' docus
curl --fail http://127.0.0.1:3000/api/health
```

Compose uses the `json-file` logging driver with a 10 MiB file limit and three rotated files.

## Upgrade

Back up both persistent stores first, then rebuild and replace the container:

```bash
docker compose build
docker compose up -d
docker compose ps
```

Image replacement does not remove the bind mount or named volume. Check the startup log for crash-recovery and metadata-migration failures before declaring the upgrade complete.

## Common Problems

- **Permission denied under `/app/src/content`:** correct the host directory ownership or ACL for UID/GID 1000.
- **Port already in use:** change `DOCS_PORT` in `.env`.
- **History unavailable:** the image includes Git; inspect the vault's `.git/` permissions and the History initialization error.
- **AI key cannot be decrypted:** restore the matching master key or clear and re-enter the provider credential.
- **SPA route returns 404 behind a proxy:** forward both `/api/*` and all other paths to the same Docus port; the Docus production server owns the SPA fallback.
