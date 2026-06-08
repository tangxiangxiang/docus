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

  it('appends the current note path and content when ctx has both', () => {
    const out = buildSystemPrompt({
      currentNotePath: 'zettel/foo.md',
      currentNoteContent: 'hello world',
    })
    expect(out).toContain('zettel/foo.md')
    expect(out).toContain('hello world')
    expect(out.startsWith("You're a helpful assistant")).toBe(true)
  })

  it('truncates content at 20_000 chars and appends a marker', () => {
    const big = 'a'.repeat(25_000)
    const out = buildSystemPrompt({
      currentNotePath: 'zettel/big.md',
      currentNoteContent: big,
    })
    expect(out).toContain('a'.repeat(20_000))
    expect(out).not.toContain('a'.repeat(20_001))
    expect(out).toContain('[... truncated; full file at zettel/big.md ...]')
  })

  it('does not truncate when content is exactly 20_000 chars', () => {
    const exact = 'b'.repeat(20_000)
    const out = buildSystemPrompt({
      currentNotePath: 'zettel/exact.md',
      currentNoteContent: exact,
    })
    expect(out).not.toContain('truncated')
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

  it('passes the current note path + content into the system prompt', async () => {
    const db = freshDb()
    const id = makeSession(db)
    await runChat({
      db, sessionId: id, userContent: 'hi',
      ctx: { currentNotePath: 'zettel/note.md', currentNoteContent: 'body' },
      model: 'm', signal: undefined, onEvent: () => {},
    })
    expect(vi.mocked(streamClaude)).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('zettel/note.md'),
      })
    )
    expect(vi.mocked(streamClaude)).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('body'),
      })
    )
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
