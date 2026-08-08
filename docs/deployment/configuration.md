# Runtime Configuration

Copy `.env.example` to `.env` only when an override is needed. `.env` files are excluded from both Git and the Docker build context.

## Bare-Metal Server

| Variable | Default | Notes |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Set an explicit interface only when remote exposure is intentional. |
| `PORT` | `3000` | HTTP port for `npm run start`. |
| `VAULT_DIR` | `<cwd>/src/content` | Absolute or working-directory-relative vault path. |
| `GIT_AUTHOR_NAME` | `docus` if the vault lacks `user.name` | Existing vault-local Git configuration is preserved. |
| `GIT_AUTHOR_EMAIL` | `docus@localhost` if the vault lacks `user.email` | Existing vault-local Git configuration is preserved. |

## Docker Compose Host Mapping

| Variable | Default | Notes |
| --- | --- | --- |
| `DOCUS_BIND_ADDRESS` | `127.0.0.1` | Host interface used by the Compose `ports` mapping. |
| `DOCS_PORT` | `3000` | Host port mapped to container port 3000. |

Compose sets the container's `HOST=0.0.0.0` and `PORT=3000`. Do not use those container values to infer host exposure; the `ports` mapping is the boundary that defaults to loopback.

The supplied Compose file does not expose `VAULT_DIR` because it always mounts the vault at the default `/app/src/content`. Change the volume mapping, not the in-container path, unless you also update the service configuration coherently.

## AI Master Key

| Variable | Default | Notes |
| --- | --- | --- |
| `DOCUS_MASTER_KEY` | none | 32 bytes encoded as 64 hex characters or canonical base64. Highest precedence. |
| `DOCUS_MASTER_KEY_FILE` | none | Path to a readable file containing the same encoded key. |

If neither is set, Docus creates `data/.docus-master-key` on the first API-key save with restrictive file permissions. The key is outside SQLite but, in Docker, inside the same persistent `docus-data` volume.

That automatic creation applies only to first setup and recoverable legacy
migrations. If credentials encrypted with the fallback key already exist and
the fallback file is missing, Docus returns `master-key-required` without
creating a new file or changing any AI setting. Restore the original fallback
file or provide the matching key through an explicit source. An explicitly
configured but unreadable `DOCUS_MASTER_KEY_FILE` is an error and never falls
back to the auto-managed path.

Changing the master-key source does not re-encrypt existing credentials automatically to an unrelated key. Preserve the original key until all stored provider credentials have been cleared or successfully read and re-saved.

If the original master key is permanently lost, the encrypted credential is
not recoverable. Use the Settings recovery action to explicitly forget one
provider credential at a time; this does not decrypt, rewrite, or delete the
other provider's row, and it never deletes `data/.docus-master-key`. After the
unrecoverable rows have been explicitly cleared, save a new API key to create
and use a new fallback key. The forget action is permanent.

## AI Provider Configuration

Provider, API key, model, and base URL belong in the Settings UI and SQLite. The current server does not read `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_BASE_URL`, or OpenAI equivalents from the environment.

For OpenAI-compatible providers, configure the API root, for example
`https://api.openai.com/v1` or `https://gateway.example/openai/v1`. Do not enter
`/chat/completions`; the server uses streaming Chat Completions and appends that
path. Full workspace chat also requires function/tool calling support. A
provider that only supports plain text may reject Docus requests; Docus keeps
the failure visible rather than silently dropping tools or changing workspace
mutation semantics.
