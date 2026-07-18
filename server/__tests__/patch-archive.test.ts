// PATCH /api/posts/* archive-note whitelist.
//
// The archive action and classified drops onto archive subfolders can land a
// file in archive/. The server is the second line of defense: PATCH must refuse
// any targetPath under archive/ unless the source currently lives under inbox/
// or literature/.
//
// We mock filePathFor into a per-test tmp dir (same pattern as
// get-post.test.ts and split.test.ts) so the test never touches the
// real src/content/ vault.
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import app, { __setMetadataDbForTesting } from '../index'
import { applyMigrations } from '../db'
import { getDocumentMetadata, saveDocumentMetadata } from '../documentMetadata'

let tmpRoot: string
const db = new Database(':memory:')
db.pragma('foreign_keys = ON')
applyMigrations(db)
vi.mock('../paths.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../paths.js')>()
  return {
    ...mod,
    filePathFor: (p: string) => path.join(tmpRoot, p + '.md'),
  }
})

async function patch(urlPath: string, body: unknown) {
  const req = new Request(`http://localhost${urlPath}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return app.fetch(req)
}

async function del(urlPath: string) {
  const req = new Request(`http://localhost${urlPath}`, { method: 'DELETE' })
  return app.fetch(req)
}

beforeEach(async () => {
  db.exec('DELETE FROM documents; DELETE FROM tags;')
  __setMetadataDbForTesting(db)
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-patch-archive-test-'))
  await fs.mkdir(path.join(tmpRoot, 'inbox'), { recursive: true })
  await fs.mkdir(path.join(tmpRoot, 'inbox', 'draft'), { recursive: true })
  await fs.mkdir(path.join(tmpRoot, 'literature'), { recursive: true })
  await fs.mkdir(path.join(tmpRoot, 'literature', 'draft'), { recursive: true })
  await fs.mkdir(path.join(tmpRoot, 'archive'), { recursive: true })
  await fs.mkdir(path.join(tmpRoot, 'projects'), { recursive: true })
  await fs.mkdir(path.join(tmpRoot, 'archive', 'concepts'), { recursive: true })
  await fs.writeFile(path.join(tmpRoot, 'inbox', 'foo.md'), '---\ntitle: Foo\n---\n\nbody\n', 'utf8')
  await fs.writeFile(path.join(tmpRoot, 'inbox', 'draft', 'draft-foo.md'), '---\ntitle: Draft Foo\n---\n\nbody\n', 'utf8')
  await fs.writeFile(path.join(tmpRoot, 'literature', 'ahrens.md'), '---\ntitle: Ahrens\n---\n\nbody\n', 'utf8')
  await fs.writeFile(path.join(tmpRoot, 'literature', 'draft', 'draft-ahrens.md'), '---\ntitle: Draft Ahrens\n---\n\nbody\n', 'utf8')
  await fs.writeFile(path.join(tmpRoot, 'projects', 'old.md'), '---\ntitle: Old\n---\n\nbody\n', 'utf8')
  await fs.writeFile(path.join(tmpRoot, 'archive', 'perm.md'), '---\ntitle: Perm\n---\n\nbody\n', 'utf8')
})

afterEach(async () => {
  __setMetadataDbForTesting(null)
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

afterAll(() => db.close())

describe('PATCH /api/posts/* archive-note whitelist', () => {
  it('moves inbox/foo.md to archive/foo.md', async () => {
    const r = await patch('/api/posts/inbox/foo', { targetPath: 'archive/foo' })
    expect(r.status).toBe(200)
    expect(await fs.stat(path.join(tmpRoot, 'archive', 'foo.md'))).toBeTruthy()
    // Source is gone.
    await expect(fs.stat(path.join(tmpRoot, 'inbox', 'foo.md'))).rejects.toThrow()
  })

  it('moves literature/ahrens.md to archive/ahrens.md', async () => {
    const r = await patch('/api/posts/literature/ahrens', { targetPath: 'archive/ahrens' })
    expect(r.status).toBe(200)
    expect(await fs.stat(path.join(tmpRoot, 'archive', 'ahrens.md'))).toBeTruthy()
  })

  it('moves inbox draft files to archive/<name>.md', async () => {
    const r = await patch('/api/posts/inbox/draft/draft-foo', { targetPath: 'archive/draft-foo' })
    expect(r.status).toBe(200)
    const body = await r.json() as { path: string }
    expect(body.path).toBe('archive/draft-foo')
    expect(await fs.stat(path.join(tmpRoot, 'archive', 'draft-foo.md'))).toBeTruthy()
  })

  it('moves literature draft files to archive/<name>.md', async () => {
    const r = await patch('/api/posts/literature/draft/draft-ahrens', { targetPath: 'archive/draft-ahrens' })
    expect(r.status).toBe(200)
    const body = await r.json() as { path: string }
    expect(body.path).toBe('archive/draft-ahrens')
    expect(await fs.stat(path.join(tmpRoot, 'archive', 'draft-ahrens.md'))).toBeTruthy()
  })

  it('appends a suffix when archiving into an existing archive path', async () => {
    await fs.writeFile(path.join(tmpRoot, 'archive', 'foo.md'), '---\ntitle: Existing Foo\n---\n\nbody\n', 'utf8')
    const r = await patch('/api/posts/inbox/foo', { targetPath: 'archive/foo' })
    expect(r.status).toBe(200)
    const body = await r.json() as { path: string }
    expect(body.path).toBe('archive/foo-2')
    expect(await fs.stat(path.join(tmpRoot, 'archive', 'foo-2.md'))).toBeTruthy()
  })

  it('moves inbox/foo.md to a archive subfolder for classified archiving', async () => {
    const r = await patch('/api/posts/inbox/foo', { targetPath: 'archive/concepts/foo' })
    expect(r.status).toBe(200)
    expect(await fs.stat(path.join(tmpRoot, 'archive', 'concepts', 'foo.md'))).toBeTruthy()
  })

  it('allows archive/* → archive/* reclassification', async () => {
    const r = await patch('/api/posts/archive/perm', { targetPath: 'archive/concepts/perm' })
    expect(r.status).toBe(200)
    expect(await fs.stat(path.join(tmpRoot, 'archive', 'concepts', 'perm.md'))).toBeTruthy()
  })

  it('refuses archive/* → inbox/* (permanent notes stay in archive)', async () => {
    const r = await patch('/api/posts/archive/perm', { targetPath: 'inbox/perm' })
    expect(r.status).toBe(422)
    expect(await fs.stat(path.join(tmpRoot, 'archive', 'perm.md'))).toBeTruthy()
    await expect(fs.stat(path.join(tmpRoot, 'inbox', 'perm.md'))).rejects.toThrow()
  })

  it('refuses archive rename via PATCH body.name (server backstop)', async () => {
    // The client hides the rename menu item inside archive via canModify,
    // but a non-UI caller hitting the API directly must still be blocked.
    const r = await patch('/api/posts/archive/perm', { name: 'renamed' })
    expect(r.status).toBe(422)
    expect(await fs.stat(path.join(tmpRoot, 'archive', 'perm.md'))).toBeTruthy()
    await expect(fs.stat(path.join(tmpRoot, 'archive', 'renamed.md'))).rejects.toThrow()
  })

  it('refuses DELETE inside archive/ (server backstop)', async () => {
    // Same rationale as the rename guard: the client hides the menu
    // item, but a non-UI caller hitting the API directly must be blocked.
    const r = await del('/api/posts/archive/perm')
    expect(r.status).toBe(422)
    expect(await fs.stat(path.join(tmpRoot, 'archive', 'perm.md'))).toBeTruthy()
  })

  it('treats case-variant Archive/ prefix as archive (refuses archive → non-archive move)', async () => {
    // isInArchive is case-insensitive on purpose: macOS APFS (the default
    // dev filesystem) collapses case variants to the same dir at the OS
    // level, so the protocol layer must too. Without this, a capital-A
    // path could escape the "archive notes stay in archive" gate.
    // Seed a file under the case-variant path and try to move it out.
    await fs.mkdir(path.join(tmpRoot, 'Archive'), { recursive: true })
    await fs.writeFile(path.join(tmpRoot, 'Archive', 'perm.md'), '---\ntitle: P\n---\n\nbody\n', 'utf8')
    const r = await patch('/api/posts/Archive/perm', { targetPath: 'inbox/perm' })
    expect(r.status).toBe(422)
    expect(await fs.stat(path.join(tmpRoot, 'Archive', 'perm.md'))).toBeTruthy()
    await expect(fs.stat(path.join(tmpRoot, 'inbox', 'perm.md'))).rejects.toThrow()
  })

  it('refuses projects/old.md → archive/old (source not in inbox/literature)', async () => {
    // The user-defined `projects/` folder is user content but not part
    // of the vault ingest flow — only inbox/ and literature/
    // notes are eligible to be archived.
    const r = await patch('/api/posts/projects/old', { targetPath: 'archive/old' })
    expect(r.status).toBe(422)
    // File must still exist at source — the move was rejected.
    expect(await fs.stat(path.join(tmpRoot, 'projects', 'old.md'))).toBeTruthy()
  })

  it('still allows ordinary inbox → literature moves (not blocked by whitelist)', async () => {
    // The whitelist only catches moves INTO archive/. Ordinary moves
    // between user folders must still work.
    const r = await patch('/api/posts/inbox/foo', { targetPath: 'literature/foo' })
    expect(r.status).toBe(200)
    expect(await fs.stat(path.join(tmpRoot, 'literature', 'foo.md'))).toBeTruthy()
  })

  it('preserves orphan metadata at the destination when rename fails', async () => {
    // The endpoint used to delete the destPath row BEFORE the fs.rename
    // ran, so any rename failure (cross-device, permission, etc.) left
    // the user with a wiped destPath row even though the file never
    // actually moved. Capture the orphan first and run the rename only
    // after we know it's about to succeed.
    saveDocumentMetadata(db, {
      path: 'archive/foo', title: 'Original Foo', summary: 'Important', tags: ['keep'],
    })
    const spy = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('simulated cross-device'))
    try {
      const r = await patch('/api/posts/inbox/foo', { targetPath: 'archive/foo' })
      expect(r.status).toBeGreaterThanOrEqual(500)
    } finally {
      spy.mockRestore()
    }
    expect(getDocumentMetadata(db, 'archive/foo')?.title).toBe('Original Foo')
    expect(getDocumentMetadata(db, 'archive/foo')?.tags).toEqual(['keep'])
    expect(await fs.readFile(path.join(tmpRoot, 'inbox', 'foo.md'), 'utf8')).toContain('Foo')
  })
})
