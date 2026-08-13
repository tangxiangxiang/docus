import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import app, { __setMetadataDbForTesting } from '../index'
import { applyMigrations } from '../db'
import { getDocumentMetadata, moveDocumentMetadata, saveDocumentMetadata } from '../documentMetadata'
import { migrateVaultMetadata } from '../metadataMigration'
import { closeAuthTestContext, createAuthenticatedTestContext, type AuthenticatedTestContext } from './helpers/auth'

let root: string
const db = new Database(':memory:')
db.pragma('foreign_keys = ON')
applyMigrations(db)
let auth: AuthenticatedTestContext

vi.mock('../paths.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../paths.js')>()
  return { ...original, filePathFor: (documentPath: string) => path.join(root, `${documentPath}.md`) }
})

beforeAll(() => {
  __setMetadataDbForTesting(db)
  auth = createAuthenticatedTestContext({ db })
})
afterAll(() => {
  closeAuthTestContext(auth)
  __setMetadataDbForTesting(null)
  db.close()
})

beforeEach(async () => {
  db.exec('DELETE FROM metadata_migrations; DELETE FROM documents; DELETE FROM tags;')
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-metadata-api-'))
  await fs.mkdir(path.join(root, 'inbox'), { recursive: true })
})

afterEach(async () => fs.rm(root, { recursive: true, force: true }))

async function patch(documentPath: string, body: unknown) {
  return app.fetch(new Request(`http://localhost/api/metadata/documents/${documentPath}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', Cookie: auth.cookie },
    body: JSON.stringify(body),
  }))
}

async function post(urlPath: string, body: unknown) {
  return app.fetch(new Request(`http://localhost${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Cookie: auth.cookie },
    body: JSON.stringify(body),
  }))
}

describe('PATCH /api/metadata/documents/*', () => {
  it('imports legacy metadata, updates SQLite, and leaves Markdown unchanged', async () => {
    const raw = '---\ntitle: Legacy\ntags: [old]\n---\n\n# Body\n'
    await fs.writeFile(path.join(root, 'inbox', 'note.md'), raw, 'utf8')
    await migrateVaultMetadata(db, root)
    const current = getDocumentMetadata(db, 'inbox/note')!
    const response = await patch('inbox/note', {
      title: 'Database title', summary: 'For retrieval', tags: ['rag', 'RAG'],
      expectedUpdatedAt: current.updatedAt,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      path: 'inbox/note', title: 'Database title', summary: 'For retrieval', tags: ['rag'],
    })
    expect(getDocumentMetadata(db, 'inbox/note')?.title).toBe('Database title')
    expect(await fs.readFile(path.join(root, 'inbox', 'note.md'), 'utf8')).toBe(raw)
  })

  it('validates title, summary, and list limits', async () => {
    await fs.writeFile(path.join(root, 'inbox', 'note.md'), '# Note\n', 'utf8')
    expect((await patch('inbox/note', { title: '' })).status).toBe(400)
    expect((await patch('inbox/note', { summary: 'x'.repeat(2001) })).status).toBe(400)
    expect((await patch('inbox/note', { tags: Array.from({ length: 51 }, (_, i) => `t${i}`) })).status).toBe(400)
  })

  it('preserves intervening tags for title/summary-only requests and rejects stale mixed tag replay', async () => {
    await fs.writeFile(path.join(root, 'inbox', 'note.md'), '# Note\n', 'utf8')
    await migrateVaultMetadata(db, root)
    const initial = getDocumentMetadata(db, 'inbox/note')!

    const liveTags = await patch('inbox/note', {
      tags: ['live'], expectedUpdatedAt: initial.updatedAt,
    })
    expect(liveTags.status).toBe(200)
    const afterTags = getDocumentMetadata(db, 'inbox/note')!

    const titleOnly = await patch('inbox/note', { title: 'New title' })
    expect(titleOnly.status).toBe(200)
    expect((await titleOnly.json()).tags).toEqual(['live'])
    const summaryOnly = await patch('inbox/note', { summary: 'New summary' })
    expect(summaryOnly.status).toBe(200)
    expect((await summaryOnly.json()).tags).toEqual(['live'])

    const stale = await patch('inbox/note', {
      title: 'Must not land', tags: ['stale'], expectedUpdatedAt: initial.updatedAt,
    })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ code: 'METADATA_VERSION_CONFLICT' })
    expect(getDocumentMetadata(db, 'inbox/note')).toMatchObject({
      title: 'New title', summary: 'New summary', tags: ['live'],
    })
    expect(getDocumentMetadata(db, 'inbox/note')!.updatedAt).toBeGreaterThan(afterTags.updatedAt)
  })

  it('requires an explicit version token for tags and does not mutate on rejection', async () => {
    await fs.writeFile(path.join(root, 'inbox', 'note.md'), '# Note\n', 'utf8')
    await migrateVaultMetadata(db, root)
    const before = getDocumentMetadata(db, 'inbox/note')!
    const response = await patch('inbox/note', { tags: ['new'] })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'INVALID_METADATA_CHANGE' })
    expect(getDocumentMetadata(db, 'inbox/note')).toEqual(before)
  })

  it('updates the title index only for an explicit title change', async () => {
    await fs.writeFile(path.join(root, 'inbox', 'note.md'), '# Note\n', 'utf8')
    await migrateVaultMetadata(db, root)
    const { getIndex } = await import('../linkIndex')
    const index = await getIndex()
    const setTitle = vi.spyOn(index, 'setTitle')
    try {
      expect((await patch('inbox/note', { summary: 'Summary' })).status).toBe(200)
      expect(setTitle).not.toHaveBeenCalled()
      expect((await patch('inbox/note', { title: 'Title' })).status).toBe(200)
      expect(setTitle).toHaveBeenCalledWith('inbox/note', 'Title')
    } finally {
      setTitle.mockRestore()
    }
  })

  it('returns 404 when the document does not exist', async () => {
    expect((await patch('inbox/missing', { title: 'Missing' })).status).toBe(404)
  })

  it('requires explicit cleanup confirmation and can restore original bytes', async () => {
    const raw = '---\ntitle: Note\ncustom: keep\n---\n\n# Body\n'
    await fs.writeFile(path.join(root, 'inbox', 'note.md'), raw, 'utf8')
    await migrateVaultMetadata(db, root)

    expect((await post('/api/metadata/cleanup', { paths: ['inbox/note'] })).status).toBe(400)
    const cleaned = await post('/api/metadata/cleanup', {
      paths: ['inbox/note'], confirm: 'REMOVE_FRONTMATTER',
    })
    expect(cleaned.status).toBe(200)
    expect(await fs.readFile(path.join(root, 'inbox', 'note.md'), 'utf8')).toBe('# Body\n')

    expect((await post('/api/metadata/restore', { paths: ['inbox/note'] })).status).toBe(400)
    const restored = await post('/api/metadata/restore', {
      paths: ['inbox/note'], mode: 'original', confirm: 'RESTORE_FRONTMATTER',
    })
    expect(restored.status).toBe(200)
    expect(await fs.readFile(path.join(root, 'inbox', 'note.md'), 'utf8')).toBe(raw)
  })
})

describe('GET /api/metadata/documents/:id', () => {
  async function getById(id: string) {
    return app.fetch(new Request(`http://localhost/api/metadata/documents/${id}`, { headers: { Cookie: auth.cookie } }))
  }

  it('returns the current metadata by stable id, with a version token', async () => {
    const saved = saveDocumentMetadata(db, { path: 'inbox/note', title: 'Note', summary: 'S' })
    const response = await getById(saved.id)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      id: saved.id, path: 'inbox/note', title: 'Note', summary: 'S', tags: [],
    })
    // updatedAt is the version token a draft-recovery path resolver
    // carries back — it must survive the round-trip.
    expect(typeof body.updatedAt).toBe('number')
    expect(body.updatedAt).toBe(saved.updatedAt)
  })

  it('reports the CURRENT path after a rename (stable identity, moving path)', async () => {
    const saved = saveDocumentMetadata(db, { path: 'inbox/note', title: 'Note' })
    expect(moveDocumentMetadata(db, 'inbox/note', 'archive/note')).toBe(true)
    const response = await getById(saved.id)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id: saved.id, path: 'archive/note',
    })
  })

  it('returns 404 for an unknown id', async () => {
    expect((await getById('no-such-id')).status).toBe(404)
  })
})
