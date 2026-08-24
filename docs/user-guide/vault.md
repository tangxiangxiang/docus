# Vault and Archive Protocol

## Vault Layout

A vault is a directory of Markdown files. By default it is `src/content/`; production deployments can use `VAULT_DIR`, and Docker mounts the host's `./src/content` at `/app/src/content`.

Docus requires portable, URL-safe logical paths: every folder and file-name segment uses lowercase ASCII letters, digits, and internal hyphens. The `.md` suffix is stored on disk but omitted from Docus paths and URLs. Display titles may use any language because they live in document metadata.

## Protected Roots

The three top-level folders are part of the product protocol:

- `inbox/` for new and unfinished notes.
- `literature/` for source-oriented reading notes.
- `archive/` for settled notes.

The roots themselves cannot be renamed, deleted, or moved. Missing roots are created automatically by the production server; source-development users must create them before the first dev run.

## Archive Rules

`archive/` is a recommended organizational area for inactive content, not an immutable or compliance archive:

- The top-level `archive` directory is reserved by Docus so the built-in Archive action has a stable destination.
- `archive/` descendants follow the same file and folder operations available to ordinary Docus content.
- Files can be created, edited, renamed, deleted, and moved within or out of the archive.
- Folders can be created, renamed, and deleted normally. General folder re-parenting is not currently a Docus capability.
- Content from any otherwise-legal location can be moved into `archive/`.
- The built-in Archive action remains a convenience workflow and defaults to `archive/<filename>`, with its existing collision suffix handling.

The UI and server protect only the reserved root names. Filesystem confinement, path validation, authentication, lifecycle coordination, history, and recovery guarantees are unchanged.

## File Operations

The file tree supports create, rename, move, recursive folder deletion, document properties, link-aware renames, and archive actions. Before a rename, Docus can update incoming Wiki and Markdown references. Mutations are serialized against editor saves, History actions, and other lifecycle work; a conflicting operation is rejected instead of silently overwriting another writer.

See [Document Lifecycle Architecture](../architecture/document-lifecycle.md) for the implementation guarantees.
