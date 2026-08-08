# Configuration

Docus has two configuration surfaces: runtime environment variables for the server and Settings in the application for AI and metadata operations.

## Vault and Network

| Setting | Default | Purpose |
| --- | --- | --- |
| `VAULT_DIR` | `<working-directory>/src/content` | Markdown vault root; relative values resolve from the process working directory. |
| `HOST` | `127.0.0.1` in the production server | Listener address for `npm run start`. |
| `PORT` | `3000` | Listener port for `npm run start`. |
| `GIT_AUTHOR_NAME` | `docus` when the vault has no local identity | Author name for Docus-created versions. |
| `GIT_AUTHOR_EMAIL` | `docus@localhost` when the vault has no local identity | Author email for Docus-created versions. |

The Docker Compose deployment has separate host-side variables: `DOCUS_BIND_ADDRESS` and `DOCS_PORT`. See [Runtime Configuration](../deployment/configuration.md).

## AI Provider Settings

Configure these in Settings, not as provider environment variables:

- Provider: Anthropic or OpenAI.
- API key.
- Model.
- Optional HTTP(S) base URL.

Each provider keeps its own saved configuration in SQLite. The active provider determines which slot is used.

## AI Master Key

Provider credentials are encrypted before SQLite storage. The encryption master key is resolved in this order:

1. `DOCUS_MASTER_KEY`.
2. The file named by `DOCUS_MASTER_KEY_FILE`.
3. The auto-managed `data/.docus-master-key` file, created on the first API-key save.

An explicit key must encode exactly 32 bytes as either 64 hexadecimal characters or canonical base64. Do not store a real key in the repository.

Reading an empty AI configuration does not create the auto-managed file. If
SQLite contains provider credentials encrypted with that fallback key and
`data/.docus-master-key` is missing, Docus reports `master-key-required` and
leaves both the credentials and all other AI settings unchanged. It does not
create an unrelated replacement key. In fallback mode, back up and restore
`data/docus.db` and `data/.docus-master-key` together.

If the original key is permanently unavailable, explicitly forget the affected
provider credential in Settings before configuring a replacement. This is a
permanent, provider-scoped action; Docus never clears the credential during a
failed read.

See [Deployment Security](../deployment/security.md) and [Backup and Restore](../deployment/backup-and-restore.md) before changing an existing instance's key.
