import { promises as fs } from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { CONTENT_DIR } from './paths.js'
import type { PostSummary, TreeNode } from '../src/lib/api.js'

// `PostSummary` and `TreeNode` are owned by the client (src/lib/api.ts). The
// server is intentionally not in the type-check graph (no tsconfig include),
// but the wire shapes still have to agree — importing the same type that the
// client uses means a future change to either side has a single source of
// truth. Path resolution works because the whole repo is processed by
// Vite/Vitest under `moduleResolution: bundler`.

async function* walk(
  dir: string,
  prefix: string,
): AsyncGenerator<{ abs: string; rel: string; isDir: boolean }> {
  let entries: Awaited<ReturnType<typeof fs.readdir>>
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      yield { abs, rel, isDir: true }
      yield* walk(abs, rel)
    } else {
      yield { abs, rel, isDir: false }
    }
  }
}

function relToPath(rel: string): string {
  // rel is e.g. "hello.md" or "notes/draft.md" — strip .md, no implicit prefix
  // (the implicit root is `src/content/`, which is handled by the caller).
  return rel.replace(/\.md$/, '')
}

function nameFromPath(p: string): string {
  return p.split('/').pop()!
}

function readFrontmatter(file: string): { tags: string[]; firstHeading: string | null } {
  // Sync read is fine here — files are small and this only runs in tree-builder paths.
  // We use this for the cheap frontmatter fields (tags) and the first H1 — the
  // full gray-matter parse is reserved for the single-file GET where we have
  // the content anyway. Returning defaults on any parse error keeps the list
  // endpoint resilient to a single corrupt file.
  try {
    const fsSync = require('node:fs') as typeof import('node:fs')
    const text = fsSync.readFileSync(file, 'utf8')
    const parsed = matter(text)
    const tags = Array.isArray(parsed.data.tags)
      ? (parsed.data.tags as unknown[]).filter((t): t is string => typeof t === 'string')
      : []
    const m = /^#\s+(.+)$/m.exec(text)
    return { tags, firstHeading: m ? m[1].trim() : null }
  } catch {
    return { tags: [], firstHeading: null }
  }
}

function titleFromFile(file: string, fallback: string, firstHeading: string | null): string {
  if (firstHeading) return firstHeading
  return fallback
}

export async function listPostsFlat(
  rootDir: string = CONTENT_DIR,
): Promise<PostSummary[]> {
  const out: PostSummary[] = []
  for await (const entry of walk(rootDir, '')) {
    if (entry.isDir) continue
    if (!entry.rel.endsWith('.md')) continue
    const p = relToPath(entry.rel)
    const name = nameFromPath(p)
    const stat = await fs.stat(entry.abs)
    const fm = readFrontmatter(entry.abs)
    out.push({
      path: p,
      title: titleFromFile(entry.abs, name, fm.firstHeading),
      date: '',
      tags: fm.tags,
      size: stat.size,
      mtime: stat.mtimeMs,
    })
  }
  out.sort((a, b) => a.path.localeCompare(b.path))
  return out
}

export async function listSubtreePaths(
  rootDir: string,
  folderPath: string,
): Promise<string[]> {
  // folderPath is the `path` field, e.g. "notes" or "notes/draft" — used as
  // the rel dir under rootDir.
  const absDir = path.join(rootDir, folderPath)
  try {
    await fs.stat(absDir)
  } catch {
    return []
  }
  const out: string[] = []
  for await (const entry of walk(absDir, folderPath)) {
    if (entry.isDir) continue
    if (!entry.rel.endsWith('.md')) continue
    out.push(relToPath(entry.rel))
  }
  return out
}

type MutableNode =
  | { kind: 'file'; name: string; path: string; title: string; mtime: number }
  | { kind: 'folder'; name: string; path: string; children: MutableNode[] }

export async function buildTree(
  rootDir: string = CONTENT_DIR,
): Promise<TreeNode[]> {
  // Build a tree by sorting and inserting into a path-keyed node map.
  // The implicit root is `src/content/`, named "content" with `path: ''`
  // (empty, since there is no prefix segment for it).
  const nodes = new Map<string, MutableNode>()
  const rootFolder: MutableNode = {
    kind: 'folder',
    name: 'content',
    path: '',
    children: [],
  }
  nodes.set('', rootFolder)

  for await (const entry of walk(rootDir, '')) {
    if (entry.isDir) {
      // Ensure every ancestor folder exists.
      const parts = entry.rel.split('/')
      let acc = ''
      for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part
        if (!nodes.has(acc)) {
          nodes.set(acc, { kind: 'folder', name: part, path: acc, children: [] })
        }
      }
    } else {
      if (!entry.rel.endsWith('.md')) continue
      const p = relToPath(entry.rel)
      const name = nameFromPath(p)
      const parts = p.split('/')
      // Parent path is everything up to the file's own name, joined back together.
      const parentPath = parts.slice(0, -1).join('/')
      const parent = nodes.get(parentPath)
      if (!parent || parent.kind !== 'folder') continue
      const stat = await fs.stat(entry.abs)
      const fm = readFrontmatter(entry.abs)
      parent.children.push({
        kind: 'file',
        name,
        path: p,
        title: titleFromFile(entry.abs, name, fm.firstHeading),
        mtime: stat.mtimeMs,
      })
    }
  }

  // Wire each ancestor folder into its parent (skipping the sentinel root itself).
  for (const [nodePath, node] of nodes) {
    if (nodePath === '') continue
    if (node.kind !== 'folder') continue
    const parts = nodePath.split('/')
    const parentPath = parts.slice(0, -1).join('/')
    const parent = nodes.get(parentPath)
    if (parent && parent.kind === 'folder' && !parent.children.includes(node)) {
      parent.children.push(node)
    }
  }

  // Sort each folder's children: folders first, then files, both alphabetically (case-insensitive).
  function sortChildren(n: MutableNode) {
    if (n.kind === 'folder') {
      n.children.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      n.children.forEach(sortChildren)
    }
  }
  sortChildren(rootFolder)

  return [rootFolder]
}
