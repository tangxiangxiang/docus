import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import app from '../index'
import { POSTS_DIR } from '../paths'

const TEST_PATH = 'posts/put-smoke.md'
const TEST_ABS = path.join(POSTS_DIR, 'put-smoke.md')
const ORIGINAL = '---\ntitle: smoke\n---\n\noriginal\n'
const UPDATED = '---\ntitle: smoke\n---\n\nupdated content\n'

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
    await fs.mkdir(POSTS_DIR, { recursive: true })
    await fs.writeFile(TEST_ABS, ORIGINAL, 'utf8')
  })

  afterAll(async () => {
    await fs.rm(TEST_ABS, { force: true })
  })

  it('writes raw content to an existing file', async () => {
    const r = await call('PUT', '/api/posts/put-smoke', { raw: UPDATED })
    expect(r.status).toBe(200)
    const onDisk = await fs.readFile(TEST_ABS, 'utf8')
    expect(onDisk).toBe(UPDATED)
  })

  it('returns 404 for non-existent file', async () => {
    const r = await call('PUT', '/api/posts/does-not-exist-xyz', { raw: 'x' })
    expect(r.status).toBe(404)
  })

  it('rejects body without raw string', async () => {
    const r = await call('PUT', '/api/posts/put-smoke', { foo: 'bar' })
    expect(r.status).toBe(400)
  })

  it('restores original content for downstream tests', async () => {
    const r = await call('PUT', '/api/posts/put-smoke', { raw: ORIGINAL })
    expect(r.status).toBe(200)
    const onDisk = await fs.readFile(TEST_ABS, 'utf8')
    expect(onDisk).toBe(ORIGINAL)
  })
})
