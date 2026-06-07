// Tests for the typed fetch wrappers. We stub global.fetch so no
// real network is hit; the assertions are about request shape
// (method, URL, body) and response mapping.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as api from '../ai-api'
import { streamChat } from '../ai-api'

type FetchCall = { url: string; init: RequestInit }

let calls: FetchCall[] = []
let responses: { status: number; body: unknown }[] = []

beforeEach(() => {
  calls = []
  responses = []
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const next = responses.shift() ?? { status: 200, body: {} }
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
})

describe('ai-api', () => {
  it('listSessions GETs /api/ai/sessions', async () => {
    responses.push({ status: 200, body: [{ id: 1, title: 'x', createdAt: 1, updatedAt: 2 }] })
    const list = await api.listSessions()
    expect(calls[0].url).toBe('/api/ai/sessions')
    expect(calls[0].init.method).toBe('GET')
    expect(list).toEqual([{ id: 1, title: 'x', createdAt: 1, updatedAt: 2 }])
  })

  it('createSessions POSTs to /api/ai/sessions', async () => {
    responses.push({ status: 201, body: { id: 7, title: '', createdAt: 1, updatedAt: 1 } })
    const s = await api.createSession()
    expect(calls[0].url).toBe('/api/ai/sessions')
    expect(calls[0].init.method).toBe('POST')
    expect(s.id).toBe(7)
  })

  it('renameSession PATCHes with the title body', async () => {
    responses.push({ status: 200, body: { id: 1, title: 'New', createdAt: 1, updatedAt: 1 } })
    await api.renameSession(1, 'New')
    expect(calls[0].url).toBe('/api/ai/sessions/1')
    expect(calls[0].init.method).toBe('PATCH')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ title: 'New' })
  })

  it('deleteSession DELETEs the session', async () => {
    responses.push({ status: 200, body: { ok: true } })
    await api.deleteSession(1)
    expect(calls[0].url).toBe('/api/ai/sessions/1')
    expect(calls[0].init.method).toBe('DELETE')
  })

  it('listMessages GETs /api/ai/sessions/:id/messages', async () => {
    responses.push({ status: 200, body: [{ id: 1, sessionId: 1, role: 'user', content: 'hi', createdAt: 1 }] })
    const list = await api.listMessages(1)
    expect(calls[0].url).toBe('/api/ai/sessions/1/messages')
    expect(list[0].content).toBe('hi')
  })

  it('appendMessage POSTs to /api/ai/sessions/:id/messages with role and content', async () => {
    responses.push({ status: 201, body: { id: 9, sessionId: 1, role: 'user', content: 'x', createdAt: 1 } })
    await api.appendMessage(1, 'user', 'x')
    expect(calls[0].url).toBe('/api/ai/sessions/1/messages')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ role: 'user', content: 'x' })
  })

  it('getActiveSessionId returns just the activeId from /api/ai/active', async () => {
    responses.push({ status: 200, body: { activeId: 42, configured: true } })
    const id = await api.getActiveSessionId()
    expect(calls[0].url).toBe('/api/ai/active')
    expect(id).toBe(42)
  })

  it('setActiveSessionId PUTs to /api/ai/active', async () => {
    responses.push({ status: 200, body: { sessionId: 42 } })
    await api.setActiveSessionId(42)
    expect(calls[0].url).toBe('/api/ai/active')
    expect(calls[0].init.method).toBe('PUT')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ sessionId: 42 })
  })

  it('throws with the server error message on a 4xx response', async () => {
    responses.push({ status: 404, body: { error: 'not found' } })
    await expect(api.getActiveSessionId()).rejects.toMatchObject({ status: 404 })
  })
})

// Build a Response whose body is a ReadableStream of UTF-8 bytes
// carrying the given SSE text. Mirrors what Hono's streamSSE
// actually emits on the wire.
function sseResponse(events: { event: string; data: unknown }[]): Response {
  const text = events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('')
  const enc = new TextEncoder()
  return new Response(enc.encode(text), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('streamChat', () => {
  it('yields typed ChatEvents in order from a streaming SSE response', async () => {
    const events = [
      { event: 'user', data: { id: 11 } },
      { event: 'token', data: { text: 'a' } },
      { event: 'token', data: { text: 'b' } },
      { event: 'done', data: { userId: 11, assistantId: 12 } },
    ]
    globalThis.fetch = vi.fn(async () => sseResponse(events)) as unknown as typeof fetch
    const collected: unknown[] = []
    for await (const ev of streamChat({ sessionId: 1, content: 'x' })) {
      collected.push(ev)
    }
    expect(collected).toEqual([
      { type: 'user', id: 11 },
      { type: 'token', text: 'a' },
      { type: 'token', text: 'b' },
      { type: 'done', userId: 11, assistantId: 12 },
    ])
  })

  it('yields { type: error } on a non-2xx response', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ reason: 'no-api-key' }), { status: 503, headers: { 'content-type': 'application/json' } })
    ) as unknown as typeof fetch
    const collected: unknown[] = []
    for await (const ev of streamChat({ sessionId: 1, content: 'x' })) {
      collected.push(ev)
    }
    expect(collected).toEqual([{ type: 'error', reason: 'no-api-key' }])
  })
})
