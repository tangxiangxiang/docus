# Document metadata migration

## Ownership

All document metadata will move to SQLite. Markdown files will eventually contain body content only.

| Field | Legacy source | Database target | Notes |
| --- | --- | --- | --- |
| `title` | Frontmatter, then first H1, then filename | `documents.title` | Required; fallback generated during import |
| `summary` | Frontmatter | `documents.summary` | Empty string when absent; future RAG metadata |
| `tags` | Frontmatter string array | `tags` + `document_tags` | Trimmed and case-insensitively deduplicated |
| `aliases` | Frontmatter, not yet consistently consumed | `document_aliases` | Used by Wiki Link resolution later |
| `created` / legacy `date` | Frontmatter | `documents.created_at` | Converted to Unix milliseconds |
| `updated` | Frontmatter, then file mtime | `documents.updated_at` | Content and metadata updates refresh this value |

## Existing consumers

- `server/tree.ts`: title, summary, tags, created, updated.
- `server/index.ts`: create, read, save, move and delete lifecycle.
- `server/linkIndex.ts`: display title and Wiki Link index.
- `server/ai/tools.ts`: exposes parsed Frontmatter to AI tools.
- `src/composables/vault/useEditorTabs.ts`: tab title and raw save flow.
- `src/composables/vault/useMarkdownRender.ts`: title injection before rendering.
- FileTree, TagPanel and search: consume `PostSummary` metadata.

## Rollout rule

1. Database schema and repository exist without changing reads.
2. Compatibility reads use database first and Frontmatter as fallback.
3. New writes target the database while legacy files remain readable.
4. Import records progress in `metadata_migrations`.
5. Frontmatter is removed only after imported data is verified.
6. Export can reconstruct standard Frontmatter from database metadata.

No cleanup step may run for a document whose migration status is not `verified`.

## Implementation status

- [x] SQLite schema and metadata repository.
- [x] Database-first tree, post-detail and link-index reads with legacy fallback.
- [x] Body-only creation and database-backed save timestamps.
- [x] Metadata-safe file and folder move/delete lifecycle with filesystem compensation.
- [x] AI file tools and split-card writes use the same metadata lifecycle.
- [x] Vault-wide import with `metadata_migrations` progress and verification.
- [x] Document metadata editor for title, summary, tags and aliases.
- [x] Exact legacy Frontmatter backup, canonical export and cleanup preview.
- [x] Confirmed Frontmatter cleanup with per-file hash checks and compensation.
- [x] Exact original or canonical Frontmatter restore.
- [x] Lossless original Frontmatter export.
