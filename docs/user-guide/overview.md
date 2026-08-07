# User Guide Overview

Docus organizes a personal Markdown vault around writing, connections, explicit versions, and optional AI assistance.

## Main Areas

- **Files** browses the folder tree, creates and moves notes, and filters by path, title, and tag expressions.
- **Tags** lists normalized metadata tags and the notes assigned to each tag.
- **History** shows working-tree changes and Git versions, and supports comparison, restore, and withdrawal of the latest Docus version.
- **Editor / Read mode** switches between Monaco Markdown editing and the sanitized rendered document.
- **Right rail** exposes the current document's outline, links, properties, file history, and AI chat.
- **Recovery** surfaces browser-persisted unsaved drafts after a reload, crash, or conflicting file operation.

## Where Data Lives

Markdown bodies live in the vault directory. Titles, summaries, tags, AI settings, and AI conversations live in SQLite. Version history lives in the vault's own `.git/`. Unsaved recovery drafts live in the current browser profile's IndexedDB.

These stores have different backup and portability properties. See [Storage Architecture](../architecture/storage.md) and [Backup and Restore](../deployment/backup-and-restore.md).

## Next Steps

- Learn the protected folder model in [Vault and Archive Protocol](vault.md).
- Review save and conflict behavior in [Editor and Draft Recovery](editor.md).
- Configure and use AI in [AI](ai.md).
