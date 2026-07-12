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
import { getDocumentMetadata } from '../documentMetadata.js'
import matter from 'gray-matter'
import * as sessions from './sessions.js'
import * as messages from './messages.js'
import { runChat, type ChatEvent } from './chat.js'
import { generateSlug } from './slug.js'
import { generateCommitMessage } from './commitMessage.js'
import { ChatError } from './errors.js'
import { resolveAiRuntimeConfig } from './llm.js'
import {
  clearAiApiKey,
  getAiSettingsView,
  MAX_AI_API_KEY_LENGTH,
  MAX_AI_BASE_URL_LENGTH,
  MAX_AI_MODEL_LENGTH,
  saveAiSettings,
} from './settings.js'
import type { Message, AssistantBlocks } from '../../src/lib/ai-api.js'

function bad(c: any, msg: string, code = 400) {
  return c.json({ error: msg }, code)
}

function isValidHttpUrl(value: string): boolean {
  if (!value) return true
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function isValidModelName(value: string): boolean {
  if (!value) return true
  return /^[A-Za-z0-9._:-]+$/.test(value)
}

const MAX_COMMIT_MESSAGE_PATHS = 20
const MAX_COMMIT_NOTE_CHARS = 2_000
const MAX_COMMIT_DIFF_CHARS = 8_000

function contentPathForHistoryPath(p: string): string {
  return p.endsWith('.md') ? p.slice(0, -3) : p
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

// ---- /settings ----
ai.get('/settings', (c) => c.json(getAiSettingsView(getDb())))

ai.put('/settings', async (c) => {
  const body = await c.req.json().catch(() => null) as
    | { apiKey?: unknown; baseURL?: unknown; model?: unknown }
    | null
  if (!body) return bad(c, 'body required')
  if (body.apiKey !== undefined && typeof body.apiKey !== 'string') return bad(c, 'apiKey must be a string')
  if (body.baseURL !== undefined && typeof body.baseURL !== 'string') return bad(c, 'baseURL must be a string')
  if (body.model !== undefined && typeof body.model !== 'string') return bad(c, 'model must be a string')
  const apiKey = body.apiKey?.trim()
  const baseURL = body.baseURL?.trim()
  const model = body.model?.trim()
  if (apiKey && apiKey.length > MAX_AI_API_KEY_LENGTH) return bad(c, 'apiKey is too long')
  if (baseURL && baseURL.length > MAX_AI_BASE_URL_LENGTH) return bad(c, 'baseURL is too long')
  if (model && model.length > MAX_AI_MODEL_LENGTH) return bad(c, 'model is too long')
  if (baseURL && !isValidHttpUrl(baseURL)) return bad(c, 'baseURL must be an http(s) URL')
  if (model && !isValidModelName(model)) return bad(c, 'model contains unsupported characters')
  saveAiSettings(getDb(), {
    apiKey,
    baseURL,
    model,
  })
  return c.json(getAiSettingsView(getDb()))
})

ai.delete('/settings/key', (c) => {
  clearAiApiKey(getDb())
  return c.json(getAiSettingsView(getDb()))
})

// ---- /active ----
ai.get('/active', (c) =>
  c.json({
    activeId: sessions.getActiveSessionId(getDb()),
    configured: Boolean(resolveAiRuntimeConfig().apiKey),
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

// ---- /commit-message ----
// Lightweight helper for the History composer. It does not create a chat
// session; it reads the selected notes and returns a single subject line.
ai.post('/commit-message', async (c) => {
  const body = await c.req.json().catch(() => null) as
    | { paths?: unknown; selectedPath?: unknown; diffText?: unknown }
    | null
  if (!body || !Array.isArray(body.paths)) return bad(c, 'paths array required')
  const paths = body.paths
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .map((p) => p.trim())
    .slice(0, MAX_COMMIT_MESSAGE_PATHS)
  if (paths.length === 0) return bad(c, 'at least one path required')
  const selectedPath = typeof body.selectedPath === 'string' ? body.selectedPath.trim() : undefined
  const diffText = typeof body.diffText === 'string'
    ? body.diffText.slice(0, MAX_COMMIT_DIFF_CHARS)
    : undefined

  try {
    const noteContext = await Promise.all(paths.map(async (p) => {
      const abs = filePathFor(contentPathForHistoryPath(p))
      const raw = await fs.readFile(abs, 'utf8').catch(() => '')
      return { path: p, raw: raw.slice(0, MAX_COMMIT_NOTE_CHARS) }
    }))
    const message = await generateCommitMessage({
      paths,
      selectedPath,
      diffText,
      noteContext,
      signal: c.req.raw.signal,
    })
    return c.json({ message })
  } catch (err) {
    if (err instanceof ChatError) {
      if (err.reason === 'no-api-key') return bad(c, 'AI not configured', 503)
      if (err.reason === 'aborted') return c.json({ error: 'aborted' }, 499 as any)
      if (err.reason === 'parse-failed') return bad(c, err.message, 502)
      return bad(c, err.message || 'llm-error', 502)
    }
    return bad(c, (err as Error).message || 'unknown', 500)
  }
})

// ---- /chat ----
ai.post('/chat', async (c) => {
  if (!resolveAiRuntimeConfig().apiKey) {
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
        model: resolveAiRuntimeConfig().model,
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
