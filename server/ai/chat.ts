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

// ---- runChat ----

export type ChatContext = {
  currentNotePath?: string
  currentNoteContent?: string
}

export type RunChatDeps = {
  db: DatabaseT
  model: string
  signal?: AbortSignal
  onUserId: (id: number) => void | Promise<void>
  onToken: (text: string) => void | Promise<void>
}

export type RunChatOpts = {
  sessionId: number
  userContent: string
  ctx: ChatContext
} & RunChatDeps

export async function runChat(opts: RunChatOpts): Promise<{
  userId: number
  assistantId: number
  fullText: string
}> {
  if (opts.userContent.trim().length === 0) {
    throw new ChatError('empty')
  }
  const sess = sessions.getSession(opts.db, opts.sessionId)
  if (!sess) throw new ChatError('not-found')

  const history = messages.listMessages(opts.db, opts.sessionId) ?? []
  const system = buildSystemPrompt(opts.ctx)
  const convo = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: opts.userContent },
  ]

  // Write the user message FIRST so a crash mid-stream only loses
  // the in-flight assistant text. See spec §3.5.
  const userResult = messages.appendMessage(opts.db, opts.sessionId, 'user', opts.userContent)
  if (!userResult.ok) {
    throw new ChatError('llm-error', `user persist failed: ${userResult.reason}`)
  }
  const userId = userResult.message.id
  await opts.onUserId(userId)

  let fullText = ''
  // Wrap onToken so partial streamed text is preserved on the catch
  // path (e.g. an abort mid-stream). The consumer's onToken still
  // fires; we just mirror into fullText for the persist-on-fail branch.
  const onToken = async (text: string) => {
    fullText += text
    await opts.onToken(text)
  }
  try {
    fullText = await streamClaude({
      system,
      messages: convo,
      model: opts.model,
      onToken,
      signal: opts.signal,
    })
  } catch (err) {
    // Persist whatever streamed so far (typically '' or a few tokens)
    // and re-throw a tagged error so the route can emit SSE error.
    const partial = fullText || '[stream interrupted]'
    const assistantResult = messages.appendMessage(
      opts.db, opts.sessionId, 'assistant', partial,
    )
    const assistantId = assistantResult.ok ? assistantResult.message.id : -1
    if (err instanceof ChatError) {
      throw new ChatError(err.reason, err.message, assistantId)
    }
    throw new ChatError('llm-error', (err as Error).message, assistantId)
  }

  const assistantResult = messages.appendMessage(
    opts.db, opts.sessionId, 'assistant', fullText,
  )
  if (!assistantResult.ok) throw new ChatError('llm-error', 'failed to persist assistant')
  return { userId, assistantId: assistantResult.message.id, fullText }
}
