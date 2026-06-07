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
}

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const body = await r.json().catch(() => ({ error: r.statusText }))
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

export async function getActiveSessionId(): Promise<number | null> {
  const r = await jsonOrThrow<{ sessionId: number | null }>(await fetch('/api/ai/active', { method: 'GET' }))
  return r.sessionId
}

export async function setActiveSessionId(sessionId: number | null): Promise<number | null> {
  const r = await jsonOrThrow<{ sessionId: number | null }>(await fetch('/api/ai/active', { method: 'PUT', ...jsonBody({ sessionId }) }))
  return r.sessionId
}
