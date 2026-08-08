// Real-wire OpenAI-compatible tests. Unlike openai-llm.test.ts, this file
// does not mock the OpenAI SDK: a local HTTP server verifies the request path,
// auth header, JSON body, streaming chunks, and bounded compatibility retry.
import { createServer, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyMigrations } from '../db'
import { saveAiSettings } from '../ai/settings'
import { ChatError } from '../ai/errors'
import { clearChatBackendCache, generateText, getChatBackend } from '../ai/llm'
import * as sessions from '../ai/sessions'
import * as messages from '../ai/messages'
import { runChat } from '../ai/chat'
import aiRoutes from '../ai/routes'

const { testDbRef } = vi.hoisted(() => ({
  testDbRef: { value: null as Database.Database | null },
}))

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>()
  return { ...actual, getDb: () => testDbRef.value! }
})

type ReceivedRequest = {
  method: string
  url: string
  authorization: string | undefined
  body: Record<string, any>
}

type Handler = (request: ReceivedRequest, response: ServerResponse) => void

async function startFakeOpenAiServer(handler: Handler): Promise<{
  baseURL: string
  requests: ReceivedRequest[]
  close: () => Promise<void>
}> {
  const requests: ReceivedRequest[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      let body: Record<string, any> = {}
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { /* empty */ }
      const received = {
        method: req.method ?? '',
        url: req.url ?? '',
        authorization: req.headers.authorization,
        body,
      }
      requests.push(received)
      handler(received, res)
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fake server did not bind to a port')
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      server.close()
      await once(server, 'close')
    },
  }
}

function writeSse(response: ServerResponse, events: unknown[]): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`)
  response.end('data: [DONE]\n\n')
}

const TEST_MASTER_KEY = '44'.repeat(32)
const previousMasterKey = process.env.DOCUS_MASTER_KEY

describe('OpenAI-compatible HTTP protocol', () => {
  let db: Database.Database
  let server: Awaited<ReturnType<typeof startFakeOpenAiServer>> | undefined

  beforeEach(() => {
    process.env.DOCUS_MASTER_KEY = TEST_MASTER_KEY
    db = new Database(':memory:')
    applyMigrations(db)
    testDbRef.value = db
    clearChatBackendCache()
  })

  afterEach(async () => {
    clearChatBackendCache()
    if (server) await server.close()
    server = undefined
    db.close()
    testDbRef.value = null
    if (previousMasterKey === undefined) delete process.env.DOCUS_MASTER_KEY
    else process.env.DOCUS_MASTER_KEY = previousMasterKey
  })

  it('sends streamed text to the correct API-root path with Bearer auth', async () => {
    server = await startFakeOpenAiServer((_request, response) => writeSse(response, [
      { choices: [{ delta: { content: 'hello ' }, finish_reason: null }] },
      { choices: [{ delta: { content: 'world' }, finish_reason: 'stop' }] },
    ]))
    saveAiSettings(db, {
      provider: 'openai',
      apiKey: 'test-api-key',
      baseURL: `${server.baseURL}/v1`,
      model: 'test-model',
    })

    const tokens: string[] = []
    const result = await getChatBackend(db, 'openai').streamRound({
      db,
      model: 'test-model',
      system: 'system',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      onToken: (token) => { tokens.push(token) },
    })

    expect(tokens).toEqual(['hello ', 'world'])
    expect(result.text).toBe('hello world')
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0]).toMatchObject({
      method: 'POST',
      url: '/v1/chat/completions',
      authorization: 'Bearer test-api-key',
    })
    expect(server.requests[0].body).toMatchObject({ model: 'test-model', stream: true })
    expect(server.requests[0].body.tools).toBeUndefined()
  })

  it('preserves arbitrary API path prefixes without adding an extra version', async () => {
    server = await startFakeOpenAiServer((_request, response) => writeSse(response, [
      { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] },
    ]))
    saveAiSettings(db, {
      provider: 'openai',
      apiKey: 'test-api-key',
      baseURL: `${server.baseURL}/custom/openai/v1`,
      model: 'test-model',
    })

    await getChatBackend(db, 'openai').streamRound({
      db,
      model: 'test-model',
      system: 'system',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      onToken: () => {},
    })
    expect(server.requests[0].url).toBe('/custom/openai/v1/chat/completions')
  })

  it('carries real streamed content through runChat into assistant persistence', async () => {
    server = await startFakeOpenAiServer((_request, response) => writeSse(response, [
      { choices: [{ delta: { content: 'hello ' }, finish_reason: null }] },
      { choices: [{ delta: { content: 'world' }, finish_reason: 'stop' }] },
    ]))
    saveAiSettings(db, {
      provider: 'openai',
      apiKey: 'test-api-key',
      baseURL: `${server.baseURL}/v1`,
      model: 'test-model',
    })
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
    expect(messages.listMessages(db, session.id)?.map((message) => [message.role, message.content]))
      .toEqual([['user', 'hi'], ['assistant', 'hello world']])
  })

  it('assembles fragmented tool calls from a real streaming response', async () => {
    server = await startFakeOpenAiServer((_request, response) => writeSse(response, [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_123', type: 'function', function: { name: 'read_' } }] }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'file', arguments: '{"path":"' } }] }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'notes/a"}' } }] }, finish_reason: 'tool_calls' }] },
    ]))
    saveAiSettings(db, {
      provider: 'openai',
      apiKey: 'test-api-key',
      baseURL: `${server.baseURL}/v1`,
      model: 'test-model',
    })

    const result = await getChatBackend(db, 'openai').streamRound({
      db,
      model: 'test-model',
      system: 'system',
      messages: [{ role: 'user', content: 'read it' }],
      tools: [{ name: 'read_file', description: 'read', parameters: { type: 'object' } }],
      onToken: () => {},
    })
    expect(result.toolCalls).toEqual([{ id: 'call_123', name: 'read_file', input: { path: 'notes/a' } }])
    expect(server.requests[0].body.tools).toHaveLength(1)
    expect(server.requests[0].body.tool_choice).toBe('auto')
  })

  it('retries once with max_completion_tokens after an explicit legacy-parameter error', async () => {
    server = await startFakeOpenAiServer((request, response) => {
      if (request.body.max_tokens !== undefined) {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'unsupported parameter: max_tokens' } }))
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content: 'helper works' } }] }))
    })
    saveAiSettings(db, {
      provider: 'openai',
      apiKey: 'test-api-key',
      baseURL: `${server.baseURL}/v1`,
      model: 'test-model',
    })

    const result = await generateText({
      system: 'system',
      user: 'hello',
      model: 'test-model',
      maxTokens: 123,
    })
    expect(result.text).toBe('helper works')
    expect(server.requests).toHaveLength(2)
    expect(server.requests[0].body.max_tokens).toBe(123)
    expect(server.requests[0].body.max_completion_tokens).toBeUndefined()
    expect(server.requests[1].body.max_tokens).toBeUndefined()
    expect(server.requests[1].body.max_completion_tokens).toBe(123)
  })

  it('returns a stable diagnostic when the provider rejects tools', async () => {
    server = await startFakeOpenAiServer((_request, response) => {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'unsupported parameter: tools; invalid credential test-api-key' } }))
    })
    saveAiSettings(db, {
      provider: 'openai',
      apiKey: 'test-api-key',
      baseURL: `${server.baseURL}/v1`,
      model: 'test-model',
    })

    await expect(getChatBackend(db, 'openai').streamRound({
      db,
      model: 'test-model',
      system: 'system',
      messages: [{ role: 'user', content: 'edit it' }],
      tools: [{ name: 'write_file', description: 'write', parameters: { type: 'object' } }],
      onToken: () => {},
    })).rejects.toMatchObject({
      reason: 'llm-error',
      code: 'openai-tools-unsupported',
    } satisfies Partial<ChatError>)
    await expect(getChatBackend(db, 'openai').streamRound({
      db,
      model: 'test-model',
      system: 'system',
      messages: [{ role: 'user', content: 'edit it' }],
      tools: [{ name: 'write_file', description: 'write', parameters: { type: 'object' } }],
      onToken: () => {},
    })).rejects.toMatchObject({ message: expect.not.stringContaining('test-api-key') })
  })

  it('propagates a real provider 4xx through ChatError and the chat SSE route safely', async () => {
    server = await startFakeOpenAiServer((_request, response) => {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'unsupported parameter: tools; invalid credential test-api-key' } }))
    })
    saveAiSettings(db, {
      provider: 'openai',
      apiKey: 'test-api-key',
      baseURL: `${server.baseURL}/v1`,
      model: 'test-model',
    })
    const session = sessions.createSession(db)
    const response = await aiRoutes.fetch(new Request('http://localhost/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, content: 'edit it' }),
    }))
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(body).toContain('"reason":"llm-error"')
    expect(body).toContain('"code":"openai-tools-unsupported"')
    expect(body).toContain('[redacted]')
    expect(body).not.toContain('test-api-key')
  })
})
