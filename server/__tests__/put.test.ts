import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import app, { __setMetadataDbForTesting } from '../index'
import { CONTENT_DIR } from '../paths'
import { applyMigrations } from '../db'
import { deleteDocumentMetadata, getDocumentMetadata, saveDocumentMetadata } from '../documentMetadata'
import type { SavePostResult } from '../../src/lib/api'

const TEST_PATH = 'put-smoke.md'
const TEST_ABS = path.join(CONTENT_DIR, 'put-smoke.md')
const ORIGINAL = '---\ntitle: smoke\n---\n\noriginal\n'
const UPDATED_BODY = '---\ntitle: smoke\n---\n\nupdated content\n'
const db = new Database(':memory:')
db.pragma('foreign_keys = ON')
applyMigrations(db)

async function call(method: string, urlPath: string, body?: unknown) {
  const req = new Request(`http://localhost${urlPath}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return app.fetch(req)
}

describe('PUT /api/posts/* (Task 7 smoke)', () => {
  beforeAll(async () => {
    __setMetadataDbForTesting(db)
    await fs.mkdir(CONTENT_DIR, { recursive: true })
    await fs.writeFile(TEST_ABS, ORIGINAL, 'utf8')
  })

  afterAll(async () => {
    __setMetadataDbForTesting(null)
    await fs.rm(TEST_ABS, { force: true })
    db.close()
  })

  it('writes raw content verbatim and updates metadata', async () => {
    saveDocumentMetadata(db, {
      path: 'put-smoke',
      title: 'Database title',
      summary: 'Database summary',
      tags: ['metadata', 'save'],
      createdAt: Date.UTC(2025, 0, 2),
      updatedAt: Date.UTC(2025, 0, 3),
    })
    const r = await call('PUT', '/api/posts/put-smoke', { raw: UPDATED_BODY })
    expect(r.status).toBe(200)
    const onDisk = await fs.readFile(TEST_ABS, 'utf8')
    // Content is byte-for-byte what the client submitted.
    expect(onDisk).toBe(UPDATED_BODY)
    const metadata = getDocumentMetadata(db, 'put-smoke')!
    expect(metadata.title).toBe('Database title')
    // The response mirrors the bytes persisted on disk.
    const body = (await r.json()) as SavePostResult
    const stat = await fs.stat(TEST_ABS)
    expect(body.ok).toBe(true)
    expect(body.raw).toBe(onDisk)
    expect(body.post).toEqual({
      path: 'put-smoke',
      title: metadata.title,
      created: new Date(metadata.createdAt).toISOString().slice(0, 10),
      updated: new Date(metadata.updatedAt).toISOString().slice(0, 10),
      tags: metadata.tags,
      summary: metadata.summary,
      size: stat.size,
      mtime: stat.mtimeMs,
    })
    expect(body.post).not.toHaveProperty('updatedReferences')
  })

  it('returns 404 for non-existent file', async () => {
    const r = await call('PUT', '/api/posts/does-not-exist-xyz', { raw: 'x' })
    expect(r.status).toBe(404)
  })

  it('rejects body without raw string', async () => {
    const r = await call('PUT', '/api/posts/put-smoke', { foo: 'bar' })
    expect(r.status).toBe(400)
  })

  it('does not insert or replace legacy updated fields', async () => {
    // Pre-write a file that already has an `updated` line, then PUT
    // a body without one — the server should overwrite, not stack.
    const abs = path.join(CONTENT_DIR, 'put-replace.md')
    await fs.writeFile(
      abs,
      `---\ntitle: replace\nupdated: 2020-01-01\n---\n\nbody\n`,
      'utf8',
    )
    try {
      const r = await call('PUT', '/api/posts/put-replace', {
        raw: '---\ntitle: replace\n---\n\nbody\n',
      })
      expect(r.status).toBe(200)
      const onDisk = await fs.readFile(abs, 'utf8')
      expect(onDisk).toBe('---\ntitle: replace\n---\n\nbody\n')
      expect(getDocumentMetadata(db, 'put-replace')?.title).toBe('replace')
    } finally {
      await fs.rm(abs, { force: true })
      deleteDocumentMetadata(db, 'put-replace')
    }
  })

  it('keeps body-only files free of Frontmatter', async () => {
    const abs = path.join(CONTENT_DIR, 'put-no-fm.md')
    await fs.writeFile(abs, '# Body only, no frontmatter\n', 'utf8')
    try {
      const r = await call('PUT', '/api/posts/put-no-fm', {
        raw: '# Body only, no frontmatter\n',
      })
      expect(r.status).toBe(200)
      const onDisk = await fs.readFile(abs, 'utf8')
      expect(onDisk).toBe('# Body only, no frontmatter\n')
      expect(getDocumentMetadata(db, 'put-no-fm')?.title).toBe('Body only, no frontmatter')
    } finally {
      await fs.rm(abs, { force: true })
      deleteDocumentMetadata(db, 'put-no-fm')
    }
  })

  it('imports legacy metadata before Frontmatter is removed', async () => {
    const abs = path.join(CONTENT_DIR, 'put-import-before-clean.md')
    await fs.writeFile(abs, [
      '---',
      'title: Imported title',
      'summary: Imported summary',
      'tags: [legacy, keep]',
      '---',
      '',
      '# Body title',
      '',
    ].join('\n'), 'utf8')
    try {
      const raw = '# Body title\n'
      const r = await call('PUT', '/api/posts/put-import-before-clean', { raw })
      expect(r.status).toBe(200)
      expect(await fs.readFile(abs, 'utf8')).toBe(raw)
      expect(getDocumentMetadata(db, 'put-import-before-clean')).toMatchObject({
        title: 'Imported title',
        summary: 'Imported summary',
        tags: ['keep', 'legacy'],
      })
    } finally {
      await fs.rm(abs, { force: true })
      deleteDocumentMetadata(db, 'put-import-before-clean')
    }
  })

  it('restores original content verbatim for downstream tests', async () => {
    const r = await call('PUT', '/api/posts/put-smoke', { raw: ORIGINAL })
    expect(r.status).toBe(200)
    const onDisk = await fs.readFile(TEST_ABS, 'utf8')
    expect(onDisk).toBe(ORIGINAL)
  })
})
