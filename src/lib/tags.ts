// Tag query model and shared tag index.
//
// Phase 1 of the tag-system plan. Pure module — no Vue, no fetch, no
// DOM. Both TagPanel and FileTree consume the same parse / match /
// normalize / index functions from here so the two sidebars cannot
// drift apart on tag semantics again.
//
// Design notes:
//   * Tag identity is `normalizeTag(raw)` — trim, drop a leading `#`,
//     lowercase. Two tag strings that normalize to the same value are
//     the same tag for matching purposes; the first display form
//     wins. Rationale: users routinely type `#Java` / `#java` /
//     `#JAVA` and expect them to collide. The display name is what
//     they see in the UI; the normalized form is what the index
//     keys on.
//   * The parser is intentionally simple in Phase 1 — `#tag` AND
//     tokens, `-#tag` exclude tokens, plain text for everything
//     else. `includeAny` (OR) is a typed field but always empty
//     until a Phase 4 UI exposes a mode toggle; this lets Phase 1
//     ship the predicate shape without committing to the parser's
//     full surface area.
//   * `matchesTagQuery` excludes take precedence over includeAll, so
//     `#a -#a` matches nothing (rather than everything).
//   * `buildTagIndex` is defensive about `tags === undefined` — the
//     server's rename and tree-builder paths can theoretically emit
//     `tags: undefined` for documents that exist in YAML but not in
//     the SQLite metadata table. We coerce to `[]` rather than
//     crash; the same guard propagates to Phase 2 batch operations.

/**
 * Canonical tag identity. Two tag strings that normalize to the same
 * value are the same tag for matching purposes. The index records the
 * first display form the index saw so the UI doesn't reflow on every
 * casing change.
 */
export interface TagRecord {
  /** Canonical identity key (trimmed, leading `#` stripped, lowercased). */
  normalizedName: string
  /** First-seen display form. Empty string is invalid; callers should drop. */
  displayName: string
  /** Number of distinct posts that carry this tag (post count, not occurrences). */
  count: number
}

/** Minimal document shape required for tag matching. Designed so it
 *  can be built from a `PostSummary` (path/title/tags/summary) without
 *  pulling in the full API surface. */
export interface SearchableDoc {
  path: string
  title: string
  tags: ReadonlyArray<string | undefined | null> | undefined | null
  summary?: string
}

/** Parsed tag query. `text` is matched against path/title/summary
 *  (case-insensitive substring). `includeAll` is AND (every tag must
 *  be present). `exclude` is NOT (any matching tag drops the doc).
 *  `includeAny` is OR (at least one tag must be present); reserved
 *  for a future Phase 4 UI toggle — currently always `[]`. */
export interface TagQuery {
  text: string
  includeAll: string[]
  includeAny: string[]
  exclude: string[]
}

/**
 * Reverse-lookup index over a `posts`-shaped list. Pure data — no
 * reactivity, no caching of the source. Callers re-build on `posts`
 * change and re-build cheaply because the index is O(n) over tag
 * count.
 */
export interface TagIndex {
  /** normalizedName → TagRecord */
  tags: Map<string, TagRecord>
  /** path → Set<normalizedTag> */
  documentTags: Map<string, Set<string>>
  /** normalizedTag → Set<path> */
  tagDocuments: Map<string, Set<string>>
}

/** Result of diffing a single document's tags against the index. Used
 *  by `updateDocumentTags` so callers can know exactly what changed
 *  without re-walking the index. */
export interface DocumentTagsDelta {
  added: string[]
  removed: string[]
}

/**
 * Canonical tag identity. Whitespace is trimmed and a single leading
 * `#` is stripped. The result is lowercased so `Java` / `java` /
 * `JAVA` collapse to the same key. Slashes, dashes, underscores and
 * Unicode (including CJK) are preserved. Empty results (input was
 * blank or `#`-only) return `""` — callers should drop these.
 */
export function normalizeTag(raw: string | undefined | null): string {
  if (raw == null) return ''
  // `.trim()` strips whitespace including the Unicode no-break space
  // and zero-width spaces we never want in a tag identity. We do NOT
  // do NFKC normalization here — that would rewrite `ﬁ` → `fi` etc.
  // and silently change user-authored tag names. Phase 5's hierarchy
  // support can revisit if a real user reports a duplicate-from-NFKC
  // case; for now, raw-codepoint preservation is the conservative
  // choice (no silent rename of user content).
  const trimmed = raw.trim()
  if (!trimmed) return ''
  // Strip at most one leading `#`. Multiple `##java` is preserved
  // verbatim so a user who actually names a tag `##java` doesn't
  // have it silently turned into `java`. The result is lowercased
  // so `Java` / `java` / `JAVA` collapse to the same key.
  const stripped = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed
  const out = stripped.toLowerCase()
  return out.trim() === '' ? '' : out
}

/**
 * Parse a free-text query into a structured `TagQuery`. Whitespace
 * separates tokens. Recognized token shapes:
 *   - `#xxx`     → push `xxx` into `includeAll`
 *   - `-#xxx`    → push `xxx` into `exclude`
 *   - anything else → accumulated into `text`
 *
 * Empty input and input consisting only of `#` / `-#` tokens
 * degenerate to `text === ''` plus whatever include/exclude tokens
 * were extracted.
 */
export function parseTagQuery(input: string): TagQuery {
  const includeAll: string[] = []
  const includeAny: string[] = []
  const exclude: string[] = []
  const textParts: string[] = []
  const seenAll = new Set<string>()
  const seenExclude = new Set<string>()

  // Split on whitespace; tolerate CRLF/LF/tabs. We intentionally do
  // NOT split on `|` — OR-mode is reserved for a future Phase 4 UI
  // toggle so the parser can stay stable across Phase 1.
  const tokens = input.split(/\s+/).filter(Boolean)
  for (const token of tokens) {
    if (token === '#' || token === '-#') continue
    if (token.startsWith('-#')) {
      const name = normalizeTag(token.slice(2))
      if (!name) continue
      if (!seenExclude.has(name)) {
        seenExclude.add(name)
        exclude.push(name)
      }
      continue
    }
    if (token.startsWith('#')) {
      const name = normalizeTag(token.slice(1))
      if (!name) continue
      if (!seenAll.has(name)) {
        seenAll.add(name)
        includeAll.push(name)
      }
      continue
    }
    textParts.push(token)
  }
  // Collapse multiple whitespace into single spaces in the text
  // channel so downstream substring checks are predictable.
  const text = textParts.join(' ').trim()
  return { text, includeAll, includeAny, exclude }
}

/**
 * Predicate: does `doc` satisfy `query`?
 *
 * Order of evaluation (short-circuits on first failure):
 *   1. Exclude: any excluded tag is present → false.
 *   2. Include-all: not every required tag is present → false.
 *   3. Include-any (currently unused): no listed tag is present → false.
 *   4. Text: empty text → skip; otherwise `path/title/summary` must
 *      contain the text (case-insensitive substring).
 *   5. Otherwise → true.
 *
 * An empty query (no text, no includes, no excludes) matches
 * everything.
 */
export function matchesTagQuery(doc: SearchableDoc, query: TagQuery): boolean {
  // Defensive: server-side producers can theoretically emit
  // `tags: undefined`; normalize to [] so the Set membership checks
  // never throw. The interface contract still requires `tags` to be
  // present, but a runtime-typed shape from JSON.parse may not honor
  // the contract.
  const docTags = (doc.tags ?? []) as ReadonlyArray<string>
  const docTagSet = new Set<string>()
  for (const t of docTags) {
    if (t == null) continue
    const n = normalizeTag(t)
    if (n) docTagSet.add(n)
  }

  if (query.exclude.length > 0) {
    for (const ex of query.exclude) {
      if (docTagSet.has(ex)) return false
    }
  }

  if (query.includeAll.length > 0) {
    for (const inc of query.includeAll) {
      if (!docTagSet.has(inc)) return false
    }
  }

  if (query.includeAny.length > 0) {
    let any = false
    for (const inc of query.includeAny) {
      if (docTagSet.has(inc)) {
        any = true
        break
      }
    }
    if (!any) return false
  }

  if (query.text) {
    const needle = query.text.toLocaleLowerCase()
    const hay = `${doc.path}\n${doc.title}\n${doc.summary ?? ''}`.toLocaleLowerCase()
    if (!hay.includes(needle)) return false
  }

  return true
}

/** Build a `TagIndex` from a posts-shaped array. Defensive about
 *  `tags === undefined`. Order of insertion determines which
 *  display form wins for a given normalized name (first-seen wins). */
export function buildTagIndex(
  posts: ReadonlyArray<{ path: string; tags?: ReadonlyArray<string | undefined | null> | undefined | null }>,
): TagIndex {
  const tags = new Map<string, TagRecord>()
  const documentTags = new Map<string, Set<string>>()
  const tagDocuments = new Map<string, Set<string>>()

  for (const post of posts) {
    const set = new Set<string>()
    const rawTags = post.tags ?? []
    for (const raw of rawTags) {
      if (raw == null) continue
      const n = normalizeTag(raw)
      if (!n) continue
      set.add(n)
      if (!tags.has(n)) {
        tags.set(n, { normalizedName: n, displayName: raw.trim(), count: 0 })
      }
    }
    documentTags.set(post.path, set)
    for (const n of set) {
      let paths = tagDocuments.get(n)
      if (!paths) {
        paths = new Set<string>()
        tagDocuments.set(n, paths)
      }
      paths.add(post.path)
    }
  }
  // Count distinct posts per tag (not occurrences; if the same tag
  // appears twice in one document it's still one post).
  for (const tag of tags.values()) {
    const paths = tagDocuments.get(tag.normalizedName)
    tag.count = paths ? paths.size : 0
  }
  return { tags, documentTags, tagDocuments }
}

/**
 * Diff a single document's tag set and return a new `TagIndex` with
 * the change applied. The input index is NOT mutated; the new index
 * shares as much structure as possible (other documents' Sets are
 * reused by reference). Useful for batch tag operations in Phase 2.
 *
 * Also returns the `DocumentTagsDelta` so callers can emit change
 * events without re-walking the new index.
 */
export function updateDocumentTags(
  index: TagIndex,
  path: string,
  oldTags: ReadonlyArray<string | undefined | null> | undefined | null,
  newTags: ReadonlyArray<string | undefined | null> | undefined | null,
): { index: TagIndex; delta: DocumentTagsDelta } {
  const oldNorm = new Set<string>()
  for (const t of oldTags ?? []) {
    if (t == null) continue
    const n = normalizeTag(t)
    if (n) oldNorm.add(n)
  }
  const newNorm = new Set<string>()
  for (const t of newTags ?? []) {
    if (t == null) continue
    const n = normalizeTag(t)
    if (n) newNorm.add(n)
  }
  const added: string[] = []
  const removed: string[] = []
  for (const n of newNorm) if (!oldNorm.has(n)) added.push(n)
  for (const n of oldNorm) if (!newNorm.has(n)) removed.push(n)

  // Build new maps. We clone only the structures that change; every
  // other document's entry is reused by reference so the common case
  // (one document changing) is cheap.
  const tags = new Map(index.tags)
  const documentTags = new Map(index.documentTags)
  const tagDocuments = new Map(index.tagDocuments)

  documentTags.set(path, newNorm)

  for (const n of removed) {
    const paths = tagDocuments.get(n)
    if (!paths) continue
    const nextPaths = new Set(paths)
    nextPaths.delete(path)
    if (nextPaths.size === 0) {
      tagDocuments.delete(n)
      tags.delete(n)
    } else {
      tagDocuments.set(n, nextPaths)
      const rec = tags.get(n)
      if (rec) tags.set(n, { ...rec, count: nextPaths.size })
    }
  }
  for (const n of added) {
    const existing = tagDocuments.get(n)
    const nextPaths = existing ? new Set(existing) : new Set<string>()
    nextPaths.add(path)
    tagDocuments.set(n, nextPaths)
    if (!tags.has(n)) {
      // First time we see this tag — pick a display form. Prefer the
      // first-seen raw tag string from `newTags`.
      const firstRaw = (newTags ?? []).find((t) => t != null && normalizeTag(t) === n)
      tags.set(n, {
        normalizedName: n,
        displayName: (firstRaw ?? n).trim(),
        count: nextPaths.size,
      })
    } else {
      const rec = tags.get(n)
      if (rec) tags.set(n, { ...rec, count: nextPaths.size })
    }
  }

  return { index: { tags, documentTags, tagDocuments }, delta: { added, removed } }
}

/**
 * Stable sort: posts first by descending tag count, then by display
 * name ascending. Pure function — no index mutation, safe to call
 * inside a `computed`.
 */
export function sortTagsByCountDescThenName(
  records: ReadonlyArray<TagRecord>,
): TagRecord[] {
  return [...records].sort(
    (a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName),
  )
}