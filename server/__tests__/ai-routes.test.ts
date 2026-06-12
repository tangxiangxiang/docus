// HTTP-level tests for the /api/ai sub-router. We mock ../db's
// getDb() to return a fresh in-memory DB per test — the on-disk
// ./data/docus.db is never touched. The mock uses vi.mock with a
// vi.hoisted handle so the factory can close over the test DB
// reference (vi.mock is hoisted above top-level imports).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { applyMigrations } from '../db'

// vi.hoisted runs synchronously before imports are resolved, so the
// factory must be sync. Only `testDbRef` lives in the hoisted scope
// (the mock factory closes over it); `applyMigrations` is imported
// directly because it does not depend on the mocked getDb.
const { testDbRef } = vi.hoisted(() => ({
  testDbRef: { value: null as Database.Database | null },
}))

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>()
  return {
    ...actual,
    getDb: () => testDbRef.value!,
  }
})

// Import AFTER vi.mock so ai/routes.ts picks up the mocked getDb.
import aiRoutes from '../ai/routes'

beforeEach(() => {
  const db = new Database(':memory:')
  applyMigrations(db)
  testDbRef.value = db
})

afterEach(() => {
  testDbRef.value?.close()
  testDbRef.value = null
})

async function call(method: string, urlPath: string, body?: unknown) {
  const req = new Request(`http://localhost${urlPath}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return aiRoutes.fetch(req)
}

describe('GET /api/ai/sessions', () => {
  it('returns an empty array when no sessions exist', async () => {
    const r = await call('GET', '/sessions')
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual([])
  })

  it('returns all sessions newest-first', async () => {
    // Create two sessions, sleep a tick, create a third.
    await call('POST', '/sessions')
    await new Promise((r) => setTimeout(r, 2))
    await call('POST', '/sessions')
    const r = await call('GET', '/sessions')
    const list = await r.json() as { id: number }[]
    expect(list).toHaveLength(2)
    expect(list[0].id).toBeGreaterThan(list[1].id)
  })
})

describe('POST /api/ai/sessions', () => {
  it('creates a session and returns it with status 201', async () => {
    const r = await call('POST', '/sessions')
    expect(r.status).toBe(201)
    const body = await r.json() as { id: number; title: string }
    expect(body.id).toBeGreaterThan(0)
    expect(body.title).toBe('')
  })
})

describe('PATCH /api/ai/sessions/:id', () => {
  it('renames a session and returns it', async () => {
    const created = (await (await call('POST', '/sessions')).json()) as { id: number }
    const r = await call('PATCH', `/sessions/${created.id}`, { title: 'New name' })
    expect(r.status).toBe(200)
    const body = await r.json() as { title: string }
    expect(body.title).toBe('New name')
  })

  it('returns 400 when the title is empty after trim', async () => {
    const created = (await (await call('POST', '/sessions')).json()) as { id: number }
    const r = await call('PATCH', `/sessions/${created.id}`, { title: '   ' })
    expect(r.status).toBe(400)
  })

  it('returns 404 for a non-existent session', async () => {
    const r = await call('PATCH', '/sessions/999', { title: 'New name' })
    expect(r.status).toBe(404)
  })
})

describe('DELETE /api/ai/sessions/:id', () => {
  it('deletes a session and returns { ok: true }', async () => {
    const created = (await (await call('POST', '/sessions')).json()) as { id: number }
    const r = await call('DELETE', `/sessions/${created.id}`)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
  })

  it('returns 404 for a non-existent session', async () => {
    const r = await call('DELETE', '/sessions/999')
    expect(r.status).toBe(404)
  })
})

describe('GET /api/ai/sessions/:id/messages', () => {
  it('returns an empty array for a new session', async () => {
    const created = (await (await call('POST', '/sessions')).json()) as { id: number }
    const r = await call('GET', `/sessions/${created.id}/messages`)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual([])
  })

  it('returns 404 for a non-existent session', async () => {
    const r = await call('GET', '/sessions/999/messages')
    expect(r.status).toBe(404)
  })
})

describe('POST /api/ai/sessions/:id/messages', () => {
  it('appends a user message and returns the saved message', async () => {
    const created = (await (await call('POST', '/sessions')).json()) as { id: number }
    const r = await call('POST', `/sessions/${created.id}/messages`, { role: 'user', content: 'hello' })
    expect(r.status).toBe(201)
    const body = await r.json() as { id: number; role: string; content: string }
    expect(body.content).toBe('hello')
    expect(body.role).toBe('user')
  })

  it('returns 400 for empty content', async () => {
    const created = (await (await call('POST', '/sessions')).json()) as { id: number }
    const r = await call('POST', `/sessions/${created.id}/messages`, { role: 'user', content: '   ' })
    expect(r.status).toBe(400)
  })

  it('returns 400 for an invalid role', async () => {
    const created = (await (await call('POST', '/sessions')).json()) as { id: number }
    const r = await call('POST', `/sessions/${created.id}/messages`, { role: 'system', content: 'x' })
    expect(r.status).toBe(400)
  })

  it('returns 404 for a non-existent session', async () => {
    const r = await call('POST', '/sessions/999/messages', { role: 'user', content: 'x' })
    expect(r.status).toBe(404)
  })
})

describe('GET /api/ai/active', () => {
  it('returns { activeId: null, configured: <bool> } when no active session', async () => {
    const prev = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'test-key'
    try {
      const r = await call('GET', '/active')
      expect(r.status).toBe(200)
      const body = await r.json() as { activeId: number | null; configured: boolean }
      expect(body.activeId).toBeNull()
      expect(body.configured).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = prev
    }
  })

  it('reports configured: false when neither ANTHROPIC_API_KEY nor ANTHROPIC_AUTH_TOKEN is set', async () => {
    const prevKey = process.env.ANTHROPIC_API_KEY
    const prevToken = process.env.ANTHROPIC_AUTH_TOKEN
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_AUTH_TOKEN
    try {
      const r = await call('GET', '/active')
      const body = await r.json() as { configured: boolean }
      expect(body.configured).toBe(false)
    } finally {
      if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey
      if (prevToken !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = prevToken
    }
  })

  it('reports configured: true when only ANTHROPIC_AUTH_TOKEN is set', async () => {
    const prevKey = process.env.ANTHROPIC_API_KEY
    const prevToken = process.env.ANTHROPIC_AUTH_TOKEN
    delete process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_AUTH_TOKEN = 'test-token'
    try {
      const r = await call('GET', '/active')
      const body = await r.json() as { configured: boolean }
      expect(body.configured).toBe(true)
    } finally {
      if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey
      else delete process.env.ANTHROPIC_API_KEY
      if (prevToken !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = prevToken
      else delete process.env.ANTHROPIC_AUTH_TOKEN
    }
  })
})

describe('PUT /api/ai/active', () => {
  it('sets the active session and round-trips on GET', async () => {
    const created = (await (await call('POST', '/sessions')).json()) as { id: number }
    const r = await call('PUT', '/active', { sessionId: created.id })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ sessionId: created.id })

    const get = await call('GET', '/active')
    const getBody = await get.json() as { activeId: number | null; configured: boolean }
    expect(getBody.activeId).toEqual(created.id)
  })

  it('clears the active session when sessionId is null', async () => {
    const created = (await (await call('POST', '/sessions')).json()) as { id: number }
    await call('PUT', '/active', { sessionId: created.id })
    const r = await call('PUT', '/active', { sessionId: null })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ sessionId: null })
  })

  it('returns 400 when sessionId is not a number or null', async () => {
    const r = await call('PUT', '/active', { sessionId: 'abc' })
    expect(r.status).toBe(400)
  })

  it('returns 404 when sessionId points to a non-existent session', async () => {
    const r = await call('PUT', '/active', { sessionId: 999 })
    expect(r.status).toBe(404)
  })
})

import * as chatModule from '../ai/chat'
import { ChatError } from '../ai/errors'

// We mock runChat so the route test doesn't drag in the SDK or
// need a real DB session for the chat flow. The mock emits the
// expected events: a user id, two tokens, and a done with both ids.
vi.mock('../ai/chat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ai/chat')>()
  return {
    ...actual,
    runChat: vi.fn(async ({ onEvent }: any) => {
      await onEvent({ type: 'user', id: 101 })
      await onEvent({ type: 'token', text: 'hello ' })
      await onEvent({ type: 'token', text: 'world' })
      await onEvent({ type: 'done', userId: 101, assistantId: 202 })
      return { userId: 101, assistantId: 202, fullText: 'hello world' }
    }),
  }
})

function sseBodyChunks(res: Response): Promise<string[]> {
  // Read the SSE body as a single string then split on \n\n blocks.
  return res.text().then((text) => {
    return text.split('\n\n').filter((b) => b.trim().length > 0)
  })
}

function parseEvent(block: string): { event: string; data: string } {
  const event = (block.match(/^event:\s*(.+)$/m) ?? ['', ''])[1].trim()
  const data = (block.match(/^data:\s*(.+)$/m) ?? ['', ''])[1].trim()
  return { event, data }
}

describe('POST /api/ai/chat', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_AUTH_TOKEN
  })

  it('returns 503 when no auth env var is set', async () => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_AUTH_TOKEN
    const r = await call('POST', '/chat', { sessionId: 1, content: 'hi' })
    expect(r.status).toBe(503)
    expect(await r.json()).toEqual({ ok: false, reason: 'no-api-key' })
  })

  it('returns 400 when the body is invalid', async () => {
    const r = await call('POST', '/chat', { content: 'hi' })
    expect(r.status).toBe(400)
  })

  it('streams user → token* → done in order on success', async () => {
    // Create a session so the body validates.
    const created = (await (await call('POST', '/sessions')).json()) as { id: number }
    const r = await call('POST', '/chat', { sessionId: created.id, content: 'hi' })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toMatch(/text\/event-stream/)
    const blocks = await sseBodyChunks(r)
    const events = blocks.map(parseEvent)
    expect(events.map((e) => e.event)).toEqual(['user', 'token', 'token', 'done'])
    expect(JSON.parse(events[0].data)).toEqual({ id: 101 })
    expect(JSON.parse(events[1].data)).toEqual({ text: 'hello ' })
    expect(JSON.parse(events[2].data)).toEqual({ text: 'world' })
    expect(JSON.parse(events[3].data)).toEqual({ userId: 101, assistantId: 202 })
  })

  it('emits an error event when runChat throws not-found', async () => {
    vi.mocked(chatModule.runChat).mockRejectedValueOnce(new ChatError('not-found'))
    // 999 is not a real session — the mock throws, so the route
    // emits the SSE error.
    const r = await call('POST', '/chat', { sessionId: 999, content: 'hi' })
    const blocks = await sseBodyChunks(r)
    const last = parseEvent(blocks[blocks.length - 1])
    expect(last.event).toBe('error')
    expect(JSON.parse(last.data)).toEqual({ reason: 'not-found' })
  })

  it('forwards noteAttachment from the request body into runChat opts', async () => {
    const created = (await (await call('POST', '/sessions')).json()) as { id: number }
    await call('POST', '/chat', {
      sessionId: created.id,
      content: 'hi',
      currentNotePath: 'inbox/foo.md',
      noteAttachment: {
        path: 'inbox/foo.md',
        truncated: true,
        originalCodepoints: 35_000,
        attachedCodepoints: 20_000,
      },
    })
    expect(vi.mocked(chatModule.runChat)).toHaveBeenCalledWith(
      expect.objectContaining({
        noteAttachment: {
          path: 'inbox/foo.md',
          truncated: true,
          originalCodepoints: 35_000,
          attachedCodepoints: 20_000,
        },
      }),
    )
  })

  it('drops a malformed noteAttachment silently (no crash, no noteAttachment on the call)', async () => {
    const created = (await (await call('POST', '/sessions')).json()) as { id: number }
    await call('POST', '/chat', {
      sessionId: created.id,
      content: 'hi',
      // All the wrong types — a client that sent garbage shouldn't
      // crash the stream.
      noteAttachment: { path: 42, truncated: 'yes', originalCodepoints: 'x' },
    })
    const lastCall = vi.mocked(chatModule.runChat).mock.calls.at(-1)![0]
    expect(lastCall.noteAttachment).toBeUndefined()
  })

  it('does not pass noteAttachment when the field is absent', async () => {
    const created = (await (await call('POST', '/sessions')).json()) as { id: number }
    await call('POST', '/chat', {
      sessionId: created.id,
      content: 'hi',
      currentNotePath: 'inbox/foo.md',
      // No noteAttachment on the wire.
    })
    const lastCall = vi.mocked(chatModule.runChat).mock.calls.at(-1)![0]
    expect(lastCall.noteAttachment).toBeUndefined()
    // currentNotePath is still forwarded (used by the system prompt).
    expect(lastCall.ctx).toEqual({ currentNotePath: 'inbox/foo.md' })
  })
})
