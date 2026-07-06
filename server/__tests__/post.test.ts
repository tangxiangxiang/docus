// Smoke test for POST /api/posts. Verifies the on-disk frontmatter
// template (title / created / updated / tags / summary placeholder)
// matches the wire response, and that summary: '' is included so the
// line is visible in the editor as a fillable field.

import { describe, it, expect, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import app from '../index'
import { CONTENT_DIR } from '../paths'

const TEST_PATH = 'post-smoke'
const TEST_ABS = path.join(CONTENT_DIR, 'post-smoke.md')

async function call(method: string, urlPath: string, body?: unknown) {
  const req = new Request(`http://localhost${urlPath}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return app.fetch(req)
}

const today = new Date().toISOString().slice(0, 10)

afterAll(async () => {
  await fs.rm(TEST_ABS, { force: true })
})

describe('POST /api/posts', () => {
  it('creates a file with the full frontmatter template (incl. empty `summary` placeholder)', async () => {
    const r = await call('POST', '/api/posts', { path: TEST_PATH, title: 'Smoke' })
    expect(r.status).toBe(201)

    const onDisk = await fs.readFile(TEST_ABS, 'utf8')
    // The template is fixed: title/created/updated/tags/summary in
    // that order, all on their own lines, with a single H1 body. The
    // bare `summary:` (no value) placeholder is the only new line vs.
    // the pre-7bbf692 template — see the comment in server/index.ts
    // for the rationale. gray-matter parses it as null, so the API
    // response surfaces `summary: ''` (same as a missing field).
    expect(onDisk).toBe(
      `---\ntitle: Smoke\ncreated: ${today}\nupdated: ${today}\ntags: []\nsummary:\n---\n\n# Smoke\n`,
    )

    // The response mirrors the same shape and includes `summary: ''` —
    // so the client search index can distinguish "no summary written"
    // from "file was missing frontmatter entirely" (both currently
    // produce empty strings; this just keeps the wire shape consistent
    // with the on-disk template).
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
      expect(onDisk).toContain('title: post-no-title')
      expect(onDisk).toContain('# post-no-title\n')
    } finally {
      await fs.rm(abs2, { force: true })
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

  it('rejects case-variant Zettel/ prefix (case-insensitive isInZettel guard)', async () => {
    // On macOS APFS `Zettel/...` is the same directory as `zettel/...`,
    // so the guard must catch case variants too. Without this, a client
    // could POST `Zettel/note` and create a parallel namespace on Linux
    // or a colliding file on macOS.
    const r = await call('POST', '/api/posts', { path: 'Zettel/direct', title: 'Direct' })
    expect(r.status).toBe(422)
    await expect(fs.stat(path.join(CONTENT_DIR, 'Zettel', 'direct.md'))).rejects.toThrow()
  })
})
