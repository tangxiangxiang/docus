// In-memory link index. Single source of truth for "which notes link
// to which". Built lazily on the first GET request, kept fresh by the
// write routes (PUT/POST/PATCH/DELETE on /api/posts/* and /api/folders/*).
//
// Storage shape:
//   forward: Map<sourcePath, Link[]>  — every resolved outbound link
//   paths:   Set<allKnownPaths>        — existence check
//
// We store only the forward map and compute the reverse map on demand.
// Backlinks are the hot read path, but the scan is O(forward.size) and
// the size is bounded by file count — for a dev tool with N < 10k
// notes this is fine. The simpler mutation logic (only forward is
// touched) is worth the trade.
//
// Stale-while-rebuild: failures in the index update are best-effort
// and don't fail the HTTP response. If a write succeeds on disk but
// the index update is skipped, the next cold rebuild (on process
// restart) repairs the index. There is no admin endpoint to force a
// rebuild in v1; the lazy `getIndex()` on first request handles it.

import { promises as fs } from 'node:fs'
import matter from 'gray-matter'
import { listPostsFlat } from './tree.js'
import { CONTENT_DIR, filePathFor } from './paths.js'
import { resolveWikiTarget } from './linkResolve.ts'

export interface Link {
  /** Resolved vault path (no .md extension, no #anchor). */
  target: string
  /** Display text: the alias for `[[x|alias]]`, the link text for `[t](x.md)`. */
  alias?: string
  /** Optional `#heading` suffix. */
  anchor?: string
  /** Which syntax produced this link. */
  kind: 'wiki' | 'md'
}

export interface BacklinkRecord {
  source: string
  alias?: string
  anchor?: string
  kind: 'wiki' | 'md'
}

export interface LinkIndexSnapshot {
  /** Every known vault path (no .md). */
  paths: string[]
  /** source -> outbound links */
  outgoing: Record<string, Link[]>
  /** path -> display title (frontmatter.title -> first H1 -> filename). */
  titles: Record<string, string>
}

// ---------- extraction ----------

// Wiki link: [[ref]] / [[ref#anchor]] / [[ref|alias]] / [[ref#anchor|alias]]
// `ref` and `anchor` disallow brackets/newlines/pipes (anchor never
// contains pipes; ref might, but then the regex would have to balance
// brackets which we don't bother with for v1).
const WIKI_LINK_RE = /\[\[([^\[\]\n|]+?)(?:#([^\[\]\n|]+?))?(?:\|([^\[\]\n]+?))?\]\]/g

// Standard markdown link: [text](href) with optional "title".
// We don't care about the title for the index; it's stripped later.
const MD_LINK_RE = /\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g

/** Strip a leading YAML frontmatter block. Mirrors src/lib/frontmatter.ts
 *  so the server module doesn't pull in a YAML dep just to slice text. */
function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
}

/** Replace fenced / inline code blocks with empty content so link
 *  regexes don't match inside them. This is a crude approach (it
 *  doesn't preserve line numbers) but the extractor doesn't need
 *  line numbers, only the text content. */
function stripCode(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, '')   // ``` fenced
    .replace(/~~~[\s\S]*?~~~/g, '')   // ~~~ fenced
    .replace(/`[^`\n]+`/g, '')        // inline code
}

function nameFromPath(path: string): string {
  return path.split('/').pop() || path
}

function titleFromRaw(path: string, raw: string): string {
  try {
    const parsed = matter(raw)
    const fmTitle = parsed.data.title
    if (typeof fmTitle === 'string' && fmTitle.trim()) return fmTitle.trim()
    const h1 = /^#\s+(.+)$/m.exec(parsed.content)
    if (h1?.[1]?.trim()) return h1[1].trim()
  } catch {
    const h1 = /^#\s+(.+)$/m.exec(stripFrontmatter(raw))
    if (h1?.[1]?.trim()) return h1[1].trim()
  }
  return nameFromPath(path)
}

function isExternalHref(href: string): boolean {
  // Anything with a scheme (http:, https:, mailto:, ftp:, data:, …) or a
  // protocol-relative `//` or a root-absolute `/` is external/non-vault.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return true
  if (href.startsWith('//')) return true
  if (href.startsWith('/')) return true
  return false
}

/** Extract every inter-note link from a raw .md source. The `sourcePath`
 *  is needed for same-dir resolution; `allPaths` is the set of known
 *  vault paths used by the resolver. Broken links (target not in
 *  `allPaths`) are silently dropped — the renderer uses `hasPath` to
 *  mark them as missing in the UI.
 *
 *  Duplicates (same target + anchor, regardless of syntax or alias)
 *  are collapsed to the first occurrence, in document order. The
 *  LinksPanel and the wiki-link renderer should never show the same
 *  destination twice from the same source file — that's almost
 *  always an authoring slip, not an intentional annotation. */
export function extractLinks(
  raw: string,
  sourcePath: string,
  allPaths: string[],
): Link[] {
  const body = stripCode(stripFrontmatter(raw))
  const out: Link[] = []
  const seen = new Set<string>()

  // Wiki links
  for (const m of body.matchAll(WIKI_LINK_RE)) {
    const ref = m[1]
    if (!ref) continue
    const anchor = m[2]?.trim() || undefined
    const alias = m[3]?.trim() || undefined
    const resolved = resolveWikiTarget(ref, sourcePath, allPaths)
    if (!resolved) continue
    const key = resolved + '\0' + (anchor ?? '')
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ target: resolved, alias, anchor, kind: 'wiki' })
  }

  // Standard markdown links — only vault-internal ones count.
  for (const m of body.matchAll(MD_LINK_RE)) {
    const text = m[1]?.trim() || undefined
    const href = m[2]
    if (!href || isExternalHref(href)) continue
    // Split off the fragment for the anchor; query strings are dropped
    // (we don't model them).
    const hashIdx = href.indexOf('#')
    const pathPart = hashIdx === -1 ? href : href.slice(0, hashIdx)
    const anchor = hashIdx === -1 ? undefined : href.slice(hashIdx + 1) || undefined
    const queryIdx = pathPart.indexOf('?')
    const cleanPath = queryIdx === -1 ? pathPart : pathPart.slice(0, queryIdx)
    if (!cleanPath) continue
    const resolved = resolveWikiTarget(cleanPath, sourcePath, allPaths)
    if (!resolved) continue
    const key = resolved + '\0' + (anchor ?? '')
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ target: resolved, alias: text, anchor, kind: 'md' })
  }

  return out
}

// ---------- index ----------

export class LinkIndex {
  private forward = new Map<string, Link[]>()
  private paths = new Set<string>()
  private titles = new Map<string, string>()

  /** Full rebuild from disk. Reads every .md file in `rootDir`. */
  async rebuild(rootDir: string = CONTENT_DIR): Promise<void> {
    this.forward.clear()
    this.paths.clear()
    this.titles.clear()
    const posts = await listPostsFlat(rootDir)
    for (const p of posts) {
      this.paths.add(p.path)
      this.titles.set(p.path, p.title)
    }
    const allPaths = Array.from(this.paths)
    for (const p of posts) {
      const abs = filePathFor(p.path)
      let raw: string
      try {
        raw = await fs.readFile(abs, 'utf8')
      } catch {
        // File vanished between listPostsFlat and readFile (e.g. user
        // deleted it via a separate process). Skip — the next rebuild
        // will be consistent.
        continue
      }
      const links = extractLinks(raw, p.path, allPaths)
      if (links.length > 0) this.forward.set(p.path, links)
    }
  }

  /** Add a path to the existence set without extracting. Used by
   *  tests (and any caller that needs to pre-register a target
   *  before writing a file that links to it). */
  registerPath(path: string, title = nameFromPath(path)): void {
    this.paths.add(path)
    this.titles.set(path, title)
  }

  /** Re-extract links for a single file. Used after a write or after
   *  a rename (with the new path). */
  applyWrite(path: string, raw: string): void {
    this.forward.delete(path)
    this.paths.add(path)
    this.titles.set(path, titleFromRaw(path, raw))
    const allPaths = Array.from(this.paths)
    const links = extractLinks(raw, path, allPaths)
    if (links.length > 0) this.forward.set(path, links)
  }

  /** Remove a file from the index. Also drops any dangling references
   *  in other files' forward entries (a file linking to a now-deleted
   *  note is no longer a valid inter-note link). */
  applyDelete(path: string): void {
    this.forward.delete(path)
    this.paths.delete(path)
    this.titles.delete(path)
    for (const [source, links] of this.forward) {
      const filtered = links.filter((l) => l.target !== path)
      if (filtered.length === 0) {
        this.forward.delete(source)
      } else if (filtered.length !== links.length) {
        this.forward.set(source, filtered)
      }
    }
  }

  /** Rename: drop the old path, re-extract at the new path. The new
   *  path's outbound links are resolved against the updated `paths`
   *  set; other files that previously linked to the old path lose
   *  those dangling references via `applyDelete`. */
  applyRename(oldPath: string, newPath: string, newRaw: string): void {
    this.applyDelete(oldPath)
    this.applyWrite(newPath, newRaw)
  }

  /** Cascade delete for a folder subtree. */
  applyFolderDelete(paths: string[]): void {
    for (const p of paths) this.applyDelete(p)
  }

  /** Cascade rename: every file in `oldToNew` is dropped from its old
   *  path and re-extracted at its new path. The new paths are
   *  pre-registered BEFORE the writes run so that extraction during
   *  `applyWrite` can resolve inter-cascade links (e.g. a file moving
   *  to a new folder that links to a sibling in the same cascade). */
  applyFolderRename(
    oldToNew: Array<{ oldPath: string; newPath: string; newRaw: string }>,
  ): void {
    for (const { oldPath } of oldToNew) this.applyDelete(oldPath)
    for (const { newPath } of oldToNew) this.paths.add(newPath)
    for (const { newPath, newRaw } of oldToNew) this.applyWrite(newPath, newRaw)
  }

  /** Reverse lookup. Returns one record per source file. The forward
   *  map already dedupes on (target, anchor) per source via
   *  `extractLinks`, so a source that links to the same target twice
   *  appears here only once. */
  getBacklinks(target: string): BacklinkRecord[] {
    const out: BacklinkRecord[] = []
    for (const [source, links] of this.forward) {
      for (const l of links) {
        if (l.target === target) {
          out.push({ source, alias: l.alias, anchor: l.anchor, kind: l.kind })
          break
        }
      }
    }
    return out
  }

  /** Existence check used by the renderer to mark a wiki link as
   *  missing when the target doesn't exist in the vault. */
  hasPath(p: string): boolean {
    return this.paths.has(p)
  }

  /** Wire shape for `GET /api/links/index`. */
  snapshot(): LinkIndexSnapshot {
    const outgoing: Record<string, Link[]> = {}
    for (const [k, v] of this.forward) outgoing[k] = v.slice()
    const titles: Record<string, string> = {}
    for (const p of this.paths) {
      titles[p] = this.titles.get(p) ?? nameFromPath(p)
    }
    return { paths: Array.from(this.paths), outgoing, titles }
  }
}

// ---------- singleton ----------

let _index: LinkIndex | null = null
let _indexPromise: Promise<LinkIndex> | null = null

/** Lazy singleton. The first call triggers a full rebuild from
 *  CONTENT_DIR; subsequent calls return the cached instance. */
export async function getIndex(): Promise<LinkIndex> {
  if (_index) return _index
  if (_indexPromise) return _indexPromise
  _indexPromise = (async () => {
    const idx = new LinkIndex()
    await idx.rebuild()
    _index = idx
    return idx
  })()
  return _indexPromise
}

/** Test-only escape hatch: drop the cached singleton so the next
 *  `getIndex()` rebuilds from the current CONTENT_DIR. Use this in
 *  test `beforeEach` after `setContentDir` so the index picks up the
 *  test fixture. */
export function __resetLinkIndexForTesting(): void {
  _index = null
  _indexPromise = null
}
