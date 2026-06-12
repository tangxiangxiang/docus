import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import app from '../index'
import { CONTENT_DIR } from '../paths'

const TEST_PATH = 'put-smoke.md'
const TEST_ABS = path.join(CONTENT_DIR, 'put-smoke.md')
const ORIGINAL = '---\ntitle: smoke\n---\n\noriginal\n'
const UPDATED_BODY = '---\ntitle: smoke\n---\n\nupdated content\n'

async function call(method: string, urlPath: string, body?: unknown) {
  const req = new Request(`http://localhost${urlPath}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return app.fetch(req)
}

const today = new Date().toISOString().slice(0, 10)

describe('PUT /api/posts/* (Task 7 smoke)', () => {
  beforeAll(async () => {
    await fs.mkdir(CONTENT_DIR, { recursive: true })
    await fs.writeFile(TEST_ABS, ORIGINAL, 'utf8')
  })

  afterAll(async () => {
    await fs.rm(TEST_ABS, { force: true })
  })

  it('writes raw content with `updated` bumped in the frontmatter', async () => {
    const r = await call('PUT', '/api/posts/put-smoke', { raw: UPDATED_BODY })
    expect(r.status).toBe(200)
    const onDisk = await fs.readFile(TEST_ABS, 'utf8')
    // The server appends an `updated:` line on save — title + body
    // are preserved verbatim, only the frontmatter grows.
    expect(onDisk).toBe(
      `---\ntitle: smoke\nupdated: ${today}\n---\n\nupdated content\n`,
    )
    // The response carries the post-bump `raw` so the client can
    // refresh its editor buffer to match what's on disk.
    const body = (await r.json()) as { ok: true; raw: string }
    expect(body.ok).toBe(true)
    expect(body.raw).toBe(onDisk)
  })

  it('returns 404 for non-existent file', async () => {
    const r = await call('PUT', '/api/posts/does-not-exist-xyz', { raw: 'x' })
    expect(r.status).toBe(404)
  })

  it('rejects body without raw string', async () => {
    const r = await call('PUT', '/api/posts/put-smoke', { foo: 'bar' })
    expect(r.status).toBe(400)
  })

  it('replaces an existing `updated` value rather than appending', async () => {
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
      // Exactly one `updated:` line, with today's date.
      expect(onDisk.match(/^updated:/gm)).toHaveLength(1)
      expect(onDisk).toContain(`updated: ${today}`)
      expect(onDisk).not.toContain('2020-01-01')
    } finally {
      await fs.rm(abs, { force: true })
    }
  })

  it('adds a frontmatter block with `updated` to a file that has none', async () => {
    const abs = path.join(CONTENT_DIR, 'put-no-fm.md')
    await fs.writeFile(abs, '# Body only, no frontmatter\n', 'utf8')
    try {
      const r = await call('PUT', '/api/posts/put-no-fm', {
        raw: '# Body only, no frontmatter\n',
      })
      expect(r.status).toBe(200)
      const onDisk = await fs.readFile(abs, 'utf8')
      expect(onDisk).toBe(
        `---\nupdated: ${today}\n---\n\n# Body only, no frontmatter\n`,
      )
    } finally {
      await fs.rm(abs, { force: true })
    }
  })

  it('restores original content (with bumped `updated`) for downstream tests', async () => {
    const r = await call('PUT', '/api/posts/put-smoke', { raw: ORIGINAL })
    expect(r.status).toBe(200)
    const onDisk = await fs.readFile(TEST_ABS, 'utf8')
    expect(onDisk).toBe(`---\ntitle: smoke\nupdated: ${today}\n---\n\noriginal\n`)
  })
})
