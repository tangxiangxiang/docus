import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { applyMigrations } from '../db'
import { buildSystemPrompt, runChat, type ChatEvent } from '../ai/chat'
import { ChatError } from '../ai/errors'
import { streamClaude, type StreamResult } from '../ai/llm'

describe('buildSystemPrompt', () => {
  it('returns the base prompt (no note context) followed by the tools section', () => {
    const out = buildSystemPrompt({})
    expect(out.startsWith("You're a helpful assistant for a personal knowledge base.")).toBe(true)
    expect(out).toContain('## 你可以修改工作区里的文件')
    expect(out).toContain('read_file')
  })

  it('mentions the open note by path and tells the model to use read_file for the body', () => {
    const out = buildSystemPrompt({ currentNotePath: 'zettel/foo.md' })
    expect(out).toContain('zettel/foo.md')
    // The system prompt no longer carries the body; the model is
    // pointed at read_file instead. This is the whole point of the
    // 📎 toggle change — we don't silently bloat the system
    // prompt with the note body on every turn.
    expect(out).toContain('read_file')
    expect(out).not.toContain('hello world')
    expect(out.startsWith("You're a helpful assistant")).toBe(true)
  })

  it('does not include any note body in the system prompt (only path)', () => {
    // Regression guard: even if a caller mistakenly passes
    // currentNoteContent in the ctx, the system prompt must not
    // include it. The body now lives in the user message instead.
    const out = buildSystemPrompt({
      currentNotePath: 'zettel/foo.md',
      // @ts-expect-error — TS would reject this; the test pins
      // the runtime behavior that the field is ignored.
      currentNoteContent: 'SENTINEL_NOTE_BODY_99',
    })
    expect(out).not.toContain('SENTINEL_NOTE_BODY_99')
    expect(out).toContain('zettel/foo.md')
  })
})

// Mock the SDK wrapper so tests don't hit the network. The default
// mock resolves with the new {text, finalMessage} shape that
// runChat expects.
vi.mock('../ai/llm', () => ({
  streamClaude: vi.fn(async ({ onToken }: { onToken: (t: string) => void }) => {
    onToken('hi ')
    onToken('there')
    const finalMessage = { content: [{ type: 'text', text: 'hi there' }], stop_reason: 'end_turn' }
    return { text: 'hi there', finalMessage }
  }),
}))

function freshDb() {
  const db = new Database(':memory:')
  applyMigrations(db)
  return db
}

function makeSession(db: ReturnType<typeof freshDb>): number {
  const s = db.prepare('INSERT INTO sessions (title, created_at, updated_at) VALUES (?, ?, ?)').run('', 1, 1)
  return Number(s.lastInsertRowid)
}

describe('runChat', () => {
  beforeEach(() => {
    vi.mocked(streamClaude).mockReset()
    vi.mocked(streamClaude).mockImplementation(async ({ onToken }) => {
      onToken('hi ')
      onToken('there')
      return {
        text: 'hi there',
        finalMessage: { content: [{ type: 'text', text: 'hi there' }], stop_reason: 'end_turn' },
      } as StreamResult
    })
  })

  it('throws ChatError(not-found) when the session does not exist', async () => {
    const db = freshDb()
    const events: ChatEvent[] = []
    await expect(
      runChat({
        db,
        sessionId: 999,
        userContent: 'hi',
        ctx: {},
        model: 'm',
        signal: undefined,
        onEvent: (e) => { events.push(e) },
      })
    ).rejects.toMatchObject({ reason: 'not-found' })
  })

  it('throws ChatError(empty) when the user content is whitespace', async () => {
    const db = freshDb()
    const id = makeSession(db)
    await expect(
      runChat({
        db, sessionId: id, userContent: '   ', ctx: {}, model: 'm',
        signal: undefined, onEvent: () => {},
      })
    ).rejects.toMatchObject({ reason: 'empty' })
  })

  it('persists user then assistant message and emits events in order', async () => {
    const db = freshDb()
    const id = makeSession(db)
    const events: ChatEvent[] = []
    const { userId, assistantId } = await runChat({
      db,
      sessionId: id,
      userContent: 'hi',
      ctx: {},
      model: 'm',
      signal: undefined,
      onEvent: (e) => { events.push(e) },
    })
    const eventTypes = events.map((e) => e.type)
    expect(eventTypes).toEqual(['user', 'token', 'token', 'done'])
    expect(events[0]).toMatchObject({ type: 'user', id: userId })
    expect(events[1]).toMatchObject({ type: 'token', text: 'hi ' })
    expect(events[2]).toMatchObject({ type: 'token', text: 'there' })
    expect(events[3]).toMatchObject({ type: 'done', userId, assistantId })
    expect(assistantId).toBeGreaterThan(userId)
    const rows = db.prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY id').all(id) as { role: string; content: string }[]
    expect(rows).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hi there' },
    ])
  })

  it('passes the current note path into the system prompt but not the body', async () => {
    const db = freshDb()
    const id = makeSession(db)
    // A unique sentinel that wouldn't appear in any tool
    // description or default prompt text. Asserting the system
    // prompt doesn't contain it pins that the note body was NOT
    // inlined into the system prompt (the previous bug).
    const sentinel = 'SENTINEL_NOTE_BODY_42_XYZ'
    await runChat({
      db, sessionId: id, userContent: 'hi',
      ctx: { currentNotePath: 'zettel/note.md', /* legacy field */ currentNoteContent: sentinel } as any,
      model: 'm', signal: undefined, onEvent: () => {},
    })
    const systemArg = vi.mocked(streamClaude).mock.calls[0][0].system as string
    expect(systemArg).toContain('zettel/note.md')
    // The body must not be in the system prompt. We check the
    // sentinel (not the literal word "body") so the assertion
    // doesn't trip on the word "body" appearing in the read_file
    // tool description.
    expect(systemArg).not.toContain(sentinel)
  })

  it('persists noteAttachment on the user message when provided', async () => {
    const db = freshDb()
    const id = makeSession(db)
    await runChat({
      db, sessionId: id,
      userContent: 'hi <attached_note path="zettel/note.md">body</attached_note>',
      ctx: { currentNotePath: 'zettel/note.md' },
      model: 'm', signal: undefined, onEvent: () => {},
      noteAttachment: {
        path: 'zettel/note.md',
        truncated: true,
        originalCodepoints: 35_000,
        attachedCodepoints: 20_000,
      },
    })
    const row = db.prepare(
      'SELECT role, content, note_attachment FROM messages WHERE session_id = ? AND role = ?'
    ).get(id, 'user') as { role: string; content: string; note_attachment: string }
    expect(row.content).toContain('<attached_note path="zettel/note.md">')
    expect(JSON.parse(row.note_attachment)).toEqual({
      path: 'zettel/note.md',
      truncated: true,
      originalCodepoints: 35_000,
      attachedCodepoints: 20_000,
    })
  })

  it('does not write note_attachment on assistant messages', async () => {
    const db = freshDb()
    const id = makeSession(db)
    await runChat({
      db, sessionId: id, userContent: 'hi',
      ctx: { currentNotePath: 'zettel/note.md' },
      model: 'm', signal: undefined, onEvent: () => {},
      // Defense: a caller passing noteAttachment at the top level
      // must not have it leak onto the assistant row.
      noteAttachment: {
        path: 'zettel/note.md', truncated: false,
        originalCodepoints: 1, attachedCodepoints: 1,
      },
    })
    const row = db.prepare(
      'SELECT note_attachment FROM messages WHERE session_id = ? AND role = ?'
    ).get(id, 'assistant') as { note_attachment: string | null }
    expect(row.note_attachment).toBeNull()
  })

  it('forwards tools and tool_choice to streamClaude', async () => {
    const db = freshDb()
    const id = makeSession(db)
    await runChat({
      db, sessionId: id, userContent: 'hi', ctx: {}, model: 'm',
      signal: undefined, onEvent: () => {},
    })
    const call = vi.mocked(streamClaude).mock.calls[0][0]
    expect(call.tools).toBeDefined()
    expect(call.tools!.map((t) => t.name).sort()).toEqual(
      ['create_file', 'delete_file', 'list_files', 'patch_file', 'read_file', 'rename_file', 'write_file'],
    )
    expect(call.toolChoice).toEqual({ type: 'auto' })
  })

  it('persists partial assistant text and re-throws ChatError(aborted) with assistantId', async () => {
    vi.mocked(streamClaude).mockImplementationOnce(async ({ onToken }: { onToken: (t: string) => void }) => {
      onToken('partial ')
      throw new ChatError('aborted')
    })

    const db = freshDb()
    const id = makeSession(db)
    const events: ChatEvent[] = []

    await expect(
      runChat({
        db, sessionId: id, userContent: 'hi', ctx: {}, model: 'm',
        signal: undefined, onEvent: (e) => { events.push(e) },
      })
    ).rejects.toMatchObject({ reason: 'aborted', assistantId: expect.any(Number) })

    const rows = db.prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY id').all(id) as { role: string; content: string }[]
    expect(rows).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'partial ' },
    ])
  })

  it("persists '[stream interrupted]' when no tokens were received and streamClaude throws", async () => {
    vi.mocked(streamClaude).mockImplementationOnce(async () => {
      throw new ChatError('llm-error')
    })

    const db = freshDb()
    const id = makeSession(db)

    await expect(
      runChat({
        db, sessionId: id, userContent: 'hi', ctx: {}, model: 'm',
        signal: undefined, onEvent: () => {},
      })
    ).rejects.toMatchObject({ reason: 'llm-error', assistantId: expect.any(Number) })

    const rows = db.prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY id').all(id) as { role: string; content: string }[]
    expect(rows).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '[stream interrupted]' },
    ])
  })

  it('wraps a non-ChatError thrown from streamClaude as ChatError(llm-error)', async () => {
    vi.mocked(streamClaude).mockImplementationOnce(async () => {
      throw new Error('boom')
    })

    const db = freshDb()
    const id = makeSession(db)

    await expect(
      runChat({
        db, sessionId: id, userContent: 'hi', ctx: {}, model: 'm',
        signal: undefined, onEvent: () => {},
      })
    ).rejects.toMatchObject({
      reason: 'llm-error',
      assistantId: expect.any(Number),
      message: expect.stringContaining('boom'),
    })

    const rows = db.prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY id').all(id) as { role: string; content: string }[]
    expect(rows).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '[stream interrupted]' },
    ])
  })

  // Multi-round trip: first call returns a tool_use content block,
  // second call returns plain text. Assert events fire in order,
  // tool_results are in the second call's messages, and the
  // assistant turn is persisted as a JSON envelope.
  it('executes a tool call, sends tool_result back, and persists the envelope', async () => {
    // Read the user-supplied path (no real FS) by pointing to the
    // test's own package.json. The tool will fail (unsafe path or
    // missing) but that's fine — we just want a round trip.
    const db = freshDb()
    const id = makeSession(db)
    const events: ChatEvent[] = []

    vi.mocked(streamClaude)
      // Call 1: tool_use (read_file)
      .mockImplementationOnce(async ({ onToken }: { onToken: (t: string) => void }) => {
        onToken('我先看下文件 ')
        const finalMessage = {
          content: [
            { type: 'text', text: '我先看下文件 ' },
            { type: 'tool_use', id: 'toolu_01', name: 'read_file', input: { path: 'nope/missing' } },
          ],
          stop_reason: 'tool_use',
        }
        return {
          text: '我先看下文件 ',
          finalMessage: finalMessage as unknown as StreamResult['finalMessage'],
        }
      })
      // Call 2: text
      .mockImplementationOnce(async ({ onToken }: { onToken: (t: string) => void }) => {
        onToken('ok ')
        onToken('done')
        return {
          text: 'ok done',
          finalMessage: { content: [{ type: 'text', text: 'ok done' }], stop_reason: 'end_turn' } as unknown as StreamResult['finalMessage'],
        }
      })

    await runChat({
      db, sessionId: id, userContent: '请读一下 nope/missing', ctx: {}, model: 'm',
      signal: undefined, onEvent: (e) => { events.push(e) },
    })

    // Event order: user, token, tool_use, tool_result, file_changed
    // (no — read_file doesn't change anything), token, token, done
    const eventTypes = events.map((e) => e.type)
    expect(eventTypes).toEqual([
      'user', 'token', 'tool_use', 'tool_result', 'token', 'token', 'done',
    ])

    // streamClaude was called twice
    expect(vi.mocked(streamClaude)).toHaveBeenCalledTimes(2)

    // Second call's messages include a tool_result block. Note:
    // `secondCall.messages` is a live reference to the orchestrator's
    // `convo` array — by the time we assert, the orchestrator has
    // already pushed a second assistant turn. Find the tool_result
    // user turn by content, not by index.
    const secondCall = vi.mocked(streamClaude).mock.calls[1][0]
    const toolResultTurn = secondCall.messages.find(
      (m) =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        (m.content as { type: string }[]).some((b) => b.type === 'tool_result'),
    )
    expect(toolResultTurn).toBeDefined()
    const blocks = toolResultTurn!.content as { type: string; tool_use_id: string; is_error: boolean }[]
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('tool_result')
    expect(blocks[0].tool_use_id).toBe('toolu_01')
    expect(blocks[0].is_error).toBe(true) // nope/missing is missing

    // Persisted assistant turn is a JSON envelope
    const rows = db.prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY id').all(id) as { role: string; content: string }[]
    const assistantRow = rows.find((r) => r.role === 'assistant')!
    const envelope = JSON.parse(assistantRow.content)
    expect(envelope.v).toBe(1)
    expect(envelope.text).toBe('我先看下文件 ok done')
    // Two rounds: round 1 had [text, tool_use], round 2 had [text].
    expect(envelope.rounds).toHaveLength(2)
    expect(envelope.rounds[0]).toHaveLength(2)
    expect(envelope.rounds[1]).toHaveLength(1)
    expect(envelope.toolCalls).toHaveLength(1)
    expect(envelope.toolCalls[0].id).toBe('toolu_01')
    expect(envelope.toolCalls[0].name).toBe('read_file')
    expect(envelope.toolCalls[0].result.is_error).toBe(true)
  })

  it('rehydrates a past tool-using turn when continuing a conversation', async () => {
    const db = freshDb()
    const id = makeSession(db)

    // Seed: user + assistant tool-using turn (envelope) from a prior run
    db.prepare('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)')
      .run(id, 'user', 'first turn', 1)
    const envelope = {
      v: 1,
      text: '我先看一下',
      rounds: [
        [
          { type: 'text', text: '我先看一下' },
          { type: 'tool_use', id: 'toolu_99', name: 'read_file', input: { path: 'foo' } },
        ],
      ],
      toolCalls: [
        { id: 'toolu_99', name: 'read_file', input: { path: 'foo' }, result: { content: 'file body', is_error: false } },
      ],
    }
    db.prepare('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)')
      .run(id, 'assistant', JSON.stringify(envelope), 2)
    db.prepare('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)')
      .run(id, 'user', 'second turn', 3)

    const events: ChatEvent[] = []
    await runChat({
      db, sessionId: id, userContent: 'second turn', ctx: {}, model: 'm',
      signal: undefined, onEvent: (e) => { events.push(e) },
    })

    // The convo passed to the new turn should include the prior
    // tool_use (in the assistant content blocks) AND a synthesized
    // tool_result user turn.
    const firstCall = vi.mocked(streamClaude).mock.calls[0][0]
    // Find the assistant turn that carries the tool_use
    const assistantToolTurn = firstCall.messages.find(
      (m) => m.role === 'assistant' && Array.isArray(m.content),
    )
    expect(assistantToolTurn).toBeDefined()
    // The very next message should be a user turn with tool_result blocks
    const idx = firstCall.messages.indexOf(assistantToolTurn!)
    const nextUser = firstCall.messages[idx + 1]
    expect(nextUser.role).toBe('user')
    expect(Array.isArray(nextUser.content)).toBe(true)
    const toolResults = nextUser.content as { type: string; tool_use_id: string }[]
    expect(toolResults).toHaveLength(1)
    expect(toolResults[0].type).toBe('tool_result')
    expect(toolResults[0].tool_use_id).toBe('toolu_99')
  })
})
