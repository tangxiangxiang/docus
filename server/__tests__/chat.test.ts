import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { applyMigrations } from '../db'
import { buildSystemPrompt, runChat } from '../ai/chat'
import { ChatError } from '../ai/errors'
import { streamClaude } from '../ai/llm'

describe('buildSystemPrompt', () => {
  it('returns the base prompt when no note context is provided', () => {
    expect(buildSystemPrompt({})).toBe(
      "You're a helpful assistant for a personal knowledge base."
    )
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
    // The full 25_000 a's are not in the output — only the first 20_000.
    expect(out).toContain('a'.repeat(20_000))
    expect(out).not.toContain('a'.repeat(20_001))
    // Truncation marker is present, naming the file.
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

// Mock the SDK wrapper so tests don't hit the network. The fake
// invokes the onToken callback for each chunk, then resolves with
// the joined text.
vi.mock('../ai/llm', () => ({
  streamClaude: vi.fn(async ({ onToken }: { onToken: (t: string) => void }) => {
    onToken('hi ')
    onToken('there')
    return 'hi there'
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
  })

  it('throws ChatError(not-found) when the session does not exist', async () => {
    const db = freshDb()
    const tokens: string[] = []
    await expect(
      runChat({
        db,
        sessionId: 999,
        userContent: 'hi',
        ctx: {},
        model: 'm',
        onUserId: () => {},
        onToken: (t) => { tokens.push(t) },
      })
    ).rejects.toMatchObject({ reason: 'not-found' })
  })

  it('throws ChatError(empty) when the user content is whitespace', async () => {
    const db = freshDb()
    const id = makeSession(db)
    await expect(
      runChat({
        db, sessionId: id, userContent: '   ', ctx: {}, model: 'm',
        onUserId: () => {}, onToken: () => {},
      })
    ).rejects.toMatchObject({ reason: 'empty' })
  })

  it('persists user then assistant message and emits tokens in order', async () => {
    const db = freshDb()
    const id = makeSession(db)
    const userIds: number[] = []
    const tokens: string[] = []
    const { userId, assistantId } = await runChat({
      db,
      sessionId: id,
      userContent: 'hi',
      ctx: {},
      model: 'm',
      onUserId: (u) => { userIds.push(u) },
      onToken: (t) => { tokens.push(t) },
    })
    expect(userIds).toEqual([userId])
    expect(tokens).toEqual(['hi ', 'there'])
    expect(assistantId).toBeGreaterThan(userId)
    const rows = db.prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY id').all(id) as { role: string; content: string }[]
    expect(rows).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hi there' },
    ])
  })

  it('passes the current note path + content into the system prompt', async () => {
    const { streamClaude } = await import('../ai/llm')
    const db = freshDb()
    const id = makeSession(db)
    await runChat({
      db, sessionId: id, userContent: 'hi',
      ctx: { currentNotePath: 'zettel/note.md', currentNoteContent: 'body' },
      model: 'm', onUserId: () => {}, onToken: () => {},
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

  it('persists partial assistant text and re-throws ChatError(aborted) with assistantId', async () => {
    vi.mocked(streamClaude).mockImplementationOnce(async ({ onToken }: { onToken: (t: string) => void }) => {
      onToken('partial ')
      throw new ChatError('aborted')
    })

    const db = freshDb()
    const id = makeSession(db)
    const tokens: string[] = []

    await expect(
      runChat({
        db,
        sessionId: id,
        userContent: 'hi',
        ctx: {},
        model: 'm',
        onUserId: () => {},
        onToken: (t) => { tokens.push(t) },
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
        db,
        sessionId: id,
        userContent: 'hi',
        ctx: {},
        model: 'm',
        onUserId: () => {},
        onToken: () => {},
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
        db,
        sessionId: id,
        userContent: 'hi',
        ctx: {},
        model: 'm',
        onUserId: () => {},
        onToken: () => {},
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
})
