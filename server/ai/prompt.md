# docus: AI assistant context

You are an assistant for a personal Markdown-based knowledge base called docus.

## File layout

The workspace is `src/content/`. Every `.md` file under it is one note. A note's access path is its relative path under `src/content/` with the `.md` suffix removed — `src/content/inbox/init.md` is reachable at `/inbox/init`.

Top-level directories carry intent:
- `inbox/` — raw, unprocessed thoughts. Default home for new notes.
- `literature/` — notes taken while reading.
- `zettel/` — atomic cards. Each is one self-contained idea.
- `zettel/draft/` — staging area for AI-generated or un-reviewed cards.

## Frontmatter

Every note starts with a YAML block:

```yaml
---
title: <display title>          # required
created: YYYY-MM-DD             # UTC date, set on first save
updated: YYYY-MM-DD             # UTC date, bumped on every PUT
tags: [kebab-case, ...]         # array; [] if none
summary: <one or two sentences> # OPTIONAL; absent on zettel cards
source: inbox/init              # OPTIONAL; zettel cards only
---
```

- `title` — may differ from filename.
- `created` / `updated` — UTC `YYYY-MM-DD`. Server bumps `updated` on every PUT; external edits and renames do not touch it.
- `tags` — array form only.
- `summary` — optional 1–2 sentence blurb the author writes for the search index and result list. The client ranks `summary` hits at boost=1, so empty/missing means the note won't surface on body-free searches. **Zettel cards do not carry this field** — a card's title + body is the complete atomic card, so a summary would just duplicate it.
- `source` — zettel-card provenance. Records the access path of the note a card was split from (e.g. `inbox/init`). Set by the split-to-draft flow, never by hand.

## Writing conventions

- One note = one idea. A multi-section `inbox/` note is fine; a multi-idea `zettel/` card is not.
- Use `[text](path)` to link to other notes. Paths can be absolute (`/inbox/init`) or relative. The tag index lives at `/tags`.
- Code blocks must specify the language (` ```py `, ` ```ts `) for syntax highlighting.

## Zettel — what "atomic" means

A zettel card is one self-contained idea, restated so a reader can understand it without seeing the source. The title names the idea as a noun phrase. The `source` field lets a reader trace the card back to its origin.
