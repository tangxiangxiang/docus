// Thin wrapper around @anthropic-ai/sdk. Two exports:
//
//   - pumpStream(stream, onToken, signal?): testable seam. Takes a
//     MessageStream-shaped object, subscribes to its 'text' and
//     'error' events, and resolves with the accumulated text.
//   - streamClaude(opts): high-level. Reads ANTHROPIC_API_KEY from
//     process.env, opens a client.messages.stream, delegates to
//     pumpStream.
//
// The SDK type is opaque (we don't import Anthropic's TS types
// beyond the constructor), so any object with `on` and
// `finalMessage` is a valid stream — that keeps the test surface
// small.
import Anthropic from '@anthropic-ai/sdk'
import { ChatError } from './errors.js'

const MAX_TOKENS = 4096

export type StreamClaudeOpts = {
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  model: string
  onToken: (text: string) => void
  signal?: AbortSignal
}

/**
 * Process an Anthropic MessageStream and resolve with the full
 * assistant text. `onToken` is called for every text delta.
 * Throws ChatError('aborted') on signal abort, ChatError('llm-error')
 * on stream or finalization failure.
 */
export async function pumpStream(
  stream: {
    on: (event: string, cb: (arg: any) => void) => void
    finalMessage: () => Promise<unknown>
  },
  onToken: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ChatError('aborted'))
      return
    }
    let fullText = ''
    stream.on('text', (text: string) => {
      fullText += text
      onToken(text)
    })
    stream.on('error', (err: Error) => {
      reject(new ChatError('llm-error', err.message))
    })
    stream.finalMessage()
      .then(() => resolve(fullText))
      .catch((err: Error) => reject(new ChatError('llm-error', err.message)))
    signal?.addEventListener('abort', () => {
      reject(new ChatError('aborted'))
    })
  })
}

/**
 * Open a streaming Claude call and resolve with the full assistant
 * text. Throws ChatError('no-api-key') if ANTHROPIC_API_KEY is unset.
 */
export async function streamClaude(opts: StreamClaudeOpts): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new ChatError('no-api-key')
  const client = new Anthropic({ apiKey })
  const stream = client.messages.stream({
    model: opts.model,
    max_tokens: MAX_TOKENS,
    system: opts.system,
    messages: opts.messages,
  })
  return pumpStream(stream, opts.onToken, opts.signal)
}
