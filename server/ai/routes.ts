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
import { streamSSE } from 'hono/streaming'
import { getDb } from '../db.js'
import * as sessions from './sessions.js'
import * as messages from './messages.js'
import { runChat, type ChatEvent } from './chat.js'
import { ChatError } from './errors.js'
import { resolveApiKey } from './llm.js'

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
ai.get('/active', (c) =>
  c.json({
    activeId: sessions.getActiveSessionId(getDb()),
    configured: Boolean(
      process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN,
    ),
  })
)

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

// ---- /chat ----
ai.post('/chat', async (c) => {
  if (!resolveApiKey()) {
    return c.json({ ok: false, reason: 'no-api-key' }, 503)
  }
  const body = (await c.req.json().catch(() => null)) as
    | {
        sessionId?: unknown
        content?: unknown
        currentNotePath?: unknown
        currentNoteContent?: unknown
      }
    | null
  if (
    !body ||
    typeof body.sessionId !== 'number' ||
    typeof body.content !== 'string'
  ) {
    return c.json({ ok: false, reason: 'invalid' }, 400)
  }

  // We don't pre-validate the session here — runChat throws
  // ChatError('not-found') and the route maps it to an SSE error
  // event so the client can show a chip rather than a generic 404.
  return streamSSE(c, async (stream) => {
    try {
      const ctx = {
        currentNotePath: typeof body.currentNotePath === 'string' ? body.currentNotePath : undefined,
        currentNoteContent: typeof body.currentNoteContent === 'string' ? body.currentNoteContent : undefined,
      }
      const writeEvent = async (e: ChatEvent) => {
        switch (e.type) {
          case 'user':
            await stream.writeSSE({ event: 'user', data: JSON.stringify({ id: e.id }) })
            break
          case 'token':
            await stream.writeSSE({ event: 'token', data: JSON.stringify({ text: e.text }) })
            break
          case 'tool_use':
            await stream.writeSSE({
              event: 'tool_use',
              data: JSON.stringify({ id: e.id, name: e.name, input: e.input }),
            })
            break
          case 'tool_result':
            await stream.writeSSE({
              event: 'tool_result',
              data: JSON.stringify({
                tool_use_id: e.tool_use_id,
                content: e.content,
                is_error: e.is_error,
              }),
            })
            break
          case 'file_changed':
            await stream.writeSSE({
              event: 'file_changed',
              data: JSON.stringify({
                path: e.path,
                kind: e.kind,
                newMtime: e.newMtime,
                newRaw: e.newRaw,
                oldPath: e.oldPath,
              }),
            })
            break
          case 'done':
            await stream.writeSSE({
              event: 'done',
              data: JSON.stringify({ userId: e.userId, assistantId: e.assistantId }),
            })
            break
          case 'error':
            await stream.writeSSE({
              event: 'error',
              data: JSON.stringify({ reason: e.reason }),
            })
            break
        }
      }

      await runChat({
        db: getDb(),
        sessionId: body.sessionId,
        userContent: body.content,
        ctx,
        model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
        signal: c.req.raw.signal,
        onEvent: writeEvent,
      })
    } catch (err) {
      if (err instanceof ChatError && err.reason === 'aborted') return
      const reason = err instanceof ChatError ? err.reason : 'unknown'
      try {
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ reason }) })
      } catch {
        // The stream may already be closed (client disconnect).
        // Best-effort: ignore.
      }
    }
  })
})

export default ai
