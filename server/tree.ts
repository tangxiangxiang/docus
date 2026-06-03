import { promises as fs } from 'node:fs'
import path from 'node:path'
import { POSTS_DIR } from './paths.js'

// Local types — Task 5 will introduce the canonical PostSummary / TreeNode in
// src/lib/api.ts and align them with these. Keeping them local for now avoids
// coupling server/ to src/ before that refactor lands.
export interface PostSummary {
  path: string
  title: string
  date: string
  tags: string[]
  summary?: string
  size: number
  mtime: number
}

export type TreeNode =
  | { kind: 'file'; name: string; path: string; title: string; mtime: number }
  | { kind: 'folder'; name: string; path: string; children: TreeNode[] }

async function* walk(
  dir: string,
  prefix: string,
): AsyncGenerator<{ abs: string; rel: string; isDir: boolean }> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
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
  // rel is e.g. "hello.md" or "notes/draft.md" — strip .md and prepend "posts/".
  const noExt = rel.replace(/\.md$/, '')
  return `posts/${noExt}`
}

function nameFromPath(p: string): string {
  return p.split('/').pop()!
}

function titleFromFile(file: string, fallback: string): string {
  // Cheap title extraction: first H1, or fallback to filename.
  // We avoid pulling in gray-matter here for performance; a fuller parse happens
  // at GET /api/posts/* time. This is best-effort for the tree view.
  try {
    // Synchronous read is fine here — files are small and this only runs in tree-builder paths.
    const fsSync = require('node:fs') as typeof import('node:fs')
    const text = fsSync.readFileSync(file, 'utf8')
    const m = /^#\s+(.+)$/m.exec(text)
    if (m) return m[1].trim()
  } catch { /* ignore */ }
  return fallback
}

export async function listPostsFlat(
  rootDir: string = POSTS_DIR,
): Promise<PostSummary[]> {
  const out: PostSummary[] = []
  for await (const entry of walk(rootDir, '')) {
    if (entry.isDir) continue
    if (!entry.rel.endsWith('.md')) continue
    const p = relToPath(entry.rel)
    const name = nameFromPath(p)
    const stat = await fs.stat(entry.abs)
    out.push({
      path: p,
      title: titleFromFile(entry.abs, name),
      date: '',
      tags: [],
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
  // folderPath is the `path` field, e.g. "posts/notes". Strip the "posts/"
  // prefix to get the rel dir under rootDir.
  const relDir = folderPath.replace(/^posts\//, '')
  const absDir = path.join(rootDir, relDir)
  try {
    await fs.stat(absDir)
  } catch {
    return []
  }
  const out: string[] = []
  for await (const entry of walk(absDir, relDir)) {
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
  rootDir: string = POSTS_DIR,
): Promise<TreeNode[]> {
  // Build a tree by sorting and inserting into a path-keyed node map.
  const nodes = new Map<string, MutableNode>()
  const rootFolder: MutableNode = {
    kind: 'folder',
    name: 'posts',
    path: 'posts',
    children: [],
  }
  nodes.set('posts', rootFolder)

  for await (const entry of walk(rootDir, '')) {
    if (entry.isDir) {
      // Ensure every ancestor folder exists.
      const parts = entry.rel.split('/')
      let acc = 'posts'
      for (const part of parts) {
        acc = `${acc}/${part}`
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
      parent.children.push({
        kind: 'file',
        name,
        path: p,
        title: titleFromFile(entry.abs, name),
        mtime: stat.mtimeMs,
      })
    }
  }

  // Wire each ancestor folder into its parent (skipping the sentinel root itself).
  for (const [nodePath, node] of nodes) {
    if (nodePath === 'posts') continue
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

  return rootFolder.children
}
