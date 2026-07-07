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
import { promises as fs } from 'node:fs'
import { getDb } from '../db.js'
import { filePathFor } from '../paths.js'
import * as sessions from './sessions.js'
import * as messages from './messages.js'
import { runChat, type ChatEvent } from './chat.js'
import { runSplit } from './split.js'
import { generateSlug } from './slug.js'
import { ChatError } from './errors.js'
import { resolveApiKey } from './llm.js'
import type { Message, AssistantBlocks } from '../../src/lib/ai-api.js'

function bad(c: any, msg: string, code = 400) {
  return c.json({ error: msg }, code)
}

// Tool-using assistant turns persist as a JSON envelope in the
// `content` column (see server/ai/chat.ts). On the wire, the client
// expects the same shape the streaming code path produces in
// memory: plain text in `content` and the structured envelope
// (minus the server-internal `rounds` field) in `blocks`. The
// storage layer keeps the raw envelope so buildConvoFromHistory
// can still rebuild the SDK convo including `rounds`; this
// transform is a presentation concern, so it lives in the API
// layer, not the storage layer.
function rehydrateForClient(m: Message): Message {
  if (m.role !== 'assistant') return m
  const parsed = messages.parseStoredContent(m.content)
  if (parsed.kind !== 'envelope') return m
  const blocks: AssistantBlocks = {
    v: 1,
    text: parsed.envelope.text,
    toolCalls: parsed.envelope.toolCalls,
  }
  return { ...m, content: parsed.envelope.text, blocks }
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
  return c.json(list.map(rehydrateForClient))
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

// ---- /slug ----
// Lightweight one-shot helper for name inputs. It deliberately does not
// create a chat session or persist a message; the result is just a suggested
// filesystem-safe English path segment.
ai.post('/slug', async (c) => {
  const body = await c.req.json().catch(() => null) as
    | { input?: unknown; kind?: unknown }
    | null
  if (
    !body ||
    typeof body.input !== 'string' ||
    (body.kind !== 'file' && body.kind !== 'folder')
  ) {
    return bad(c, 'input (string) and kind (file|folder) required')
  }
  try {
    const slug = await generateSlug({
      input: body.input,
      kind: body.kind,
      signal: c.req.raw.signal,
    })
    return c.json({ slug })
  } catch (err) {
    if (err instanceof ChatError) {
      if (err.reason === 'no-api-key') return bad(c, 'AI not configured', 503)
      if (err.reason === 'aborted') return c.json({ error: 'aborted' }, 499 as any)
      if (err.reason === 'parse-failed') return bad(c, err.message, 502)
      return bad(c, err.message || 'llm-error', 502)
    }
    return bad(c, 'unknown', 500)
  }
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
      }
    | null
  if (
    !body ||
    typeof body.sessionId !== 'number' ||
    typeof body.content !== 'string'
  ) {
    return c.json({ ok: false, reason: 'invalid' }, 400)
  }
  // Bind to locals so the narrowed types survive into runChat().
  const sessionId = body.sessionId
  const userContent = body.content

  // We don't pre-validate the session here — runChat throws
  // ChatError('not-found') and the route maps it to an SSE error
  // event so the client can show a chip rather than a generic 404.
  return streamSSE(c, async (stream) => {
    try {
      const ctx = {
        currentNotePath: typeof body.currentNotePath === 'string' ? body.currentNotePath : undefined,
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
        sessionId,
        userContent,
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

// ---- /split ----
// Synchronous non-streaming call: the client renders a loading state
// while we wait (5-15s typical), then displays the result in the AI
// panel's review surface. We only accept paths under inbox/ or
// literature/ — splitting notes from any other directory is a spec
// violation, and the error makes that explicit at the boundary.
ai.post('/split', async (c) => {
  if (!resolveApiKey()) {
    return c.json({ error: 'AI not configured (ANTHROPIC_API_KEY missing)' }, 503)
  }
  const body = await c.req.json().catch(() => null) as
    | { path?: unknown; mode?: unknown }
    | null
  if (
    !body ||
    typeof body.path !== 'string' ||
    (body.mode !== 'inbox' && body.mode !== 'literature')
  ) {
    return c.json({ error: 'path (string) and mode (inbox|literature) required' }, 400)
  }
  const path = body.path
  const mode = body.mode as 'inbox' | 'literature'

  if (!path.startsWith('inbox/') && !path.startsWith('literature/')) {
    return c.json({ error: 'split is only supported for inbox/ and literature/ notes' }, 400)
  }

  // Read the source note. We reuse filePathFor to enforce the same
  // path-safety check the rest of the API uses (no absolute paths,
  // no .., etc.). 404 here maps cleanly to "the note you clicked
  // doesn't exist anymore" — a real failure mode if the user
  // right-clicked a tree row that has since been deleted.
  let abs: string
  try { abs = filePathFor(path) } catch (e: any) {
    return c.json({ error: e.message }, 400)
  }
  let raw: string
  try { raw = await fs.readFile(abs, 'utf8') } catch {
    return c.json({ error: 'source note not found' }, 404)
  }

  try {
    const cards = await runSplit({ path, mode, raw, signal: c.req.raw.signal })
    return c.json({ cards })
  } catch (err) {
    if (err instanceof ChatError) {
      if (err.reason === 'parse-failed') return c.json({ error: 'parse-failed', reason: err.message }, 502)
      if (err.reason === 'aborted') return c.json({ error: 'aborted' }, 499 as any)
      if (err.reason === 'no-api-key') return c.json({ error: 'AI not configured' }, 503)
      return c.json({ error: 'llm-error', reason: err.message }, 502)
    }
    return c.json({ error: 'unknown' }, 500)
  }
})

export default ai
