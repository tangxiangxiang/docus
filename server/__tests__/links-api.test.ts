// Integration tests for the link index HTTP endpoints and the
// index updates triggered by the file-mutation routes. Uses
// setContentDir + a real temp dir so the production code path is
// exercised end-to-end (the splitter routes, gray-matter parsing,
// etc.). We never mock getIndex — it is the real singleton, but
// reset in beforeEach to point at the temp dir.
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import Database from 'better-sqlite3'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import app, { __setMetadataDbForTesting } from '../index'
import { setContentDir } from '../paths.js'
import { __resetLinkIndexForTesting } from '../linkIndex.js'
import { applyMigrations } from '../db.js'
import { getDocumentMetadata, saveDocumentMetadata, snapshotDocumentMetadataDatabase } from '../documentMetadata.js'
import {
  documentWriteLockWaitersForTesting,
  VAULT_STRUCTURE_LOCK,
  withDocumentWriteLock,
} from '../documentWriteLock.js'
import { __setFolderRaceHooksForTesting } from '../routes/folders.js'
import { __setPostRenameRaceHooksForTesting } from '../routes/posts.js'

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

describe('rename reference updates', () => {
  it('previews and updates inbound links when requested', async () => {
    const impact = await get('/api/links/rename-impact?path=b')
    expect(await impact.json()).toEqual({ path: 'b', count: 1, sources: ['a'] })

    const renamed = await app.fetch(new Request('http://localhost/api/posts/b', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'renamed-b', updateReferences: true }),
    }))
    expect(renamed.status).toBe(200)
    const renamedBody = await renamed.json() as {
      updatedReferences: Array<{ path: string; raw: string; mtime: number }>
    }
    expect(renamedBody.updatedReferences).toEqual([
      expect.objectContaining({ path: 'a', raw: '# a\nsee [[renamed-b]]', mtime: expect.any(Number) }),
    ])
    expect(renamedBody.updatedReferences[0]!.mtime).toBeGreaterThan(0)
    expect(await fs.readFile(path.join(sandbox, 'a.md'), 'utf8')).toBe('# a\nsee [[renamed-b]]')
    await expect(fs.stat(path.join(sandbox, 'b.md'))).rejects.toThrow()
    expect(await fs.readFile(path.join(sandbox, 'renamed-b.md'), 'utf8')).toBe('# b\nsee [a](a.md)')

    const backlinks = await get('/api/backlinks?path=renamed-b')
    expect((await backlinks.json() as Array<{ source: string }>).map((item) => item.source)).toEqual(['a'])
  })

  it('rolls the rename back when an inbound link write fails', async () => {
    await get('/api/links/index')
    // Reference writes are ownership-verified: the first step is the
    // takeover rename of the current generation to a private staged
    // path. Failing THAT rename for a.md fails the reference write
    // before any byte of it is touched.
    const originalRename = fs.rename.bind(fs)
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to).includes('.docus-staged-') && String(from).endsWith(`${path.sep}a.md`)) {
        throw new Error('simulated reference write failure')
      }
      return originalRename(from, to)
    })
    try {
      const renamed = await app.fetch(new Request('http://localhost/api/posts/b', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'renamed-b', updateReferences: true }),
      }))
      expect(renamed.status).toBe(500)
      expect(await fs.readFile(path.join(sandbox, 'a.md'), 'utf8')).toBe('# a\nsee [[b]]')
      expect(await fs.readFile(path.join(sandbox, 'b.md'), 'utf8')).toBe('# b\nsee [a](a.md)')
      await expect(fs.stat(path.join(sandbox, 'renamed-b.md'))).rejects.toThrow()
    } finally {
      spy.mockRestore()
    }
  })

  it('preserves an external save to a referenced file that lands after the plan is built (409, no overwrite)', async () => {
    // Snapshot-semantics contract, external-safety side: in-process
    // locks do not stop Obsidian/vim/sync software. When an external
    // editor saves a referenced file AFTER the rename's in-lock plan
    // snapshotted it (between the raw read and the write loop), the
    // ownership-verified reference write must detect the foreign bytes
    // and fail the whole rename closed — never overwrite the external
    // save.
    await fs.writeFile(path.join(sandbox, 'ref-a.md'), '# a\nsee [[b]]\n', 'utf8')
    __resetLinkIndexForTesting()
    await get('/api/links/index')
    const external = '# a\nexternal save\nsee [[b]]\n'
    __setPostRenameRaceHooksForTesting({
      afterRenamePlanBuilt: async () => {
        await fs.writeFile(path.join(sandbox, 'ref-a.md'), external, 'utf8')
      },
    })
    try {
      const renamed = await app.fetch(new Request('http://localhost/api/posts/b', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'renamed-b', updateReferences: true }),
      }))
      expect(renamed.status).toBe(409)
      expect(await renamed.json()).toMatchObject({
        error: expect.stringMatching(/changed on disk/),
      })
      // The external bytes win and the rename is fully undone.
      expect(await fs.readFile(path.join(sandbox, 'ref-a.md'), 'utf8')).toBe(external)
      expect(await fs.readFile(path.join(sandbox, 'b.md'), 'utf8')).toBe('# b\nsee [a](a.md)')
      expect(await fs.readFile(path.join(sandbox, 'a.md'), 'utf8')).toBe('# a\nsee [[b]]')
      await expect(fs.stat(path.join(sandbox, 'renamed-b.md'))).rejects.toThrow()
      const names = await fs.readdir(sandbox)
      expect(names.some((name) => name.includes('.docus-save-'))).toBe(false)
      expect(names.some((name) => name.includes('.docus-staged-'))).toBe(false)
    } finally {
      __setPostRenameRaceHooksForTesting(null)
    }
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
      body: JSON.stringify({ raw: '# c\nsee [[a]]', baseRaw: '# c' }),
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
      body: JSON.stringify({ newPath: 'renamed' }),
    }))
    expect(r.status).toBe(200)

    // Old paths are gone, new paths are in.
    const idx = await get('/api/links/index')
    const snap = await idx.json() as { paths: string[]; outgoing: Record<string, Array<{ target: string }>> }
    expect(snap.paths).not.toContain('notes/a')
    expect(snap.paths).not.toContain('notes/b')
    expect(snap.paths).toContain('renamed/a')
    expect(snap.paths).toContain('renamed/b')

    // 'renamed/a' resolves [[b]] against its new same-dir → 'renamed/b'.
    expect(snap.outgoing['renamed/a']?.[0]?.target).toBe('renamed/b')
  })

  it('waits for a child document transaction before renaming its folder', async () => {
    await fs.mkdir(path.join(sandbox, 'notes'))
    await fs.writeFile(path.join(sandbox, 'notes', 'a.md'), '# a', 'utf8')
    let release!: () => void
    let locked!: () => void
    const lockStarted = new Promise<void>((resolve) => { locked = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const holder = withDocumentWriteLock('notes/a', async () => {
      locked()
      await gate
    })
    await lockStarted

    const request = app.fetch(new Request('http://localhost/api/folders/notes', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newPath: 'renamed' }),
    }))
    const state = await Promise.race([
      request.then(() => 'completed'),
      new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 20)),
    ])
    expect(state).toBe('waiting')
    release()
    await holder
    expect((await request).status).toBe(200)
  })

  it('returns the rewritten reference mtime after a folder rename', async () => {
    await fs.mkdir(path.join(sandbox, 'notes'))
    await fs.writeFile(path.join(sandbox, 'notes', 'target.md'), '# target', 'utf8')
    await fs.writeFile(path.join(sandbox, 'source.md'), 'see [[notes/target]]', 'utf8')
    __resetLinkIndexForTesting()

    const response = await app.fetch(new Request('http://localhost/api/folders/notes', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newPath: 'renamed', updateReferences: true }),
    }))
    expect(response.status).toBe(200)
    const body = await response.json() as {
      updatedReferences: Array<{ path: string; raw: string; mtime: number }>
    }
    expect(body.updatedReferences).toEqual([
      expect.objectContaining({ path: 'source', raw: 'see [[renamed/target]]', mtime: expect.any(Number) }),
    ])
    expect(body.updatedReferences[0]!.mtime).toBeGreaterThan(0)
  })

  it('restores reference metadata when a folder reference update rolls back', async () => {
    await fs.mkdir(path.join(sandbox, 'notes'))
    await fs.writeFile(path.join(sandbox, 'notes', 'target.md'), '# target', 'utf8')
    await fs.writeFile(path.join(sandbox, 'c.md'), '[[notes/target]]', 'utf8')
    await fs.writeFile(path.join(sandbox, 'd.md'), '[[notes/target]]', 'utf8')
    __resetLinkIndexForTesting()
    await get('/api/links/index')
    const cMetadata = saveDocumentMetadata(db, { id: 'folder-c', path: 'c', title: 'C', tags: ['stable'], updatedAt: 11 })
    db.prepare(`INSERT INTO document_embeddings (document_id, content_hash, embedding, model, indexed_at)
      VALUES (?, 'hash', X'0102', 'test', 11)`).run(cMetadata.id)
    db.prepare(`INSERT INTO metadata_migrations
      (path, document_id, status, source_hash, cleaned_hash, error, updated_at)
      VALUES ('c', ?, 'cleaned', 'source', 'cleaned', '', 11)`).run(cMetadata.id)
    const before = snapshotDocumentMetadataDatabase(db)
    // Reference writes are ownership-verified: fail the takeover rename
    // of d.md's current generation so the SECOND reference write fails
    // after c.md has already been rewritten, exercising the undo of a
    // completed reference write.
    const originalRename = fs.rename.bind(fs)
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to).includes('.docus-staged-') && String(from).endsWith(`${path.sep}d.md`)) {
        throw new Error('simulated second reference failure')
      }
      return originalRename(from, to)
    })
    try {
      const response = await app.fetch(new Request('http://localhost/api/folders/notes', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPath: 'renamed', updateReferences: true }),
      }))
      expect(response.status).toBe(500)
      expect(await fs.readFile(path.join(sandbox, 'c.md'), 'utf8')).toBe('[[notes/target]]')
      expect(await fs.readFile(path.join(sandbox, 'd.md'), 'utf8')).toBe('[[notes/target]]')
      expect(snapshotDocumentMetadataDatabase(db)).toEqual(before)
      await expect(fs.stat(path.join(sandbox, 'notes', 'target.md'))).resolves.toBeTruthy()
      await expect(fs.stat(path.join(sandbox, 'renamed'))).rejects.toThrow()
    } finally { spy.mockRestore() }
  })

  it('preserves an external save to a folder-rename reference that lands after the plan is built (409, no overwrite)', async () => {
    // Same external-safety contract as the document rename, for folder
    // renames: an external save to a reference file between the plan
    // snapshot and the reference write loop fails the rename closed and
    // keeps the external bytes.
    await fs.mkdir(path.join(sandbox, 'notes'))
    await fs.writeFile(path.join(sandbox, 'notes', 'target.md'), '# target', 'utf8')
    await fs.writeFile(path.join(sandbox, 'c.md'), '[[notes/target]]', 'utf8')
    __resetLinkIndexForTesting()
    await get('/api/links/index')
    const external = 'external save [[notes/target]]'
    __setFolderRaceHooksForTesting({
      afterRenamePlanBuilt: async () => {
        await fs.writeFile(path.join(sandbox, 'c.md'), external, 'utf8')
      },
    })
    try {
      const response = await app.fetch(new Request('http://localhost/api/folders/notes', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPath: 'renamed', updateReferences: true }),
      }))
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({
        error: expect.stringMatching(/changed on disk/),
      })
      expect(await fs.readFile(path.join(sandbox, 'c.md'), 'utf8')).toBe(external)
      // The folder move was undone.
      await expect(fs.stat(path.join(sandbox, 'notes', 'target.md'))).resolves.toBeTruthy()
      await expect(fs.stat(path.join(sandbox, 'renamed'))).rejects.toThrow()
      const names = await fs.readdir(sandbox)
      expect(names.some((name) => name.includes('.docus-save-'))).toBe(false)
      expect(names.some((name) => name.includes('.docus-staged-'))).toBe(false)
    } finally { __setFolderRaceHooksForTesting(null) }
  })

  it('does not delete destination recovery metadata when the filesystem rename fails', async () => {
    await fs.mkdir(path.join(sandbox, 'notes'))
    await fs.writeFile(path.join(sandbox, 'notes', 'a.md'), '# a', 'utf8')
    saveDocumentMetadata(db, { id: 'destination-recovery', path: 'renamed/recovered', title: 'Recovery' })
    const before = snapshotDocumentMetadataDatabase(db)
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('injected folder rename failure'))
    try {
      const response = await app.fetch(new Request('http://localhost/api/folders/notes', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPath: 'renamed' }),
      }))
      expect(response.status).toBe(500)
      expect(snapshotDocumentMetadataDatabase(db)).toEqual(before)
      await expect(fs.stat(path.join(sandbox, 'notes', 'a.md'))).resolves.toBeTruthy()
    } finally { rename.mockRestore() }
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

  it('restores the complete metadata graph when recursive folder removal fails', async () => {
    await fs.mkdir(path.join(sandbox, 'notes'))
    await fs.writeFile(path.join(sandbox, 'notes', 'a.md'), '# a', 'utf8')
    const metadata = saveDocumentMetadata(db, { id: 'folder-delete-a', path: 'notes/a', title: 'A', tags: ['stable'] })
    db.prepare(`INSERT INTO document_embeddings (document_id, content_hash, embedding, model, indexed_at)
      VALUES (?, 'hash', X'0102', 'test', 11)`).run(metadata.id)
    db.prepare(`INSERT INTO metadata_migrations
      (path, document_id, status, source_hash, cleaned_hash, error, updated_at)
      VALUES ('notes/a', ?, 'cleaned', 'source', 'cleaned', '', 11)`).run(metadata.id)
    const before = snapshotDocumentMetadataDatabase(db)
    const originalRm = fs.rm.bind(fs)
    const remove = vi.spyOn(fs, 'rm').mockImplementation(async (target, options) => {
      if (String(target).includes('.docus-delete-')) throw new Error('injected recursive removal failure')
      return originalRm(target, options)
    })
    try {
      const response = await app.fetch(new Request('http://localhost/api/folders/notes?recursive=true', { method: 'DELETE' }))
      expect(response.status).toBe(500)
      expect(await fs.readFile(path.join(sandbox, 'notes', 'a.md'), 'utf8')).toBe('# a')
      expect(snapshotDocumentMetadataDatabase(db)).toEqual(before)
    } finally { remove.mockRestore() }
  })

  it('never rebinds old identities when the folder path is re-used during a failed delete', async () => {
    // Path-reuse identity contract: when an external writer recreates
    // the folder tree while the staged removal is failing, the old
    // documentIds must NOT be restored onto the new generation's files.
    // The new files get fresh identities on their next API touch; the
    // old tree stays quarantined under its staging name.
    await fs.mkdir(path.join(sandbox, 'gone'))
    await fs.writeFile(path.join(sandbox, 'gone', 'a.md'), '# a', 'utf8')
    saveDocumentMetadata(db, { id: 'gone-old-id', path: 'gone/a', title: 'Old A' })
    __resetLinkIndexForTesting()
    const originalRm = fs.rm.bind(fs)
    const remove = vi.spyOn(fs, 'rm').mockImplementation(async (target, options) => {
      if (String(target).includes('.docus-delete-')) {
        // An external writer re-creates the folder tree with a NEW
        // generation while the staged removal is failing.
        await fs.mkdir(path.join(sandbox, 'gone'), { recursive: true })
        await fs.writeFile(path.join(sandbox, 'gone', 'a.md'), '# new generation', 'utf8')
        throw new Error('injected recursive removal failure')
      }
      return originalRm(target, options)
    })
    try {
      const response = await app.fetch(new Request('http://localhost/api/folders/gone?recursive=true', { method: 'DELETE' }))
      expect(response.status).toBe(500)
      // The new generation keeps its bytes; the old identity must NOT
      // be bound to it.
      expect(await fs.readFile(path.join(sandbox, 'gone', 'a.md'), 'utf8')).toBe('# new generation')
      expect(getDocumentMetadata(db, 'gone/a')).toBeNull()
      // The old tree survives quarantined under its staging name.
      const quarantined = (await fs.readdir(sandbox)).filter((name) => name.startsWith('gone.docus-delete-'))
      expect(quarantined).toHaveLength(1)
      expect(await fs.readFile(path.join(sandbox, quarantined[0]!, 'a.md'), 'utf8')).toBe('# a')
    } finally { remove.mockRestore() }
  })

  it('rejects rename and delete for protected roots and archive descendants', async () => {
    await fs.mkdir(path.join(sandbox, 'inbox'), { recursive: true })
    await fs.mkdir(path.join(sandbox, 'literature'), { recursive: true })
    await fs.mkdir(path.join(sandbox, 'archive', 'organized'), { recursive: true })

    for (const folder of ['inbox', 'literature', 'archive', 'archive/organized']) {
      const rename = await app.fetch(new Request(`http://localhost/api/folders/${folder}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPath: `${path.posix.dirname(folder)}/renamed`.replace(/^\.\//, '') }),
      }))
      expect(rename.status, folder).toBe(422)
      const remove = await app.fetch(new Request(`http://localhost/api/folders/${folder}?recursive=true`, {
        method: 'DELETE',
      }))
      expect(remove.status, folder).toBe(422)
    }
  })
})

describe('folder lifecycle vs concurrent membership changes (structure lock)', () => {
  // P0 regression: path-string document locks alone cannot isolate a
  // folder transaction from a child that is CREATED while the
  // transaction runs — `notes` and `notes/new` are distinct lock keys.
  // Every membership-changing operation now serializes behind the
  // vault structure lock, so these races linearize: the create always
  // lands either fully before or fully after the structural op, never
  // half-swallowed by it. The race hook pauses the folder transaction
  // inside its locks right after the in-lock re-validation, and the
  // waiter probe proves the concurrent create is actually queued
  // behind the structure lock before the transaction resumes — a
  // deterministic interleaving, no sleeps.

  it('linearizes a child create issued while a folder rename holds its locks', async () => {
    await fs.mkdir(path.join(sandbox, 'notes'))
    await fs.writeFile(path.join(sandbox, 'notes', 'a.md'), '# a', 'utf8')
    __resetLinkIndexForTesting()
    let createResponse: Promise<Response> | null = null
    __setFolderRaceHooksForTesting({
      afterRenameRecheck: async () => {
        createResponse = app.fetch(new Request('http://localhost/api/posts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: 'notes/created-during', title: 'X' }),
        }))
        while (documentWriteLockWaitersForTesting(VAULT_STRUCTURE_LOCK) === 0) {
          await new Promise((resolve) => setImmediate(resolve))
        }
      },
    })
    try {
      const rename = await app.fetch(new Request('http://localhost/api/folders/notes', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPath: 'renamed' }),
      }))
      expect(rename.status).toBe(200)
      // The rename moved exactly the children it enumerated under lock.
      expect(((await rename.json()) as { moved: string[] }).moved).toEqual(['renamed/a'])
      expect(createResponse).not.toBeNull()
      const created = await createResponse!
      expect(created.status).toBe(201)
      // The create landed AFTER the rename: the file lives at the
      // requested path with the requested body, the moved subtree was
      // not polluted, and the success response was not a lie.
      expect(await fs.readFile(path.join(sandbox, 'notes', 'created-during.md'), 'utf8')).toBe('# X\n')
      await expect(fs.stat(path.join(sandbox, 'renamed', 'created-during.md'))).rejects.toThrow()
      expect(await fs.readFile(path.join(sandbox, 'renamed', 'a.md'), 'utf8')).toBe('# a')
    } finally {
      __setFolderRaceHooksForTesting(null)
    }
  })

  it('linearizes a child create issued while a folder delete holds its locks', async () => {
    await fs.mkdir(path.join(sandbox, 'gone'))
    await fs.writeFile(path.join(sandbox, 'gone', 'a.md'), '# a', 'utf8')
    __resetLinkIndexForTesting()
    let createResponse: Promise<Response> | null = null
    __setFolderRaceHooksForTesting({
      afterDeleteRecheck: async () => {
        createResponse = app.fetch(new Request('http://localhost/api/posts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: 'gone/created-during', title: 'X' }),
        }))
        while (documentWriteLockWaitersForTesting(VAULT_STRUCTURE_LOCK) === 0) {
          await new Promise((resolve) => setImmediate(resolve))
        }
      },
    })
    try {
      const del = await app.fetch(new Request('http://localhost/api/folders/gone?recursive=true', {
        method: 'DELETE',
      }))
      expect(del.status).toBe(200)
      // The delete removed exactly the children it enumerated under lock.
      expect(((await del.json()) as { deleted: string[] }).deleted).toEqual(['gone/a'])
      expect(createResponse).not.toBeNull()
      const created = await createResponse!
      expect(created.status).toBe(201)
      // The create landed AFTER the delete: the create interface's
      // success must never be swallowed by the structural operation.
      expect(await fs.readFile(path.join(sandbox, 'gone', 'created-during.md'), 'utf8')).toBe('# X\n')
      expect(getDocumentMetadata(db, 'gone/created-during')?.title).toBe('X')
    } finally {
      __setFolderRaceHooksForTesting(null)
    }
  })
})

describe('REST rename vs a concurrent backlink added after the footprint check', () => {
  // P1 regression: the rename verified its in-lock candidate backlink
  // set, then RE-ENUMERATED the link index for the actual reference
  // writes. A body PUT (document lock only, never the structure lock)
  // could land a new link to the rename source in that window, and the
  // rename rewrote that file without ever holding its lock — locked
  // set ≠ written set. The rename now builds ONE plan from ONE in-lock
  // enumeration: the verified candidate set and the executed write set
  // are the same snapshot, so a link added after the check is simply
  // left untouched, never written without its lock.
  //
  // CONTRACT (snapshot semantics, chosen over a link-graph mutation
  // lock): links added AFTER the footprint check are not part of this
  // rename — the rename never writes a document whose lock it does not
  // hold, the late link stays untouched, and its author sees the
  // post-rename world on the next load. The rejected alternative would
  // serialize all document saves against renames.

  it('never rewrites a document whose new backlink lands after the footprint check', async () => {
    await fs.writeFile(path.join(sandbox, 'src.md'), '# src', 'utf8')
    await fs.writeFile(path.join(sandbox, 'ref-a.md'), '# a\nsee [[src]]', 'utf8')
    await fs.writeFile(path.join(sandbox, 'late-b.md'), '# b\nno links', 'utf8')
    __resetLinkIndexForTesting()
    await get('/api/links/index')

    let putResponse: Response | null = null
    __setPostRenameRaceHooksForTesting({
      afterPlanVerified: async () => {
        // late-b is NOT in the rename's lock set (src, renamed, ref-a):
        // its save holds only its own document lock and proceeds while
        // the rename holds all of its locks. It adds a link to the
        // rename source AFTER the footprint check has passed.
        putResponse = await app.fetch(new Request('http://localhost/api/posts/late-b', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ raw: '# b\nnow links [[src]]', baseRaw: '# b\nno links' }),
        }))
        expect(putResponse.status).toBe(200)
      },
    })
    try {
      const rename = await app.fetch(new Request('http://localhost/api/posts/src', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'renamed', updateReferences: true }),
      }))
      expect(rename.status).toBe(200)
      const body = await rename.json() as { updatedReferences: Array<{ path: string }> }
      // Exactly the locked backlink was rewritten — nothing more.
      expect(body.updatedReferences.map((item) => item.path)).toEqual(['ref-a'])
      expect(await fs.readFile(path.join(sandbox, 'ref-a.md'), 'utf8')).toBe('# a\nsee [[renamed]]')
      expect(await fs.readFile(path.join(sandbox, 'renamed.md'), 'utf8')).toBe('# src')
      // late-b kept exactly the body its own save wrote: the rename
      // never touched a document whose lock it did not hold.
      expect(putResponse).not.toBeNull()
      expect(await fs.readFile(path.join(sandbox, 'late-b.md'), 'utf8')).toBe('# b\nnow links [[src]]')
    } finally {
      __setPostRenameRaceHooksForTesting(null)
    }
  })
})

describe('round 5: rename destinations are create-only (external writer wins)', () => {
  it('REST rename returns 409 and preserves an external file created after the destination check', async () => {
    // POSIX rename(2) atomically REPLACES the target: the exists()
    // check at the route top cannot protect an external editor that
    // claims the destination before the move runs. The create-only
    // move (link(2)) must fail closed with the external bytes intact.
    await get('/api/links/index')
    const external = '# external writer\n'
    __setPostRenameRaceHooksForTesting({
      afterRenamePlanBuilt: async () => {
        await fs.writeFile(path.join(sandbox, 'renamed-b.md'), external, 'utf8')
      },
    })
    try {
      const renamed = await app.fetch(new Request('http://localhost/api/posts/b', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'renamed-b', updateReferences: true }),
      }))
      expect(renamed.status).toBe(409)
      expect(await renamed.json()).toMatchObject({
        error: expect.stringMatching(/claimed by an external writer/),
      })
      // The external file wins; the source is restored untouched.
      expect(await fs.readFile(path.join(sandbox, 'renamed-b.md'), 'utf8')).toBe(external)
      expect(await fs.readFile(path.join(sandbox, 'b.md'), 'utf8')).toBe('# b\nsee [a](a.md)')
      const names = await fs.readdir(sandbox)
      expect(names.some((name) => name.includes('.docus-rename-'))).toBe(false)
      expect(names.some((name) => name.includes('.docus-staged-'))).toBe(false)
    } finally {
      __setPostRenameRaceHooksForTesting(null)
    }
  })

  it('folder rename returns 409 and preserves an external folder created after the destination check', async () => {
    await fs.mkdir(path.join(sandbox, 'notes'))
    await fs.writeFile(path.join(sandbox, 'notes', 'a.md'), '# a', 'utf8')
    __setFolderRaceHooksForTesting({
      afterRenameRecheck: async () => {
        await fs.mkdir(path.join(sandbox, 'renamed'))
        await fs.writeFile(path.join(sandbox, 'renamed', 'external.md'), '# external', 'utf8')
      },
    })
    try {
      const response = await app.fetch(new Request('http://localhost/api/folders/notes', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPath: 'renamed' }),
      }))
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({
        error: expect.stringMatching(/claimed by an external writer/),
      })
      // External folder untouched; source tree intact; no journal leak.
      expect(await fs.readFile(path.join(sandbox, 'renamed', 'external.md'), 'utf8')).toBe('# external')
      expect(await fs.readFile(path.join(sandbox, 'notes', 'a.md'), 'utf8')).toBe('# a')
      expect((await fs.readdir(sandbox)).some((name) => name.includes('.docus-journal-'))).toBe(false)
    } finally {
      __setFolderRaceHooksForTesting(null)
    }
  })
})

describe('round 5: rename rollback never overwrites a re-used source path', () => {
  it('REST rename keeps the document at the new path when the source was re-used externally during rollback', async () => {
    // Reviewer scenario: the move lands, a reference write then fails,
    // and an external writer re-creates the SOURCE path during the
    // rollback window. A plain rename-back would overwrite the
    // external file; the create-only rollback fails closed instead,
    // keeps the bytes at the destination, and the documentId follows.
    saveDocumentMetadata(db, { id: 'b-original-id', path: 'b', title: 'B' })
    await get('/api/links/index')
    const externalSource = '# external source reuse\n'
    const externalRef = '# a\nexternal save\nsee [[b]]\n'
    __setPostRenameRaceHooksForTesting({
      afterRenameMoved: async () => {
        // Re-use the now-empty source path AND dirty a reference file
        // so the reference write loop fails into the rollback.
        await fs.writeFile(path.join(sandbox, 'b.md'), externalSource, 'utf8')
        await fs.writeFile(path.join(sandbox, 'a.md'), externalRef, 'utf8')
      },
    })
    try {
      const renamed = await app.fetch(new Request('http://localhost/api/posts/b', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'renamed-b', updateReferences: true }),
      }))
      expect(renamed.status).toBe(409)
      expect(await renamed.json()).toMatchObject({
        error: expect.stringMatching(/re-used externally during rollback/),
      })
      // External source file untouched; our bytes kept at the destination.
      expect(await fs.readFile(path.join(sandbox, 'b.md'), 'utf8')).toBe(externalSource)
      expect(await fs.readFile(path.join(sandbox, 'renamed-b.md'), 'utf8')).toBe('# b\nsee [a](a.md)')
      // The external reference save wins over our undone rewrite.
      expect(await fs.readFile(path.join(sandbox, 'a.md'), 'utf8')).toBe(externalRef)
      // Identity follows the bytes: the documentId lives at the new path.
      expect(getDocumentMetadata(db, 'renamed-b')?.id).toBe('b-original-id')
      expect(getDocumentMetadata(db, 'b')).toBeNull()
      expect((await fs.readdir(sandbox)).some((name) => name.includes('.docus-rename-'))).toBe(false)
    } finally {
      __setPostRenameRaceHooksForTesting(null)
    }
  })

  it('folder rename keeps the tree at the new path when the source folder was re-used externally during rollback', async () => {
    await fs.mkdir(path.join(sandbox, 'notes'))
    await fs.writeFile(path.join(sandbox, 'notes', 'a.md'), '# a', 'utf8')
    await fs.writeFile(path.join(sandbox, 'ext.md'), 'see [[notes/a]]', 'utf8')
    saveDocumentMetadata(db, { id: 'notes-a-id', path: 'notes/a', title: 'A' })
    await get('/api/links/index')
    const externalRef = 'see [[notes/a]] external save'
    __setFolderRaceHooksForTesting({
      afterRenamePlanBuilt: async () => {
        // Re-create the source folder externally AND dirty the
        // reference file so the reference writes fail into rollback.
        await fs.mkdir(path.join(sandbox, 'notes'))
        await fs.writeFile(path.join(sandbox, 'notes', 'external.md'), '# external', 'utf8')
        await fs.writeFile(path.join(sandbox, 'ext.md'), externalRef, 'utf8')
      },
    })
    try {
      const response = await app.fetch(new Request('http://localhost/api/folders/notes', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPath: 'renamed', updateReferences: true }),
      }))
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({
        error: expect.stringMatching(/re-used externally during rollback/),
      })
      // External folder untouched; our tree kept at the destination.
      expect(await fs.readFile(path.join(sandbox, 'notes', 'external.md'), 'utf8')).toBe('# external')
      expect(await fs.readFile(path.join(sandbox, 'renamed', 'a.md'), 'utf8')).toBe('# a')
      expect(await fs.readFile(path.join(sandbox, 'ext.md'), 'utf8')).toBe(externalRef)
      // Identity follows the bytes: the whole prefix moved to the new path.
      expect(getDocumentMetadata(db, 'renamed/a')?.id).toBe('notes-a-id')
      expect(getDocumentMetadata(db, 'notes/a')).toBeNull()
    } finally {
      __setFolderRaceHooksForTesting(null)
    }
  })
})
