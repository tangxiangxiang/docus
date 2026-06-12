import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { listPostsFlat, buildTree, listSubtreePaths } from '../tree.js'

let sandbox: string

async function makeFixture() {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-tree-'))
  await fs.writeFile(path.join(sandbox, 'hello.md'), '# hi')
  await fs.mkdir(path.join(sandbox, 'notes'))
  await fs.writeFile(path.join(sandbox, 'notes', 'draft.md'), '# draft')
  await fs.mkdir(path.join(sandbox, 'notes', 'archive'))
  await fs.writeFile(path.join(sandbox, 'notes', 'archive', 'old.md'), '# old')
}

beforeEach(makeFixture)
afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true })
})

describe('listPostsFlat', () => {
  it('returns all .md files as PostSummary-shaped objects', async () => {
    const posts = await listPostsFlat(sandbox)
    const paths = posts.map((p) => p.path).sort()
    expect(paths).toEqual([
      'hello',
      'notes/archive/old',
      'notes/draft',
    ])
  })

  it('reads `created` from frontmatter and falls back to mtime for `updated`', async () => {
    // File has no `updated` in frontmatter — covers the migration case
    // for notes that were never saved through the API.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-tree-dates-'))
    const file = path.join(dir, 'stub.md')
    await fs.writeFile(
      file,
      '---\ntitle: Dated\ncreated: 2026-01-15\n---\n\nBody\n',
    )
    // Pin mtime so the formatted `updated` is deterministic
    const mtimeMs = Date.UTC(2026, 2, 20, 12, 0, 0)
    await fs.utimes(file, mtimeMs / 1000, mtimeMs / 1000)

    const posts = await listPostsFlat(dir)
    expect(posts).toHaveLength(1)
    expect(posts[0]!.created).toBe('2026-01-15')
    expect(posts[0]!.updated).toBe('2026-03-20')
    expect(posts[0]!.mtime).toBe(mtimeMs)

    await fs.rm(dir, { recursive: true, force: true })
  })

  it('reads `updated` from frontmatter when present, ignoring mtime', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-tree-fm-updated-'))
    const file = path.join(dir, 'stub.md')
    await fs.writeFile(
      file,
      '---\ntitle: Dated\ncreated: 2026-01-15\nupdated: 2026-02-10\n---\n\nBody\n',
    )
    // mtime set to something completely different from `updated` —
    // the frontmatter value should win.
    const mtimeMs = Date.UTC(2030, 0, 1, 0, 0, 0)
    await fs.utimes(file, mtimeMs / 1000, mtimeMs / 1000)

    const posts = await listPostsFlat(dir)
    expect(posts[0]!.created).toBe('2026-01-15')
    expect(posts[0]!.updated).toBe('2026-02-10')
    expect(posts[0]!.mtime).toBe(mtimeMs)

    await fs.rm(dir, { recursive: true, force: true })
  })

  it('falls back to legacy `date` field for back-compat', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-tree-legacy-'))
    await fs.writeFile(
      path.join(dir, 'old.md'),
      '---\ntitle: Old\ndate: 2025-12-01\n---\n\nBody\n',
    )
    const posts = await listPostsFlat(dir)
    expect(posts).toHaveLength(1)
    expect(posts[0]!.created).toBe('2025-12-01')
    await fs.rm(dir, { recursive: true, force: true })
  })
})

describe('buildTree', () => {
  it('nests everything under a content root folder with empty path', async () => {
    const tree = await buildTree(sandbox)
    expect(tree).toEqual([
      {
        kind: 'folder',
        name: 'content',
        path: '',
        children: [
          {
            kind: 'folder',
            name: 'notes',
            path: 'notes',
            children: [
              {
                kind: 'folder',
                name: 'archive',
                path: 'notes/archive',
                children: [
                  { kind: 'file', name: 'old', path: 'notes/archive/old', title: 'old', mtime: expect.any(Number) },
                ],
              },
              { kind: 'file', name: 'draft', path: 'notes/draft', title: 'draft', mtime: expect.any(Number) },
            ],
          },
          { kind: 'file', name: 'hello', path: 'hello', title: 'hi', mtime: expect.any(Number) },
        ],
      },
    ])
  })

  it('returns a content folder with empty children for an empty directory', async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-empty-'))
    const tree = await buildTree(empty)
    expect(tree).toEqual([
      { kind: 'folder', name: 'content', path: '', children: [] },
    ])
    await fs.rm(empty, { recursive: true, force: true })
  })

  it('returns a content folder with empty children for a missing directory', async () => {
    const tree = await buildTree(path.join(sandbox, 'does-not-exist'))
    expect(tree).toEqual([
      { kind: 'folder', name: 'content', path: '', children: [] },
    ])
  })

  it('prefers frontmatter.title over the first H1 and the filename', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-tree-fm-'))
    await fs.writeFile(
      path.join(dir, 'stub.md'),
      '---\ntitle: Display Title\n---\n\n# Body Heading\n',
    )
    const posts = await listPostsFlat(dir)
    expect(posts).toHaveLength(1)
    expect(posts[0]!.title).toBe('Display Title')

    const tree = await buildTree(dir)
    const file = tree[0]!.children[0]!
    expect(file.kind).toBe('file')
    if (file.kind === 'file') expect(file.title).toBe('Display Title')

    await fs.rm(dir, { recursive: true, force: true })
  })
})

describe('listSubtreePaths', () => {
  it('returns all descendant file paths under a folder', async () => {
    const all = await listSubtreePaths(sandbox, 'notes')
    expect(all.sort()).toEqual(['notes/archive/old', 'notes/draft'])
  })
  it('returns empty for a non-existent folder', async () => {
    const all = await listSubtreePaths(sandbox, 'missing')
    expect(all).toEqual([])
  })
})
