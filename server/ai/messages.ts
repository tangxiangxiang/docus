// Messages service. The two functions are listMessages (read) and
// appendMessage (write). appendMessage does several things in one
// transaction: validate input, ensure the session exists, insert the
// message, refresh the session's updated_at, and (for the first user
// message in an empty-title session) auto-derive a title from the
// message content. The title derivation uses Unicode code-point
// counting so a surrogate pair (e.g. an emoji) can't be split.
import type { Database as DatabaseT } from 'better-sqlite3'
import type { Message } from '../../src/lib/ai-api.js'

function rowToMessage(r: any): Message {
  return {
    id: r.id,
    sessionId: r.session_id,
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
  }
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
    'SELECT id, session_id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC, id ASC'
  ).all(sessionId)
  return rows.map(rowToMessage)
}

type AppendResult =
  | { ok: true; message: Message }
  | { ok: false; reason: 'not-found' | 'empty' | 'invalid-role' }

export function appendMessage(
  db: DatabaseT,
  sessionId: number,
  role: 'user' | 'assistant',
  content: string,
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
    const info = db.prepare(
      'INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)'
    ).run(sessionId, role, content, now)
    const message: Message = {
      id: Number(info.lastInsertRowid),
      sessionId,
      role,
      content,
      createdAt: now,
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
