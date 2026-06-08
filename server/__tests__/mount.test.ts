// Smoke test: hit the AI sub-router through the real `app` to
// confirm server/index.ts mounts it correctly at /api/ai. This
// test does NOT mock getDb, so the first request creates
// ./data/docus.db on disk; we clean it up in afterAll so the
// repo's working tree stays clean.
import { describe, it, expect, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import app from '../index'

vi.mock('../ai/chat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ai/chat')>()
  return {
    ...actual,
    runChat: vi.fn(async ({ onEvent }: any) => {
      await onEvent({ type: 'user', id: 1 })
      await onEvent({ type: 'token', text: 'ok' })
      await onEvent({ type: 'done', userId: 1, assistantId: 2 })
      return { userId: 1, assistantId: 2, fullText: 'ok' }
    }),
  }
})

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

describe('app mounts /api/ai/chat', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY
  })

  it('POST /api/ai/chat returns a text/event-stream response', async () => {
    // Create a session first.
    const created = await app.fetch(new Request('http://localhost/api/ai/sessions', { method: 'POST' }))
    const { id } = await created.json() as { id: number }
    const r = await app.fetch(new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: id, content: 'hi' }),
    }))
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toMatch(/text\/event-stream/)
    const text = await r.text()
    expect(text).toContain('event: user')
    expect(text).toContain('event: done')
  })
})
