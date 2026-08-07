# Editor and Draft Recovery

## Editing

Docus uses Monaco for Markdown source editing and a separate Read mode for rendered output. There is no split Preview mode. Use the navigation-bar toggle to switch modes.

Each open document has its own workspace tab and unsaved buffer. Useful shortcuts include:

| Action | Shortcut |
| --- | --- |
| Save now | `Ctrl+S` / `Command+S` |
| Close active tab | `Ctrl+W` / `Command+W` |
| Open command palette | `Ctrl+P` / `Command+P` |
| Toggle Files panel | `Ctrl+B` / `Command+B` |

Edits are marked dirty immediately and are saved after 800 ms without another keystroke. If more typing occurs while a request is in flight, Docus acknowledges that revision and then saves the newer one.

## External Changes and Conflicts

Every save sends both the intended content and the last content read from disk. If another application changed the file, the server returns the current disk version instead of overwriting it. The editor enters an external-change state so you can choose which content to keep.

Closing, renaming, moving, deleting, restoring, or versioning a document first establishes a mutation barrier. Pending saves are settled or paused before the lifecycle operation proceeds.

## Browser Draft Recovery

Unsaved buffers are also persisted to IndexedDB under the database `docus-draft-recovery`. Draft identity combines the current vault and the stable document ID, so a rename can move the draft with the document instead of treating it as a new note.

After a reload or crash, Recovery compares the draft with the current disk state:

- If the disk still matches the draft's saved baseline, the draft can be restored into the editor.
- If the disk changed, Recovery preserves both versions for review.
- If the document moved or was deleted, Docus uses stable identity and conflict records rather than guessing a path.

Draft recovery is browser-local. It is not stored in SQLite, Git, or the Docker data volume. A different browser or cleared site data cannot recover it. Individual drafts are limited to 2 MiB; cleanup limits a vault to 100 recovery records or 20 MiB of recovery content.

For server-side interruption recovery, see [Crash Recovery Architecture](../architecture/crash-recovery.md).
