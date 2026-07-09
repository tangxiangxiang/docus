// Batch write tests. We hit the route in-process and inspect the
// resulting files on disk under a temp directory.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zettelRoutes from '../zettel.js'

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

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-zettel-test-'))
  await fs.mkdir(path.join(tmpRoot, 'inbox', 'draft'), { recursive: true })
  await fs.mkdir(path.join(tmpRoot, 'literature', 'draft'), { recursive: true })
})

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

function postJson(body: unknown): Request {
  return new Request('http://localhost/draft/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/zettel/draft/batch', () => {
  it('writes inbox cards to inbox/draft/ and reports all as written', async () => {
    const res = await zettelRoutes.request(postJson({
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
    // Files actually exist with the expected frontmatter.
    expect(body.written.map((w) => w.path).sort()).toEqual([
      'inbox/draft/card-1',
      'inbox/draft/card-2',
      'inbox/draft/card-3',
    ])
    const raw1 = await fs.readFile(path.join(tmpRoot, 'inbox', 'draft', 'card-1.md'), 'utf8')
    expect(raw1).toMatch(/^---\n/)
    expect(raw1).toMatch(/title: Card 1/)
    expect(raw1).toMatch(/source: inbox\/init/)
    
  })

  it('writes literature cards to literature/draft/', async () => {
    const res = await zettelRoutes.request(postJson({
      cards: [
        { title: 'Card 1', body: 'Body 1', tags: ['book'], slug: 'card-1', source: 'literature/book' },
      ],
    }))
    expect(res.status).toBe(200)
    const body = await res.json() as { written: Array<{ slug: string; path: string }>; failed: unknown[] }
    expect(body.written).toEqual([{ slug: 'card-1', path: 'literature/draft/card-1' }])
    expect(body.failed).toEqual([])
    const raw = await fs.readFile(path.join(tmpRoot, 'literature', 'draft', 'card-1.md'), 'utf8')
    expect(raw).toMatch(/source: literature\/book/)
  })

  it('appends -2, -3 suffix on slug collision', async () => {
    // First write
    await zettelRoutes.request(postJson({
      cards: [{ title: 'a', body: 'b', tags: [], slug: 'dup', source: 'inbox/init' }],
    }))
    // Second write with the same slug
    const res = await zettelRoutes.request(postJson({
      cards: [{ title: 'a', body: 'b', tags: [], slug: 'dup', source: 'inbox/init' }],
    }))
    const body = await res.json() as { written: Array<{ slug: string; path: string }> }
    expect(body.written).toHaveLength(1)
    expect(body.written[0].slug).toBe('dup-2')
    expect(body.written[0].path).toBe('inbox/draft/dup-2')
  })

  it('rejects cards whose source is outside inbox/ or literature/', async () => {
    const res = await zettelRoutes.request(postJson({
      cards: [{ title: 'x', body: 'y', tags: [], slug: 's', source: 'zettel/init' }],
    }))
    expect(res.status).toBe(200)
    const body = await res.json() as { written: unknown[]; failed: Array<{ slug: string; reason: string }> }
    expect(body.written).toEqual([])
    expect(body.failed).toEqual([{ slug: 's', reason: 'source must be under inbox/ or literature/' }])
  })

  it('reports an invalid slug in failed[] (does not abort the batch)', async () => {
    const res = await zettelRoutes.request(postJson({
      cards: [{ title: 'x', body: 'y', tags: [], slug: 'BadSlug', source: 'inbox/init' }],
    }))
    expect(res.status).toBe(200)
    const body = await res.json() as { written: unknown[]; failed: Array<{ slug: string; reason: string }> }
    expect(body.failed).toHaveLength(1)
    expect(body.failed[0].slug).toBe('BadSlug')
    expect(body.failed[0].reason).toMatch(/invalid slug/i)
  })

  it('rejects empty body', async () => {
    const res = await zettelRoutes.request(new Request('http://localhost/draft/batch', { method: 'POST' }))
    expect(res.status).toBe(400)
  })

  it('includes created and updated dates in frontmatter', async () => {
    const res = await zettelRoutes.request(postJson({
      cards: [{ title: 't', body: 'b', tags: [], slug: 's', source: 'inbox/init' }],
    }))
    const raw = await fs.readFile(path.join(tmpRoot, 'inbox', 'draft', 's.md'), 'utf8')
    const today = new Date().toISOString().slice(0, 10)
    expect(raw).toMatch(new RegExp('created: ' + today))
    expect(raw).toMatch(new RegExp('updated: ' + today))
  })
})
