# Icon Usage

Use icons by meaning, not by shape alone. The source file is the inventory; this page defines stable semantic distinctions so component changes do not make the documentation stale.

## Current surface mapping

| Surface | Primary vocabulary |
| --- | --- |
| Navigation bar | search, theme, edit/read, right-rail, and vault-scope icons |
| Activity bar | files, tags, Git history, and settings |
| File tree and context menu | folders, Markdown files, create, rename, delete, archive |
| Right rail | table of contents and document links |
| Editor/status bar | save and connectivity states |
| AI panel | AI identity, conversation actions, tool-specific icons, tool status |
| History timeline | Git/version and disclosure icons |

Exact call sites are best found with `rg 'ICON_<NAME>' src`; they can change more often than the semantic contract.

## Required distinctions

- `ICON_EDIT` means switching to edit mode; `ICON_RENAME` means renaming a file.
- `ICON_EYE` offers read mode. `ICON_READ` is a reserved book glyph and is not the navigation toggle.
- `ICON_HISTORY` is conversation/timeline history; `ICON_AB_GIT_HISTORY` is the vault Git-history activity.
- `ICON_DELETE` is a general file-tree action; `ICON_DELETE_FILE` is the compact AI tool glyph.
- `ICON_NEW_CHAT` starts a conversation; `ICON_AI_CONVERSATION` is a general conversation concept.
- `ICON_LINKS` represents the current document's backlinks/outgoing links; it does not promise a graph view.
- `ICON_TOC` represents the reading table of contents.
- `ICON_PANEL_RIGHT_OPEN` and `ICON_PANEL_RIGHT_CLOSE` represent panel state, not navigation direction.

## Status vocabulary

State must be distinguishable by glyph as well as color:

| State | Icon |
| --- | --- |
| Saved / successful | `ICON_STATUS_SUCCESS` |
| Modified / external change | `ICON_STATUS_MODIFIED` |
| Saving / pending | `ICON_STATUS_LOADING` |
| Error | `ICON_STATUS_ERROR` |
| Offline | `ICON_STATUS_OFFLINE` |
| Warning | `ICON_STATUS_WARNING` |

The component supplies the state label. Do not rely on color or an icon-only tooltip as the accessible name.

## AI tool mapping

The AI tool card maps tool names to compact glyphs:

| Tool | Icon |
| --- | --- |
| `read_file` | `ICON_READ_FILE` |
| `list_files` | `ICON_LIST_FILES` |
| `create_file` | `ICON_CREATE_FILE` |
| `write_file` | `ICON_WRITE_FILE` |
| `patch_file` | `ICON_PATCH_FILE` |
| `delete_file` | `ICON_DELETE_FILE` |
| `rename_file` | `ICON_RENAME_FILE` |

`update_metadata` currently falls back to the generic tool glyph. If a dedicated icon is added, update the tool map, tests, and this table together.

## Reserved vocabularies

Some exports describe coherent future controls or file types and have no current consumer. Treat them as design vocabulary, not user-facing feature documentation. Before using one, confirm that its existing metaphor still fits and add an accessible labeled control.

## Review checklist

- The icon conveys the same concept everywhere it appears.
- The control has a text label, `aria-label`, or equivalent accessible name.
- Decorative SVG remains `aria-hidden`.
- Hover, focus, active, disabled, and danger states come from the consuming component.
- Theme and status color flow through `currentColor` or CSS tokens.
- The icon contract tests pass, and no new repository-lint findings are introduced beyond the known brand-constellation classification issue in [Icon System](icon-system.md#known-lint-debt).

See [Icon System](icon-system.md) for geometry and exception rules.
