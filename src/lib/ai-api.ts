// Wire types + typed fetch wrappers for /api/ai/*. The shapes
// (Session, Message) are the single source of truth — the server
// imports them via `from '../../src/lib/ai-api.js'` and the
// components import them from this file.

export interface Session {
  id: number
  title: string
  createdAt: number
  updatedAt: number
}

export interface Message {
  id: number
  sessionId: number
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  // When the assistant used tools, the server persists a JSON
  // envelope into `content`. After history load, the client may
  // rehydrate it into the structured shape for the panel to render
  // per-tool cards. The SSE stream does not set this — it streams
  // individual tool_use / tool_result events instead.
  blocks?: AssistantBlocks
}

// Structured representation of a tool-using assistant turn. Loaded
// from the JSON envelope in the DB content column. Kept loose
// (string-keyed) on purpose — the client doesn't need the full
// Anthropic content-block shape, just enough to render a tool card.
export interface AssistantBlocks {
  v: 1
  text: string
  toolCalls: ToolCallRecord[]
}

export interface ToolCallRecord {
  id: string
  name: string
  input: Record<string, unknown>
  result: { content: string; is_error: boolean }
}

export interface ActiveSession {
  activeId: number | null
  configured: boolean
}

export interface ChatRequest {
  sessionId: number
  content: string
  // For the system prompt line "The user is currently reading: …".
  // The model can call read_file if it wants to see the body.
  currentNotePath?: string
}

export type FileChangeKind = 'write' | 'delete' | 'rename'

export interface FileChangeEvent {
  path: string
  kind: FileChangeKind
  newMtime?: number
  newRaw?: string
  oldPath?: string
}

export type ChatEvent =
  | { type: 'user'; id: number }
  | { type: 'token'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error: boolean }
  | { type: 'file_changed' } & FileChangeEvent
  | { type: 'done'; userId: number; assistantId: number }
  | { type: 'error'; reason: string }

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (!r.ok) {
    // The success path is strongly typed (Promise<T>); the failure path
    // reads `body.error` from whatever the server returned. We don't
    // have a schema for error bodies, so cast to the loose shape we
    // actually consume.
    const body = (await r.json().catch(() => ({ error: r.statusText }))) as { error?: string }
    throw Object.assign(new Error(body.error ?? `HTTP ${r.status}`), { status: r.status, body })
  }
  return r.json() as Promise<T>
}

// Headers + body for a JSON request; the caller picks the method.
function jsonBody(body: unknown): RequestInit {
  return {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export async function listSessions(): Promise<Session[]> {
  return jsonOrThrow<Session[]>(await fetch('/api/ai/sessions', { method: 'GET' }))
}

export async function createSession(): Promise<Session> {
  return jsonOrThrow<Session>(await fetch('/api/ai/sessions', { method: 'POST' }))
}

export async function renameSession(id: number, title: string): Promise<Session> {
  return jsonOrThrow<Session>(await fetch(`/api/ai/sessions/${id}`, { method: 'PATCH', ...jsonBody({ title }) }))
}

export async function deleteSession(id: number): Promise<{ ok: true }> {
  return jsonOrThrow<{ ok: true }>(await fetch(`/api/ai/sessions/${id}`, { method: 'DELETE' }))
}

export async function listMessages(sessionId: number): Promise<Message[]> {
  return jsonOrThrow<Message[]>(await fetch(`/api/ai/sessions/${sessionId}/messages`, { method: 'GET' }))
}

export async function appendMessage(
  sessionId: number,
  role: 'user' | 'assistant',
  content: string,
): Promise<Message> {
  return jsonOrThrow<Message>(await fetch(`/api/ai/sessions/${sessionId}/messages`, { method: 'POST', ...jsonBody({ role, content }) }))
}

export async function getActiveSession(): Promise<ActiveSession> {
  return jsonOrThrow<ActiveSession>(await fetch('/api/ai/active', { method: 'GET' }))
}

// Backwards-compat shim: existing call sites use getActiveSessionId()
// as a function returning number|null. The endpoint now returns
// { activeId, configured }; this shim extracts the id.
export async function getActiveSessionId(): Promise<number | null> {
  const out = await getActiveSession()
  return out.activeId
}

export async function setActiveSessionId(sessionId: number | null): Promise<number | null> {
  const r = await jsonOrThrow<{ sessionId: number | null }>(await fetch('/api/ai/active', { method: 'PUT', ...jsonBody({ sessionId }) }))
  return r.sessionId
}

/**
 * Open a streaming chat request and yield typed ChatEvent objects.
 * Yields exactly one {type: 'error'} event and returns on any HTTP
 * failure (the body parser short-circuits the stream).
 */
export async function* streamChat(
  req: ChatRequest,
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    ...jsonBody(req),
    signal,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ reason: `http-${res.status}` }))
    yield { type: 'error', reason: (body as any).reason ?? `http-${res.status}` }
    return
  }
  if (!res.body) {
    yield { type: 'error', reason: 'no-body' }
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const eventLine = block.match(/^event:\s*(.+)$/m)
      const dataLine = block.match(/^data:\s*(.+)$/m)
      if (!eventLine || !dataLine) continue
      try {
        const parsed = JSON.parse(dataLine[1])
        yield { type: eventLine[1].trim(), ...parsed } as ChatEvent
      } catch {
        // Ignore malformed blocks — the test will assert what we expect.
      }
    }
  }
}

// --- AI split-to-draft (atomic card generation) ---

/** A single atomic zettel card proposed by the model. The `source`
 *  and `splitMode` fields are filled by the server, not the model —
 *  we don't want the model to be able to attribute a card to a
 *  different source note than the one the user clicked on. */
export interface Card {
  title: string
  body: string
  tags: string[]
  /** A slug for the future filename (e.g. "domain-events-as-decoupling-boundary").
   *  Server validates against SEGMENT_RE. Conflicts get -2, -3, ... suffix. */
  slug: string
  source: string
  splitMode: 'inbox' | 'literature'
}

export type SplitMode = 'inbox' | 'literature'

export interface SplitRequest {
  path: string         // e.g. "inbox/init" (no .md)
  mode: SplitMode
}

export interface SplitResponse {
  cards: Card[]
}

export interface WriteDraftBatchRequest {
  cards: Card[]
}

export interface WriteDraftBatchResponse {
  written: { slug: string; path: string }[]
  skipped: { slug: string; reason: string }[]
  failed:  { slug: string; reason: string }[]
}

/** Ask Claude to split a long note into atomic zettel cards.
 *  Synchronous, non-streaming; latency is ~5-15s for a 2000-word note. */
export async function splitNote(req: SplitRequest): Promise<SplitResponse> {
  return jsonOrThrow<SplitResponse>(await fetch('/api/ai/split', {
    method: 'POST', ...jsonBody(req),
  }))
}

/** Write a batch of cards to src/content/zettel/draft/.
 *  Per-card status: written (with the final path), skipped, or failed. */
export async function writeDraftBatch(
  req: WriteDraftBatchRequest,
): Promise<WriteDraftBatchResponse> {
  return jsonOrThrow<WriteDraftBatchResponse>(await fetch('/api/zettel/draft/batch', {
    method: 'POST', ...jsonBody(req),
  }))
}
