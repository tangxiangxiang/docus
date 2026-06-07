import { describe, it, expect, vi } from 'vitest'
import { pumpStream } from '../ai/llm'
import { ChatError } from '../ai/errors'

// A minimal MessageStream-shaped object: on(event, cb) registers
// handlers, finalMessage() returns a promise that resolves on demand.
function fakeStream() {
  const handlers: Record<string, (arg: any) => void> = {}
  let resolveFinal!: () => void
  const finalPromise = new Promise<void>((r) => { resolveFinal = r })
  return {
    handlers,
    stream: {
      on: (event: string, cb: (arg: any) => void) => { handlers[event] = cb },
      finalMessage: () => finalPromise,
    },
    resolveFinal: () => resolveFinal(),
  }
}

describe('pumpStream', () => {
  it('accumulates text events and resolves with the full text', async () => {
    const f = fakeStream()
    const onToken = vi.fn()
    const p = pumpStream(f.stream, onToken)
    f.handlers.text('Hello, ')
    f.handlers.text('world!')
    f.resolveFinal()
    await expect(p).resolves.toBe('Hello, world!')
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
  it('throws ChatError(no-api-key) when ANTHROPIC_API_KEY is unset', async () => {
    const prev = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      await expect(
        streamClaude({ system: 's', messages: [], model: 'm', onToken: () => {} })
      ).rejects.toMatchObject({ reason: 'no-api-key' })
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev
    }
  })
})
