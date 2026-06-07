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
  it('returns { sessionId: null } when no active session', async () => {
    const r = await call('GET', '/active')
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ sessionId: null })
  })
})

describe('PUT /api/ai/active', () => {
  it('sets the active session and round-trips on GET', async () => {
    const created = (await (await call('POST', '/sessions')).json()) as { id: number }
    const r = await call('PUT', '/active', { sessionId: created.id })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ sessionId: created.id })

    const get = await call('GET', '/active')
    expect(await get.json()).toEqual({ sessionId: created.id })
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
