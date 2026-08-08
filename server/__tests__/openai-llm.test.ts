import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { applyMigrations } from '../db'
import { saveAiSettings } from '../ai/settings'
import * as sessions from '../ai/sessions'
import * as messages from '../ai/messages'

const { createRef } = vi.hoisted(() => ({
  createRef: { value: vi.fn() },
}))

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    chat = { completions: { create: (...args: unknown[]) => createRef.value(...args) } }
  },
}))

import { clearChatBackendCache, getChatBackend } from '../ai/llm'
import { runChat } from '../ai/chat'

const TEST_MASTER_KEY = '11'.repeat(32)
const previousMasterKey = process.env.DOCUS_MASTER_KEY

describe('OpenAI Chat Completions backend', () => {
  let db: Database.Database

  beforeEach(() => {
    process.env.DOCUS_MASTER_KEY = TEST_MASTER_KEY
    db = new Database(':memory:')
    applyMigrations(db)
    saveAiSettings(db, {
      provider: 'openai',
      apiKey: 'test-api-key',
      baseURL: 'https://example.invalid/v1',
      model: 'test-model',
    })
    createRef.value = vi.fn(async () => [
      { choices: [{ delta: { content: 'hello ' }, finish_reason: null }] },
      { choices: [{ delta: { content: 'world' }, finish_reason: 'stop' }] },
    ])
    clearChatBackendCache()
  })

  afterEach(() => {
    db.close()
    clearChatBackendCache()
    if (previousMasterKey === undefined) delete process.env.DOCUS_MASTER_KEY
    else process.env.DOCUS_MASTER_KEY = previousMasterKey
  })

  it('forwards streamed OpenAI text to onToken for persistence and UI streaming', async () => {
    const backend = getChatBackend(db, 'openai')
    const tokens: string[] = []
    const result = await backend.streamRound({
      db,
      model: 'test-model',
      system: 'system',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      onToken: (token) => { tokens.push(token) },
    })

    expect(tokens).toEqual(['hello ', 'world'])
    expect(result.text).toBe('hello world')
    expect(result.finishReason).toBe('stop')
  })

  it('persists a plain OpenAI response through runChat', async () => {
    const session = sessions.createSession(db)
    const result = await runChat({
      db,
      sessionId: session.id,
      userContent: 'hi',
      model: 'test-model',
      ctx: { kind: 'none' },
      onEvent: () => {},
    })

    expect(result.fullText).toBe('hello world')
    expect(messages.listMessages(db, session.id)?.map((m) => [m.role, m.content])).toEqual([
      ['user', 'hi'],
      ['assistant', 'hello world'],
    ])
  })
})
