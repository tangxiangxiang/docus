// Messages service. The two functions are listMessages (read) and
// appendMessage (write). appendMessage does several things in one
// transaction: validate input, ensure the session exists, insert the
// message, refresh the session's updated_at, and (for the first user
// message in an empty-title session) auto-derive a title from the
// message content. The title derivation uses Unicode code-point
// counting so a surrogate pair (e.g. an emoji) can't be split.
//
// Tool-using assistant turns persist a JSON envelope into the
// existing `content` column so the schema is unchanged. The
// envelope is detected by `parseStoredContent` when the history is
// rehydrated for a follow-up turn — the matching tool_results user
// turn is synthesized from the envelope (no need to persist it).
import type { Database as DatabaseT } from 'better-sqlite3'
import type { Message, NoteAttachment } from '../../src/lib/ai-api.js'

// The note_attachment column is JSON; old rows and assistant rows are
// NULL. Parsing is forgiving — a malformed blob just becomes
// `undefined` rather than blowing up history load. The shape is
// pinned in src/lib/ai-api.ts (NoteAttachment) and should be the
// only place to look for what's valid.
function parseNoteAttachment(raw: string | null): NoteAttachment | undefined {
  if (!raw) return undefined
  try {
    const j = JSON.parse(raw)
    if (
      j &&
      typeof j.path === 'string' &&
      typeof j.truncated === 'boolean' &&
      Number.isFinite(j.originalCodepoints) &&
      Number.isFinite(j.attachedCodepoints)
    ) {
      return j as NoteAttachment
    }
  } catch {
    // fall through
  }
  return undefined
}

function rowToMessage(r: any): Message {
  return {
    id: r.id,
    sessionId: r.session_id,
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
    noteAttachment: parseNoteAttachment(r.note_attachment),
  }
}

// --- JSON envelope for tool-using assistant turns ---------------------------

export type ToolCallRecord = {
  id: string
  name: string
  input: Record<string, unknown>
  result: { content: string; is_error: boolean }
}

export type AssistantEnvelope = {
  v: 1
  text: string
  // One entry per LLM round in this assistant turn. Each entry is
  // the assistant's content blocks for that round (text + tool_use).
  // Typed as `unknown` to avoid dragging the SDK types into the
  // persistence layer; the orchestrator casts.
  rounds: unknown[][]
  toolCalls: ToolCallRecord[]
}

export type StoredContent =
  | { kind: 'envelope'; envelope: AssistantEnvelope }
  | { kind: 'plain'; text: string }

/**
 * Try to parse a DB row's `content` as the assistant-envelope shape
 * `{v:1, text, rounds, toolCalls}`. Returns the envelope if it
 * matches; otherwise returns the raw text. Safe to call on any
 * string — never throws.
 */
export function parseStoredContent(raw: string): StoredContent {
  try {
    const j = JSON.parse(raw)
    if (
      j &&
      j.v === 1 &&
      typeof j.text === 'string' &&
      Array.isArray(j.rounds) &&
      j.rounds.every((r: unknown) => Array.isArray(r)) &&
      Array.isArray(j.toolCalls)
    ) {
      return { kind: 'envelope', envelope: j as AssistantEnvelope }
    }
  } catch {
    // not JSON — fall through
  }
  return { kind: 'plain', text: raw }
}

const MAX_TITLE_CODEPOINTS = 30

/**
 * Derive a session title from a first user message. Trims whitespace,
 * caps at 30 Unicode code points, and appends '…' if truncated.
 * Returns the empty string for empty content (the caller should have
 * already rejected this with the 'empty' reason, but the function is
 * safe to call defensively).
 */
function deriveTitle(content: string): string {
  const trimmed = content.trim()
  if (trimmed.length === 0) return ''
  const cps = [...trimmed] // array of single code points
  if (cps.length <= MAX_TITLE_CODEPOINTS) return trimmed
  return cps.slice(0, MAX_TITLE_CODEPOINTS).join('') + '…'
}

export function listMessages(db: DatabaseT, sessionId: number): Message[] | null {
  // Confirm the session exists so a typo'd id doesn't silently
  // return an empty array (which the UI would then render as "no
  // messages yet" — confusing). The cost is one extra index lookup.
  const sess = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId)
  if (!sess) return null
  const rows = db.prepare(
    'SELECT id, session_id, role, content, created_at, note_attachment FROM messages WHERE session_id = ? ORDER BY created_at ASC, id ASC'
  ).all(sessionId)
  return rows.map(rowToMessage)
}

type AppendResult =
  | { ok: true; message: Message }
  | { ok: false; reason: 'not-found' | 'empty' | 'invalid-role' }

// noteAttachment is only meaningful for user messages (the toggle
// lives on the user-side composer). Passing it for an assistant row
// is silently ignored — the column is left NULL.
export function appendMessage(
  db: DatabaseT,
  sessionId: number,
  role: 'user' | 'assistant',
  content: string,
  noteAttachment?: NoteAttachment,
): AppendResult {
  // Validation before the transaction so the no-op cases don't
  // open a write transaction at all.
  if (role !== 'user' && role !== 'assistant') {
    return { ok: false, reason: 'invalid-role' }
  }
  if (content.trim().length === 0) {
    return { ok: false, reason: 'empty' }
  }

  return db.transaction(() => {
    const sess = db.prepare('SELECT id, title FROM sessions WHERE id = ?').get(sessionId) as
      | { id: number; title: string }
      | undefined
    if (!sess) return { ok: false as const, reason: 'not-found' as const }

    const now = Date.now()
    // Store the metadata as JSON. NULL when not provided so the
    // existing assistant rows stay slim.
    const noteJson = role === 'user' && noteAttachment ? JSON.stringify(noteAttachment) : null
    const info = db.prepare(
      'INSERT INTO messages (session_id, role, content, created_at, note_attachment) VALUES (?, ?, ?, ?, ?)'
    ).run(sessionId, role, content, now, noteJson)
    const message: Message = {
      id: Number(info.lastInsertRowid),
      sessionId,
      role,
      content,
      createdAt: now,
      noteAttachment: role === 'user' ? noteAttachment : undefined,
    }

    // Refresh updated_at. If this is the first user message in an
    // empty-title session, also derive a title.
    if (role === 'user' && sess.title === '') {
      const title = deriveTitle(content)
      db.prepare('UPDATE sessions SET updated_at = ?, title = ? WHERE id = ?').run(now, title, sessionId)
    } else {
      db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId)
    }

    return { ok: true as const, message }
  })()
}
