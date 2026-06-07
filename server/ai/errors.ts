// Tagged error class for the AI chat flow. Every failure surfaced
// from server/ai/{llm,chat}.ts is an instance of ChatError with a
// stable `reason` string. The route layer maps reason → HTTP status
// or SSE event type; nothing else inspects the class.
export type ChatErrorReason =
  | 'no-api-key'
  | 'not-found'
  | 'empty'
  | 'aborted'
  | 'llm-error'

export class ChatError extends Error {
  readonly reason: ChatErrorReason
  constructor(reason: ChatErrorReason, message?: string) {
    super(message ?? reason)
    this.name = 'ChatError'
    this.reason = reason
  }
}
