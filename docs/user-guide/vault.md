# Vault and Archive Protocol

## Vault Layout

A vault is a directory of Markdown files. By default it is `src/content/`; production deployments can use `VAULT_DIR`, and Docker mounts the host's `./src/content` at `/app/src/content`.

Docus requires portable, URL-safe logical paths: every folder and file-name segment uses lowercase ASCII letters, digits, and internal hyphens. The `.md` suffix is stored on disk but omitted from Docus paths and URLs. Display titles may use any language because they live in document metadata.

## Protected Roots

The three top-level folders are part of the product protocol:

- `inbox/` for new and unfinished notes.
- `literature/` for source-oriented reading notes.
- `archive/` for settled notes.

Their names cannot be changed, deleted, or moved. Missing roots are created automatically by the production server; source-development users must create them before the first dev run.

## Archive Rules

Archive is deliberately stricter than an ordinary folder:

- Notes cannot be created directly in `archive/`.
- A note under `inbox/` or `literature/` enters through the explicit Archive action or an allowed move into an archive subfolder.
- Archived notes cannot be renamed, deleted, or moved back out.
- Existing archived items may move between archive subfolders for organization.
- Archive subfolders may be created.

The Vue interface and server both enforce the rules. Direct filesystem edits remain possible because the vault is ordinary files; Docus reconciles the resulting view on later reads but cannot impose UI rules on an external editor.

## File Operations

The file tree supports create, rename, move, recursive folder deletion, document properties, link-aware renames, and archive actions. Before a rename, Docus can update incoming Wiki and Markdown references. Mutations are serialized against editor saves, History actions, and other lifecycle work; a conflicting operation is rejected instead of silently overwriting another writer.

See [Document Lifecycle Architecture](../architecture/document-lifecycle.md) for the implementation guarantees.
