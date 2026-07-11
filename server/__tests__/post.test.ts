// Smoke test for POST /api/posts. Verifies body-only Markdown creation,
// database-owned metadata, and the compatible wire response.

import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import Database from 'better-sqlite3'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import app, { __setMetadataDbForTesting } from '../index'
import { CONTENT_DIR } from '../paths'
import { applyMigrations } from '../db'
import { deleteDocumentMetadata, getDocumentMetadata } from '../documentMetadata'

const TEST_PATH = 'post-smoke'
const TEST_ABS = path.join(CONTENT_DIR, 'post-smoke.md')
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

const today = new Date().toISOString().slice(0, 10)

beforeAll(() => __setMetadataDbForTesting(db))

afterAll(async () => {
  __setMetadataDbForTesting(null)
  await fs.rm(TEST_ABS, { force: true })
  db.close()
})

describe('POST /api/posts', () => {
  it('creates a body-only file and stores metadata in SQLite', async () => {
    const r = await call('POST', '/api/posts', { path: TEST_PATH, title: 'Smoke' })
    expect(r.status).toBe(201)

    const onDisk = await fs.readFile(TEST_ABS, 'utf8')
    expect(onDisk).toBe('# Smoke\n')
    expect(getDocumentMetadata(db, TEST_PATH)).toMatchObject({ title: 'Smoke', summary: '', tags: [] })

    // The response keeps the existing PostSummary shape for clients.
    const body = (await r.json()) as Record<string, unknown>
    expect(body.path).toBe(TEST_PATH)
    expect(body.title).toBe('Smoke')
    expect(body.created).toBe(today)
    expect(body.updated).toBe(today)
    expect(body.tags).toEqual([])
    expect(body.summary).toBe('')
  })

  it('uses the final path segment as the title when none is given', async () => {
    const path2 = 'post-no-title'
    const abs2 = path.join(CONTENT_DIR, 'post-no-title.md')
    try {
      const r = await call('POST', '/api/posts', { path: path2 })
      expect(r.status).toBe(201)
      const onDisk = await fs.readFile(abs2, 'utf8')
      expect(onDisk).toBe('# post-no-title\n')
      expect(getDocumentMetadata(db, path2)?.title).toBe('post-no-title')
    } finally {
      await fs.rm(abs2, { force: true })
      deleteDocumentMetadata(db, path2)
    }
  })

  it('rejects a path that already exists', async () => {
    // Re-using TEST_PATH from the first test — `afterAll` hasn't fired
    // yet, so the file should still be on disk.
    const r = await call('POST', '/api/posts', { path: TEST_PATH, title: 'Smoke' })
    expect(r.status).toBe(409)
  })

  it('rejects a request body without a path', async () => {
    const r = await call('POST', '/api/posts', { title: 'no path' })
    expect(r.status).toBe(400)
  })

  it('rejects non-English path segments', async () => {
    const r = await call('POST', '/api/posts', { path: 'inbox/第一性原理', title: '第一性原理' })
    expect(r.status).toBe(400)
  })

  it('allows a Chinese title when the path is an English slug', async () => {
    const path2 = 'post-chinese-title'
    const abs2 = path.join(CONTENT_DIR, 'post-chinese-title.md')
    try {
      const r = await call('POST', '/api/posts', { path: path2, title: '第一性原理' })
      expect(r.status).toBe(201)
      const onDisk = await fs.readFile(abs2, 'utf8')
      expect(onDisk).toBe('# 第一性原理\n')
      expect(getDocumentMetadata(db, path2)?.title).toBe('第一性原理')
    } finally {
      await fs.rm(abs2, { force: true })
      deleteDocumentMetadata(db, path2)
    }
  })

  it('rejects direct note creation inside zettel/', async () => {
    const r = await call('POST', '/api/posts', { path: 'zettel/direct', title: 'Direct' })
    expect(r.status).toBe(422)
    await expect(fs.stat(path.join(CONTENT_DIR, 'zettel', 'direct.md'))).rejects.toThrow()
  })

  it('allows organizational folder creation inside zettel/', async () => {
    const folder = path.join(CONTENT_DIR, 'zettel', 'concepts-test')
    try {
      const r = await call('POST', '/api/folders', { path: 'zettel/concepts-test' })
      expect(r.status).toBe(201)
      await expect(fs.stat(folder)).resolves.toBeTruthy()
    } finally {
      await fs.rm(folder, { recursive: true, force: true })
    }
  })

  it('rejects case-variant Zettel/ prefix before it can create a file', async () => {
    // The strict path validator now rejects uppercase path segments before
    // the case-insensitive zettel policy guard runs. The important contract
    // is unchanged: a client cannot POST `Zettel/note` and create a parallel
    // namespace on Linux or a colliding file on macOS.
    const r = await call('POST', '/api/posts', { path: 'Zettel/direct', title: 'Direct' })
    expect(r.status).toBe(400)
    await expect(fs.stat(path.join(CONTENT_DIR, 'Zettel', 'direct.md'))).rejects.toThrow()
  })

  it('returns 400 (not 500) for a whitespace-only title', async () => {
    // saveDocumentMetadata throws on a blank title, which used to bubble
    // out of the route as an unhandled 500. Validate at the boundary so
    // malformed client input is reported as 400.
    const abs = path.join(CONTENT_DIR, 'post-whitespace.md')
    try {
      const r = await call('POST', '/api/posts', { path: 'post-whitespace', title: '   ' })
      expect(r.status).toBe(400)
      await expect(fs.stat(abs)).rejects.toThrow()
    } finally {
      await fs.rm(abs, { force: true })
      deleteDocumentMetadata(db, 'post-whitespace')
    }
  })

  it('rejects invalid title input before creating parent directories', async () => {
    const parent = path.join(CONTENT_DIR, 'post-invalid-parent', 'nested')
    try {
      const whitespace = await call('POST', '/api/posts', {
        path: 'post-invalid-parent/nested/blank', title: '   ',
      })
      expect(whitespace.status).toBe(400)
      await expect(fs.stat(parent)).rejects.toThrow()

      const wrongType = await call('POST', '/api/posts', {
        path: 'post-invalid-parent/nested/number', title: 123,
      })
      expect(wrongType.status).toBe(400)
      await expect(fs.stat(parent)).rejects.toThrow()
    } finally {
      await fs.rm(path.join(CONTENT_DIR, 'post-invalid-parent'), { recursive: true, force: true })
    }
  })
})
