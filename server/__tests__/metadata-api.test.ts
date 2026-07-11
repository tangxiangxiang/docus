import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import app, { __setMetadataDbForTesting } from '../index'
import { applyMigrations } from '../db'
import { getDocumentMetadata } from '../documentMetadata'
import { migrateVaultMetadata } from '../metadataMigration'

let root: string
const db = new Database(':memory:')
db.pragma('foreign_keys = ON')
applyMigrations(db)

vi.mock('../paths.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../paths.js')>()
  return { ...original, filePathFor: (documentPath: string) => path.join(root, `${documentPath}.md`) }
})

beforeAll(() => __setMetadataDbForTesting(db))
afterAll(() => { __setMetadataDbForTesting(null); db.close() })

beforeEach(async () => {
  db.exec('DELETE FROM documents; DELETE FROM tags;')
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-metadata-api-'))
  await fs.mkdir(path.join(root, 'inbox'), { recursive: true })
})

afterEach(async () => fs.rm(root, { recursive: true, force: true }))

async function patch(documentPath: string, body: unknown) {
  return app.fetch(new Request(`http://localhost/api/metadata/documents/${documentPath}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

async function post(urlPath: string, body: unknown) {
  return app.fetch(new Request(`http://localhost${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

describe('PATCH /api/metadata/documents/*', () => {
  it('imports legacy metadata, updates SQLite, and leaves Markdown unchanged', async () => {
    const raw = '---\ntitle: Legacy\ntags: [old]\n---\n\n# Body\n'
    await fs.writeFile(path.join(root, 'inbox', 'note.md'), raw, 'utf8')
    const response = await patch('inbox/note', {
      title: 'Database title', summary: 'For retrieval', tags: ['rag', 'RAG'], aliases: ['Note'],
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      path: 'inbox/note', title: 'Database title', summary: 'For retrieval', tags: ['rag'], aliases: ['Note'],
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
