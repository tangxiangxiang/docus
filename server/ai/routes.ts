// Hono sub-router for /api/ai. The handlers are intentionally thin:
// parse the request, call the matching service function, translate
// the service result to an HTTP status + JSON body.
//
// Two non-obvious choices:
//   - getDb() is called at request time, not at module load. This
//     keeps the import side-effect-free (server/index.ts can mount
//     this sub-app without creating ./data/docus.db at startup) and
//     lets tests spy on getDb to inject an in-memory DB.
//   - The bad() helper is duplicated here rather than imported from
//     ../index.js to avoid creating a circular import (index.js
//     will eventually import this file). The signature is identical
//     to the helper in ../index.ts.
import { Hono } from 'hono'
import { getDb } from '../db.js'
import * as sessions from './sessions.js'
import * as messages from './messages.js'

function bad(c: any, msg: string, code = 400) {
  return c.json({ error: msg }, code)
}

const ai = new Hono()

// ---- /sessions ----
ai.get('/sessions', (c) => c.json(sessions.listSessions(getDb())))

ai.post('/sessions', (c) => {
  const s = sessions.createSession(getDb())
  return c.json(s, 201)
})

ai.patch('/sessions/:id', (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return bad(c, 'invalid id')
  const body = c.req.json().catch(() => null) as Promise<{ title?: unknown } | null>
  return body.then((b) => {
    if (!b || typeof b.title !== 'string') return bad(c, 'title required')
    if (b.title.trim().length === 0) return bad(c, 'title must not be empty')
    const updated = sessions.renameSession(getDb(), id, b.title)
    if (!updated) return bad(c, 'not found', 404)
    return c.json(updated)
  })
})

ai.delete('/sessions/:id', (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return bad(c, 'invalid id')
  const ok = sessions.deleteSession(getDb(), id)
  if (!ok) return bad(c, 'not found', 404)
  return c.json({ ok: true })
})

// ---- /sessions/:id/messages ----
ai.get('/sessions/:id/messages', (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return bad(c, 'invalid id')
  const list = messages.listMessages(getDb(), id)
  if (list === null) return bad(c, 'not found', 404)
  return c.json(list)
})

ai.post('/sessions/:id/messages', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return bad(c, 'invalid id')
  const body = await c.req.json().catch(() => null) as { role?: unknown; content?: unknown } | null
  if (!body || typeof body.role !== 'string' || typeof body.content !== 'string') {
    return bad(c, 'role and content required')
  }
  const result = messages.appendMessage(getDb(), id, body.role as 'user' | 'assistant', body.content)
  if (result.ok) return c.json(result.message, 201)
  if (result.reason === 'not-found') return bad(c, 'not found', 404)
  return bad(c, result.reason) // 'empty' or 'invalid-role' → 400
})

// ---- /active ----
ai.get('/active', (c) => c.json({ sessionId: sessions.getActiveSessionId(getDb()) }))

ai.put('/active', async (c) => {
  const body = await c.req.json().catch(() => null) as { sessionId?: unknown } | null
  if (!body || (body.sessionId !== null && typeof body.sessionId !== 'number')) {
    return bad(c, 'sessionId must be a number or null')
  }
  const id = body.sessionId as number | null
  // Setting to null always succeeds; setting to a number requires the session to exist.
  if (id !== null) {
    const exists = sessions.getSession(getDb(), id)
    if (!exists) return bad(c, 'session not found', 404)
  }
  sessions.setActiveSessionId(getDb(), id)
  return c.json({ sessionId: id })
})

export default ai
