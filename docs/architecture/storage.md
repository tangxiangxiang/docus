# Storage Architecture

Docus deliberately separates human-owned Markdown, application metadata, browser recovery data, and version history.

## Vault files

The default vault is `src/content/`; `VAULT_DIR` can point the server elsewhere. It contains the required top-level roots `inbox/`, `literature/`, and `archive/` plus a small amount of Docus-managed repository metadata.

Vault paths are validated before use. Folder and file path segments use lowercase ASCII kebab-case; display titles may use any language.

## SQLite

The server opens `data/docus.db` and applies migrations from `server/migrations/`. SQLite uses write-ahead logging. It stores:

- stable document identities and metadata such as title, summary, and tags;
- metadata-migration backup records;
- AI provider settings, sessions, and messages.

SQLite is not the source of Markdown bodies. Removing the database does not remove the vault, but it does lose application metadata and AI history. Restoring only the database without the matching vault can leave stale document records.

## Vault Git repository

History uses a Git repository inside the configured vault, not the Git repository containing Docus source code. Docus initializes it lazily and creates `.docus/vault-id` so its own version commits can be recognized.

The vault Git repository records Markdown history. It does not replace a backup: filesystem loss, a damaged `.git`, or deletion of the entire volume can still destroy history.

## Browser storage

Unsaved draft recovery uses IndexedDB database `docus-draft-recovery`. Draft identities combine the vault ID and stable document ID so a rename does not orphan a draft.

Draft storage is deliberately bounded:

- maximum 2 MiB for one draft;
- maximum 100 records per vault;
- maximum 20 MiB per vault.

The data is local to one browser profile. Clearing site data, changing browsers, or using another device does not transfer it.

## Operational consequence

A complete backup includes both:

1. the configured vault directory, including hidden files and its `.git`; and
2. the `data/` directory, including the database and master-key file if present.

See [Backup and Restore](../deployment/backup-and-restore.md) for procedures.

