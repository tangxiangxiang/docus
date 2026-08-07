# Document Lifecycle

Document creation, rename, move, and deletion are server-owned transactions. They coordinate the filesystem, stable document identity, SQLite metadata, open editor state, recovery drafts, link references, and history operations.

## Stable identity

A document's path can change while its metadata and draft identity remain associated with it. Docus assigns a stable document ID and stores the current path in SQLite. Lifecycle operations update this mapping as part of the mutation.

## Mutation flow

1. Validate the requested path and archive policy.
2. Acquire the relevant document or folder coordination barrier.
3. Flush or block conflicting saves where the operation requires it.
4. Prepare durable filesystem and metadata work.
5. Commit the mutation and any reference rewrites.
6. Update client state using the server result.

Folder moves use a durable journal because one folder can contain many documents and metadata identities. Recovery validates that a journal still owns the paths it describes before replaying or rolling it back.

## Reference updates

Rename and move operations can rewrite supported Wiki and Markdown links that point to the moved document. Reference rewriting is journaled so a process interruption does not leave it half-applied without a recovery record.

## Archive constraints

The shared archive protocol is enforced on both client and server:

- `inbox`, `literature`, and `archive` are immutable top-level roots;
- notes are created in `inbox` or `literature`, not directly in `archive`;
- active notes can move into `archive`;
- archived notes can move within `archive` but cannot be renamed, deleted, or moved back out;
- folders may be created inside `archive`.

The server remains authoritative even if a client bypasses the interface.

## Failure behavior

Lifecycle code fails closed when ownership, source identity, or the current disk state is ambiguous. Startup recovery runs before the server begins accepting normal requests. See [Crash Recovery](crash-recovery.md).

