// Batch write tests. We hit the route in-process and inspect the
// resulting files on disk under a temp directory.
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import Database from 'better-sqlite3'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createDraftRoutes } from '../drafts.js'
import { createZettelRoutes } from '../zettel.js'
import { applyMigrations } from '../db.js'
import { getDocumentMetadata } from '../documentMetadata.js'

// Stub resolveApiKey so the route doesn't 503.
vi.mock('../ai/llm.js', () => ({ resolveApiKey: () => 'test-key' }))

// Redirect filePathFor into a per-test temp dir so the test never
// touches the user's real zettel/ subtree. Same pattern as the
// split.test.ts fragility fix.
let tmpRoot: string
vi.mock('../paths.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../paths.js')>()
  return {
    ...mod,
    filePathFor: (p: string) => path.join(tmpRoot, p + '.md'),
  }
})

const db = new Database(':memory:')
db.pragma('foreign_keys = ON')
applyMigrations(db)
const draftsRoutes = createDraftRoutes(() => db)
const zettelRoutes = createZettelRoutes(() => db)

beforeEach(async () => {
  db.exec('DELETE FROM documents; DELETE FROM tags;')
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-zettel-test-'))
  await fs.mkdir(path.join(tmpRoot, 'inbox', 'draft'), { recursive: true })
  await fs.mkdir(path.join(tmpRoot, 'literature', 'draft'), { recursive: true })
})

afterAll(() => db.close())

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

function postJson(body: unknown, route = '/batch'): Request {
  return new Request(`http://localhost${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/drafts/batch', () => {
  it('writes inbox cards to inbox/draft/ and reports all as written', async () => {
    const res = await draftsRoutes.request(postJson({
      cards: [
        { title: 'Card 1', body: 'Body 1', tags: ['a'], slug: 'card-1', source: 'inbox/init' },
        { title: 'Card 2', body: 'Body 2', tags: ['b'], slug: 'card-2', source: 'inbox/init' },
        { title: 'Card 3', body: 'Body 3', tags: ['c'], slug: 'card-3', source: 'inbox/init' },
      ],
    }))
    expect(res.status).toBe(200)
    const body = await res.json() as { written: Array<{ slug: string; path: string }>; skipped: unknown[]; failed: unknown[] }
    expect(body.written).toHaveLength(3)
    expect(body.written.map((w) => w.slug).sort()).toEqual(['card-1', 'card-2', 'card-3'])
    // Files contain body content only; metadata is database-owned.
    expect(body.written.map((w) => w.path).sort()).toEqual([
      'inbox/draft/card-1',
      'inbox/draft/card-2',
      'inbox/draft/card-3',
    ])
    const raw1 = await fs.readFile(path.join(tmpRoot, 'inbox', 'draft', 'card-1.md'), 'utf8')
    expect(raw1).toBe('# Card 1\n\nBody 1')
    expect(getDocumentMetadata(db, 'inbox/draft/card-1')).toMatchObject({
      title: 'Card 1',
      tags: ['a'],
    })
    
  })

  it('writes literature cards to literature/draft/', async () => {
    const res = await draftsRoutes.request(postJson({
      cards: [
        { title: 'Card 1', body: 'Body 1', tags: ['book'], slug: 'card-1', source: 'literature/book' },
      ],
    }))
    expect(res.status).toBe(200)
    const body = await res.json() as { written: Array<{ slug: string; path: string }>; failed: unknown[] }
    expect(body.written).toEqual([{ slug: 'card-1', path: 'literature/draft/card-1' }])
    expect(body.failed).toEqual([])
    const raw = await fs.readFile(path.join(tmpRoot, 'literature', 'draft', 'card-1.md'), 'utf8')
    expect(raw).toBe('# Card 1\n\nBody 1')
    expect(getDocumentMetadata(db, 'literature/draft/card-1')?.tags).toEqual(['book'])
  })

  it('appends -2, -3 suffix on slug collision', async () => {
    // First write
    await draftsRoutes.request(postJson({
      cards: [{ title: 'a', body: 'b', tags: [], slug: 'dup', source: 'inbox/init' }],
    }))
    // Second write with the same slug
    const res = await draftsRoutes.request(postJson({
      cards: [{ title: 'a', body: 'b', tags: [], slug: 'dup', source: 'inbox/init' }],
    }))
    const body = await res.json() as { written: Array<{ slug: string; path: string }> }
    expect(body.written).toHaveLength(1)
    expect(body.written[0].slug).toBe('dup-2')
    expect(body.written[0].path).toBe('inbox/draft/dup-2')
  })

  it('rejects cards whose source is outside inbox/ or literature/', async () => {
    const res = await draftsRoutes.request(postJson({
      cards: [{ title: 'x', body: 'y', tags: [], slug: 's', source: 'zettel/init' }],
    }))
    expect(res.status).toBe(200)
    const body = await res.json() as { written: unknown[]; failed: Array<{ slug: string; reason: string }> }
    expect(body.written).toEqual([])
    expect(body.failed).toEqual([{ slug: 's', reason: 'source must be under inbox/ or literature/' }])
  })

  it('reports an invalid slug in failed[] (does not abort the batch)', async () => {
    const res = await draftsRoutes.request(postJson({
      cards: [{ title: 'x', body: 'y', tags: [], slug: 'BadSlug', source: 'inbox/init' }],
    }))
    expect(res.status).toBe(200)
    const body = await res.json() as { written: unknown[]; failed: Array<{ slug: string; reason: string }> }
    expect(body.failed).toHaveLength(1)
    expect(body.failed[0].slug).toBe('BadSlug')
    expect(body.failed[0].reason).toMatch(/invalid slug/i)
  })

  it('rejects empty body', async () => {
    const res = await draftsRoutes.request(new Request('http://localhost/batch', { method: 'POST' }))
    expect(res.status).toBe(400)
  })

  it('stores created and updated timestamps in the database', async () => {
    const res = await draftsRoutes.request(postJson({
      cards: [{ title: 't', body: 'b', tags: [], slug: 's', source: 'inbox/init' }],
    }))
    const metadata = getDocumentMetadata(db, 'inbox/draft/s')
    expect(metadata?.createdAt).toBeGreaterThan(0)
    expect(metadata?.updatedAt).toBe(metadata?.createdAt)
  })
})

describe('POST /api/zettel/draft/batch compatibility', () => {
  it('keeps the legacy zettel draft route working', async () => {
    const res = await zettelRoutes.request(postJson({
      cards: [{ title: 'Legacy', body: 'Body', tags: [], slug: 'legacy', source: 'inbox/init' }],
    }, '/draft/batch'))
    expect(res.status).toBe(200)
    const body = await res.json() as { written: Array<{ slug: string; path: string }> }
    expect(body.written).toEqual([{ slug: 'legacy', path: 'inbox/draft/legacy' }])
    expect(await fs.readFile(path.join(tmpRoot, 'inbox', 'draft', 'legacy.md'), 'utf8')).toBe('# Legacy\n\nBody')
    expect(getDocumentMetadata(db, 'inbox/draft/legacy')?.title).toBe('Legacy')
  })
})
