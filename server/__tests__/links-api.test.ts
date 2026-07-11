// Integration tests for the link index HTTP endpoints and the
// index updates triggered by the file-mutation routes. Uses
// setContentDir + a real temp dir so the production code path is
// exercised end-to-end (the splitter routes, gray-matter parsing,
// etc.). We never mock getIndex — it is the real singleton, but
// reset in beforeEach to point at the temp dir.
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import app, { __setMetadataDbForTesting } from '../index'
import { setContentDir } from '../paths.js'
import { __resetLinkIndexForTesting } from '../linkIndex.js'
import { applyMigrations } from '../db.js'

let sandbox: string
let originalContentDir: string
const db = new Database(':memory:')
db.pragma('foreign_keys = ON')
applyMigrations(db)

beforeEach(async () => {
  db.exec('DELETE FROM documents; DELETE FROM tags;')
  __setMetadataDbForTesting(db)
  originalContentDir = path.resolve(process.cwd(), 'src/content')
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-links-api-'))
  // Seed two files so the index has something to start with.
  await fs.writeFile(path.join(sandbox, 'a.md'), '# a\nsee [[b]]', 'utf8')
  await fs.writeFile(path.join(sandbox, 'b.md'), '# b\nsee [a](a.md)', 'utf8')
  setContentDir(sandbox)
  __resetLinkIndexForTesting()
})

afterEach(async () => {
  __setMetadataDbForTesting(null)
  await fs.rm(sandbox, { recursive: true, force: true })
  setContentDir(originalContentDir)
  __resetLinkIndexForTesting()
})

afterAll(() => db.close())

async function get(urlPath: string) {
  return app.fetch(new Request(`http://localhost${urlPath}`))
}

describe('GET /api/links/index', () => {
  it('returns the paths set and outgoing map after lazy rebuild', async () => {
    const r = await get('/api/links/index')
    expect(r.status).toBe(200)
    const body = await r.json() as { paths: string[]; outgoing: Record<string, unknown[]> }
    expect(body.paths.sort()).toEqual(['a', 'b'])
    expect(body.outgoing['a']).toEqual([{ target: 'b', alias: undefined, anchor: undefined, kind: 'wiki' }])
    expect(body.outgoing['b']).toEqual([{ target: 'a', alias: 'a', anchor: undefined, kind: 'md' }])
  })
})

describe('GET /api/backlinks', () => {
  it('returns sources that link to the given path', async () => {
    const r = await get('/api/backlinks?path=b')
    expect(r.status).toBe(200)
    const body = await r.json() as Array<{ source: string }>
    expect(body.map((b) => b.source)).toEqual(['a'])
  })

  it('returns 400 when path is missing', async () => {
    const r = await get('/api/backlinks')
    expect(r.status).toBe(400)
  })

  it('returns [] for a path with no inbound links', async () => {
    const r = await get('/api/backlinks?path=does-not-exist')
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual([])
  })
})

describe('write routes update the index', () => {
  it('PUT adds the new outbound links', async () => {
    // Create a fresh file that links to a. After the PUT, the backlinks
    // for `a` should include the new source `c` (b already linked to a
    // in the seed, so it's also there).
    await fs.writeFile(path.join(sandbox, 'c.md'), '# c', 'utf8')
    __resetLinkIndexForTesting()  // re-scan with c present
    const put = await app.fetch(new Request('http://localhost/api/posts/c', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ raw: '# c\nsee [[a]]' }),
    }))
    expect(put.status).toBe(200)

    const bl = await get('/api/backlinks?path=a')
    const sources = ((await bl.json()) as Array<{ source: string }>).map((b) => b.source).sort()
    expect(sources).toEqual(['b', 'c'])
  })

  it('DELETE drops the source AND cleans dangling references from other files', async () => {
    // b links to a. Delete a. The forward entry for b should also lose
    // its link to a (since a no longer exists).
    const del = await app.fetch(new Request('http://localhost/api/posts/a', { method: 'DELETE' }))
    expect(del.status).toBe(200)

    // backlinks for a should be empty now
    const bl = await get('/api/backlinks?path=a')
    expect(await bl.json()).toEqual([])

    // b's outgoing should be empty too (its link to a was dangling)
    const idx = await get('/api/links/index')
    const snap = await idx.json() as { outgoing: Record<string, unknown[]>; paths: string[] }
    expect(snap.outgoing['b']).toBeUndefined()
    expect(snap.paths.sort()).toEqual(['b'])
  })

  it('PATCH rename re-extracts the new path against the new source dir', async () => {
    // Create a folder + file, then rename the file within the folder.
    // The renamed file's text is unchanged (still says `[[b]]`), so
    // the rename is a mechanical move. Other files that linked to b
    // (a.md in the seed) keep their entry.
    await fs.mkdir(path.join(sandbox, 'notes'))
    await fs.writeFile(path.join(sandbox, 'notes', 'draft.md'), '# draft\nsee [[b]]', 'utf8')
    __resetLinkIndexForTesting()  // re-scan

    // Rename 'notes/draft' -> 'notes/draft2'.
    const r = await app.fetch(new Request('http://localhost/api/posts/notes/draft', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'draft2' }),
    }))
    expect(r.status).toBe(200)

    // Backlinks for 'b' now include the renamed file under its new path.
    // a.md (seed) also still links to b, so it's in the result too.
    const bl = await get('/api/backlinks?path=b')
    const sources = ((await bl.json()) as Array<{ source: string }>).map((b) => b.source).sort()
    expect(sources).toEqual(['a', 'notes/draft2'])

    // Old path is gone from the index; new path is in.
    const idx = await get('/api/links/index')
    const snap = await idx.json() as { paths: string[] }
    expect(snap.paths).not.toContain('notes/draft')
    expect(snap.paths).toContain('notes/draft2')
  })

  it('POST /api/posts registers the new file in the index', async () => {
    const r = await app.fetch(new Request('http://localhost/api/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'fresh', title: 'Fresh' }),
    }))
    expect(r.status).toBe(201)
    // The default body for a new post has no links, so the only effect
    // on the index is the new path being added.
    const idx = await get('/api/links/index')
    const snap = await idx.json() as { paths: string[] }
    expect(snap.paths).toContain('fresh')
  })

  it('PATCH /api/folders cascades the index', async () => {
    // Build a 'notes' subtree.
    await fs.mkdir(path.join(sandbox, 'notes'))
    await fs.writeFile(path.join(sandbox, 'notes', 'a.md'), '# a\nsee [[b]]', 'utf8')
    await fs.writeFile(path.join(sandbox, 'notes', 'b.md'), '# b', 'utf8')
    __resetLinkIndexForTesting()

    // Rename the folder.
    const r = await app.fetch(new Request('http://localhost/api/folders/notes', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newPath: 'archive' }),
    }))
    expect(r.status).toBe(200)

    // Old paths are gone, new paths are in.
    const idx = await get('/api/links/index')
    const snap = await idx.json() as { paths: string[]; outgoing: Record<string, Array<{ target: string }>> }
    expect(snap.paths).not.toContain('notes/a')
    expect(snap.paths).not.toContain('notes/b')
    expect(snap.paths).toContain('archive/a')
    expect(snap.paths).toContain('archive/b')

    // 'archive/a' resolves [[b]] against its new same-dir → 'archive/b'.
    expect(snap.outgoing['archive/a']?.[0]?.target).toBe('archive/b')
  })

  it('DELETE /api/folders cascades the index (recursive)', async () => {
    await fs.mkdir(path.join(sandbox, 'notes'))
    await fs.writeFile(path.join(sandbox, 'notes', 'a.md'), '# a', 'utf8')
    await fs.writeFile(path.join(sandbox, 'notes', 'b.md'), '# b', 'utf8')
    __resetLinkIndexForTesting()

    const r = await app.fetch(new Request('http://localhost/api/folders/notes?recursive=true', {
      method: 'DELETE',
    }))
    expect(r.status).toBe(200)

    const idx = await get('/api/links/index')
    const snap = await idx.json() as { paths: string[] }
    expect(snap.paths).not.toContain('notes/a')
    expect(snap.paths).not.toContain('notes/b')
  })
})
