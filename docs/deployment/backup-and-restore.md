# Backup and Restore

Docus server persistence spans the vault, the data directory, and any externally managed master key. Browser drafts are a separate local recovery layer and cannot be captured by a normal server backup.

| Data | Default location | Backup requirement |
| --- | --- | --- |
| Markdown notes | `src/content/**/*.md` | Required. |
| Vault versions and identity | `src/content/.git/`, `src/content/.docus/`, vault dotfiles | Required if History must survive. |
| SQLite metadata and AI data | `data/docus.db` plus active WAL/SHM files | Required for titles, summaries, tags, document IDs, migration records, AI settings, encrypted credentials, sessions, and messages. |
| AI master key | `data/.docus-master-key` or an external environment/secret file | Required to decrypt stored AI credentials. |
| Unsaved drafts | Browser IndexedDB `docus-draft-recovery` | Browser-local; not included in server or Docker backups. |

A complete server backup includes the full vault, the full data directory, and the master key when it is managed outside `data/`.

In fallback mode, `data/docus.db` and `data/.docus-master-key` are a recovery
pair and must be backed up and restored together. Restoring only SQLite leaves
AI credentials encrypted with that fallback key unreadable. Docus reports
`master-key-required`; it does not create a replacement key, rewrite the
ciphertext, or change other AI settings.

## Consistency Rule

Stop Docus before copying `data/` and the vault. This closes SQLite cleanly and prevents a document mutation from spanning the two backup copies.

If zero-downtime backups are required, use a filesystem snapshot that covers both stores at the same point in time and a SQLite-aware backup process. A plain live copy of only `docus.db` can miss data still in the WAL.

## Docker Backup

From the repository directory:

```bash
docker compose stop docus
mkdir -p backups/data backups/vault
docker cp docus:/app/data/. backups/data/
rsync -a src/content/ backups/vault/
docker compose start docus
```

On systems without `rsync`, use an archive tool that includes hidden files. Confirm that `backups/vault/.git/` and `backups/vault/.docus/` exist when those features have been initialized.

The `backups/data/` copy includes the auto-managed master key. If `DOCUS_MASTER_KEY` or `DOCUS_MASTER_KEY_FILE` is used instead, back up that secret separately in a protected secret store.

## Bare-Metal Backup

Stop the service manager, then copy both configured locations recursively:

```bash
rsync -a /path/to/vault/ /path/to/backup/vault/
rsync -a /path/to/docus/data/ /path/to/backup/data/
```

Store the external master key separately if it is not under `data/`.

## Restore Order

1. Stop Docus.
2. Restore the complete vault, including hidden `.git/` and `.docus/` content.
3. Restore the complete `data/` directory or Docker volume contents, not only `docus.db`.
4. Restore the same external master key configuration used when the AI credentials were encrypted.
5. Ensure the runtime user can read and write the restored paths.
6. Start Docus and inspect startup logs.
7. Verify `/api/health`, open representative notes, check tags and properties, inspect History, and test AI settings without replacing the key.

For Docker, one restore method that preserves the existing named volume is:

```bash
docker compose stop docus
docker compose run --rm --no-deps -v "$PWD/backups/data:/restore:ro" docus \
  sh -c 'find /app/data -mindepth 1 -delete && cp -a /restore/. /app/data/'
rsync -a --delete backups/vault/ src/content/
docker compose up -d
```

The `--delete` flag makes the restored vault match the backup and removes newer files, so review both paths carefully before running it. Restore to a separate test directory first when the backup has not been verified recently.

## Partial Restore Consequences

- Markdown without SQLite retains note bodies but loses current database-owned titles, summaries, tags, stable IDs, AI settings, and conversations. Startup will reconstruct fallback metadata, not the missing application state.
- SQLite without the matching vault contains metadata identities for missing files and is not a useful document restore.
- SQLite without the matching master key preserves encrypted credentials but cannot decrypt them. Restore the original key. If the credentials are intentionally abandoned, the old credential rows must be explicitly cleared before reconfiguration; Docus does not clear or replace them during the failed read.
- Vault files without `.git/` lose History even though current Markdown remains.
- Clearing browser storage loses unsaved recovery drafts but does not delete server-saved notes.
