// Thin wrapper around @anthropic-ai/sdk. Two exports:
//
//   - pumpStream(stream, onToken, signal?): testable seam. Takes a
//     MessageStream-shaped object, subscribes to its 'text' and
//     'error' events, and resolves with `{text, finalMessage}` so the
//     caller can inspect content blocks (incl. tool_use) and
//     stop_reason after the stream ends.
//   - streamClaude(opts): high-level. Reads auth + base URL from
//     process.env, opens a `client.messages.stream`, delegates to
//     pumpStream. Forwards `tools` and `toolChoice` if the caller
//     passes them.
//
// Auth resolution order: environment > DB settings. Environment
// covers deployment/admin overrides (`ANTHROPIC_AUTH_TOKEN`, then
// `ANTHROPIC_API_KEY`, plus optional `ANTHROPIC_BASE_URL` /
// `ANTHROPIC_MODEL`). DB settings power the in-app Settings dialog
// for desktop/personal use.
//
// The SDK type is opaque (we don't import Anthropic's TS types
// beyond the constructor), so any object with `on` and
// `finalMessage` is a valid stream — that keeps the test surface
// small. The `finalMessage` return is typed as `unknown` and cast
// to `Anthropic.Message` in the wrapper.
import Anthropic from '@anthropic-ai/sdk'
import type { Message } from '@anthropic-ai/sdk/resources/messages/messages'
import { ChatError } from './errors.js'
import { getDb } from '../db.js'
import { getAiRuntimeConfig } from './settings.js'
import type { Database as DatabaseT } from 'better-sqlite3'

const MAX_TOKENS = 4096

export type StreamResult = {
  text: string
  finalMessage: Message
}

export type StreamClaudeOpts = {
  system: string
  // Widened from `string` to `string | ContentBlockParam[]` so a
  // multi-round conversation can echo back tool_use (assistant) and
  // tool_result (user) content blocks.
  messages: { role: 'user' | 'assistant'; content: string | unknown[] }[]
  model: string
  onToken: (text: string) => void
  signal?: AbortSignal
  tools?: Anthropic.Tool[]
  toolChoice?: Anthropic.ToolChoice
}

/**
 * Resolve the auth token from env/DB settings. Kept as a narrow
 * export for older callers/tests that only need the configured bit;
 * new code should prefer resolveAiRuntimeConfig() when it also needs
 * model/baseURL.
 */
export function resolveApiKey(): string | undefined {
  return resolveAiRuntimeConfig().apiKey
}

export function resolveAiRuntimeConfig(db: DatabaseT = getDb()) {
  return getAiRuntimeConfig(db)
}

/**
 * Process an Anthropic MessageStream and resolve with the
 * accumulated text + the final Message (so the caller can inspect
 * content blocks such as tool_use). `onToken` is called for every
 * text delta. Throws ChatError('aborted') on signal abort,
 * ChatError('llm-error') on stream or finalization failure.
 */
export async function pumpStream(
  stream: {
    on: (event: string, cb: (arg: any) => void) => void
    finalMessage: () => Promise<unknown>
  },
  onToken: (text: string) => void,
  signal?: AbortSignal,
): Promise<StreamResult> {
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
      .then((m) => resolve({ text: fullText, finalMessage: m as Message }))
      .catch((err: Error) => reject(new ChatError('llm-error', err.message)))
    signal?.addEventListener('abort', () => {
      reject(new ChatError('aborted'))
    })
  })
}

/**
 * Open a streaming Claude call and resolve with the final text and
 * full Message. Throws ChatError('no-api-key') if no auth token is
 * set, ChatError('aborted') on signal abort, ChatError('llm-error')
 * on stream or finalization failure.
 */
export async function streamClaude(opts: StreamClaudeOpts): Promise<StreamResult> {
  const cfg = resolveAiRuntimeConfig()
  if (!cfg.apiKey) throw new ChatError('no-api-key')
  const client = new Anthropic(cfg.baseURL ? { apiKey: cfg.apiKey, baseURL: cfg.baseURL } : { apiKey: cfg.apiKey })
  const stream = client.messages.stream({
    model: opts.model,
    max_tokens: MAX_TOKENS,
    system: opts.system,
    messages: opts.messages as Anthropic.MessageParam[],
    ...(opts.tools ? { tools: opts.tools } : {}),
    ...(opts.toolChoice ? { tool_choice: opts.toolChoice } : {}),
  })
  // The SDK's MessageStream uses a generic event-name signature; pumpStream
  // intentionally accepts a looser duck-typed shape so tests can pass a
  // minimal stub without wiring the full event map. The runtime shape is
  // compatible (it's the same class), so the cast is safe.
  return pumpStream(stream as unknown as Parameters<typeof pumpStream>[0], opts.onToken, opts.signal)
}
