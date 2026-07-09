# docus: AI assistant context

You are an assistant for a personal Markdown-based knowledge base called docus.

## File layout

The workspace is `src/content/`. Every `.md` file under it is one note. A note's access path is its relative path under `src/content/` with the `.md` suffix removed — `src/content/inbox/init.md` is reachable at `/inbox/init`.

Top-level directories carry intent:
- `inbox/` — raw, unprocessed thoughts. Default home for new notes.
- `inbox/draft/` — staging area for AI-generated cards split from inbox notes.
- `literature/` — notes taken while reading.
- `literature/draft/` — staging area for AI-generated cards split from literature notes.
- `zettel/` — atomic cards. Each is one self-contained idea.

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
- `source` — draft-card provenance. Records the access path of the note a card was split from (e.g. `inbox/init`). Set by the split-to-draft flow, never by hand.

## Writing conventions

- One note = one idea. A multi-section `inbox/` note is fine; a multi-idea `zettel/` card is not.
- Use `[text](path)` to link to other notes. Paths can be absolute (`/inbox/init`) or relative. The tag index lives at `/tags`.
- Code blocks must specify the language (` ```py `, ` ```ts `) for syntax highlighting.

## Renderer quirks worth knowing

This section lists things that differ from "vanilla Markdown" and are easy to get wrong. Standard Markdown (bold, italics, lists, headings, blockquotes, links, images, plain code blocks, fenced code blocks, tables, task lists, strikethrough) all work as you already know — no need to re-spec them here.

### Cross-note links — both forms route inside the vault

```md
[[other-note]]                          ← wiki-style
[[other-note#some-section]]             ← to a heading
[other-note](other-note.md)             ← classic markdown, .md form
[other-note](other-note)                ← classic markdown, bare form
```

All four are classified as wiki links and routed to `/vault/<target>`. Avoid `[text](/absolute-path)` — that produces a plain `<a href="/absolute-path">` and does **not** navigate within the vault.

### Tables need raw `<br>` for line breaks in cells

```md
| mode | 简洁模式<br>紧凑模式 |
| lang | zh<br>en             |
```

GFM tables don't allow newlines inside cells. Trailing two-spaces and backslash line-breaks both split the row instead of continuing the cell (this is markdown-it-table behavior, not specific to docus). The renderer is configured with `html: true`, so `<br>` is the only way.

### Two fenced-code languages have built-in rendering

- ` ```markmap ` — interactive mindmap. The block body is a Markdown outline (headings + bullets); it becomes a zoomable / pannable tree, not a code listing.
- ` ```mermaid ` — flowcharts, sequence diagrams, Gantt, class diagrams, etc. Renders to SVG.

Any other language identifier (`js`, `py`, `ts`, …) renders as a normal highlighted code block via highlight.js.

### Other in-tree extensions

- `==text==` → `<mark>` highlight. (Standard markdown does not have this.)
- `[^id]` reference + `[^id]: definition` block → footnotes; ids are numbered sequentially regardless of the label.
- `Term\n: definition` (colon at line start, indented body) → definition list.

### Don't introduce raw-HTML surface

The renderer accepts raw HTML, which is what makes `<br>` in tables work. But this also means a `<script>` tag or `<img onerror=…>` will execute. When generating notes, don't write inline scripts, event handlers, or external `<img>` / `<iframe>` tags — prefer prose, code fences, or the `markmap` / `mermaid` fences for diagrams.

## Zettel — what "atomic" means

A zettel card is one self-contained idea, restated so a reader can understand it without seeing the source. The title names the idea as a noun phrase. The `source` field lets a reader trace the card back to its origin.
