// AI chat orchestrator. Pure functions of (db, ...args) — no
// closures over module state, no classes (ChatError is the one
// exception; it lives in ./errors.ts to avoid a circular import
// with ./llm.ts).
//
// buildSystemPrompt is a free function so the tests can exercise
// it without standing up an SDK mock. runChat is the orchestrator
// used by the /chat route handler.
import type { Database as DatabaseT } from 'better-sqlite3'
import { ChatError } from './errors.js'
import { streamClaude } from './llm.js'
import * as messages from './messages.js'
import * as sessions from './sessions.js'

const BASE_SYSTEM_PROMPT =
  "You're a helpful assistant for a personal knowledge base."

const MAX_NOTE_CODEPOINTS = 20_000

export function buildSystemPrompt(ctx: {
  currentNotePath?: string
  currentNoteContent?: string
}): string {
  if (!ctx.currentNotePath) return BASE_SYSTEM_PROMPT
  const raw = ctx.currentNoteContent ?? ''
  // Slice on code points, not UTF-16 code units, so a multi-code-unit
  // glyph at the boundary isn't corrupted.
  const cps = [...raw]
  if (cps.length <= MAX_NOTE_CODEPOINTS) {
    return `${BASE_SYSTEM_PROMPT}\n\nThe user is currently reading: ${ctx.currentNotePath}\n\n${raw}`
  }
  const truncated = cps.slice(0, MAX_NOTE_CODEPOINTS).join('')
  return `${BASE_SYSTEM_PROMPT}\n\nThe user is currently reading: ${ctx.currentNotePath}\n\n${truncated}\n\n[... truncated; full file at ${ctx.currentNotePath} ...]`
}
