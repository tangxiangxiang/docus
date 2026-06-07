// Stub — full implementation comes in Task 7. These two interfaces
// are the wire shape shared between server (snake_case DB) and
// client (camelCase TS).
export interface Session {
  id: number
  title: string
  createdAt: number
  updatedAt: number
}

export interface Message {
  id: number
  sessionId: number
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}
