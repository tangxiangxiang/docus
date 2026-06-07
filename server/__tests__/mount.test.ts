// Smoke test: hit the AI sub-router through the real `app` to
// confirm server/index.ts mounts it correctly at /api/ai. This
// test does NOT mock getDb, so the first request creates
// ./data/docus.db on disk; we clean it up in afterAll so the
// repo's working tree stays clean.
import { describe, it, expect, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import app from '../index'

const DATA_DIR = path.resolve(process.cwd(), 'data')

describe('app mounts /api/ai', () => {
  afterAll(async () => {
    // Tear down the on-disk DB that the first request created.
    // The data/ dir is gitignored, but we still want it gone so
    // the next test run starts clean.
    await fs.rm(DATA_DIR, { recursive: true, force: true })
  })

  it('GET /api/ai/sessions reaches the AI sub-router (returns 200 + [])', async () => {
    const req = new Request('http://localhost/api/ai/sessions')
    const r = await app.fetch(req)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual([])
  })

  it('GET /api/ai/health on the parent app also works (sanity)', async () => {
    // The original /api/health route is preserved — this just
    // guards against a mounting mistake that breaks the parent.
    const req = new Request('http://localhost/api/health')
    const r = await app.fetch(req)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
  })
})
