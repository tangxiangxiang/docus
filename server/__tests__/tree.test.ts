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
