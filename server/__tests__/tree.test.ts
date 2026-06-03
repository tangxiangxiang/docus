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
      'posts/hello',
      'posts/notes/archive/old',
      'posts/notes/draft',
    ])
  })
})

describe('buildTree', () => {
  it('nests folders before files, both alphabetically', async () => {
    const tree = await buildTree(sandbox)
    expect(tree).toEqual([
      {
        kind: 'folder',
        name: 'notes',
        path: 'posts/notes',
        children: [
          {
            kind: 'folder',
            name: 'archive',
            path: 'posts/notes/archive',
            children: [
              { kind: 'file', name: 'old', path: 'posts/notes/archive/old', title: 'old', mtime: expect.any(Number) },
            ],
          },
          { kind: 'file', name: 'draft', path: 'posts/notes/draft', title: 'draft', mtime: expect.any(Number) },
        ],
      },
      { kind: 'file', name: 'hello', path: 'posts/hello', title: 'hi', mtime: expect.any(Number) },
    ])
  })

  it('returns an empty array for an empty directory', async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-empty-'))
    const tree = await buildTree(empty)
    expect(tree).toEqual([])
    await fs.rm(empty, { recursive: true, force: true })
  })
})

describe('listSubtreePaths', () => {
  it('returns all descendant file paths under a folder', async () => {
    const all = await listSubtreePaths(sandbox, 'posts/notes')
    expect(all.sort()).toEqual(['posts/notes/archive/old', 'posts/notes/draft'])
  })
  it('returns empty for a non-existent folder', async () => {
    const all = await listSubtreePaths(sandbox, 'posts/missing')
    expect(all).toEqual([])
  })
})
