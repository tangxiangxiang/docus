import { describe, it, expect, vi } from 'vitest'
import { pumpStream } from '../ai/llm'
import { ChatError } from '../ai/errors'

// A minimal MessageStream-shaped object: on(event, cb) registers
// handlers, finalMessage() returns a promise that resolves on demand.
function fakeStream() {
  const handlers: Record<string, (arg: any) => void> = {}
  let resolveFinal!: (msg: unknown) => void
  const finalPromise = new Promise<unknown>((r) => { resolveFinal = r })
  return {
    handlers,
    stream: {
      on: (event: string, cb: (arg: any) => void) => { handlers[event] = cb },
      finalMessage: () => finalPromise,
    },
    resolveFinal: (msg: unknown = { content: [], stop_reason: 'end_turn' }) => resolveFinal(msg),
  }
}

describe('pumpStream', () => {
  it('accumulates text events and resolves with {text, finalMessage}', async () => {
    const f = fakeStream()
    const onToken = vi.fn()
    const p = pumpStream(f.stream, onToken)
    f.handlers.text('Hello, ')
    f.handlers.text('world!')
    f.resolveFinal({ content: [{ type: 'text', text: 'Hello, world!' }], stop_reason: 'end_turn' })
    const result = await p
    expect(result.text).toBe('Hello, world!')
    expect(result.finalMessage.stop_reason).toBe('end_turn')
    expect(onToken).toHaveBeenNthCalledWith(1, 'Hello, ')
    expect(onToken).toHaveBeenNthCalledWith(2, 'world!')
  })

  it('rejects with ChatError(aborted) when the signal is pre-aborted', async () => {
    const f = fakeStream()
    const ac = new AbortController()
    ac.abort()
    await expect(pumpStream(f.stream, () => {}, ac.signal)).rejects.toBeInstanceOf(ChatError)
    await expect(pumpStream(f.stream, () => {}, ac.signal)).rejects.toMatchObject({ reason: 'aborted' })
  })

  it('rejects with ChatError(aborted) when the signal aborts mid-stream', async () => {
    const f = fakeStream()
    const ac = new AbortController()
    const onToken = vi.fn()
    const p = pumpStream(f.stream, onToken, ac.signal)
    f.handlers.text('partial ')
    ac.abort()
    await expect(p).rejects.toMatchObject({ reason: 'aborted' })
  })

  it('rejects with ChatError(llm-error) on a stream error event', async () => {
    const f = fakeStream()
    const p = pumpStream(f.stream, () => {})
    f.handlers.error(new Error('boom'))
    await expect(p).rejects.toMatchObject({ reason: 'llm-error' })
  })
})

import { streamClaude } from '../ai/llm'

describe('streamClaude', () => {
  it('throws ChatError(no-api-key) when no auth env var is set', async () => {
    const prevKey = process.env.ANTHROPIC_API_KEY
    const prevToken = process.env.ANTHROPIC_AUTH_TOKEN
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_AUTH_TOKEN
    try {
      await expect(
        streamClaude({ system: 's', messages: [], model: 'm', onToken: () => {} })
      ).rejects.toMatchObject({ reason: 'no-api-key' })
    } finally {
      if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey
      if (prevToken !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = prevToken
    }
  })
})
