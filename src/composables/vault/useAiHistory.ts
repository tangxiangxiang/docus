// AI history state + actions. Module-level singleton so NavBar,
// AiPanel, and any future entry point share the same in-memory
// state. Persistence is server-side; this composable is just a
// thin read-through cache + the action helpers that drive it.
//
// sendMessage auto-creates a session if none is active. The
// optimistic update is replaced by the server response on success
// — the temp id is 0, which the rendering layer can use to
// distinguish "pending" from "saved" if needed, but for now the
// messages list re-renders cleanly on the swap.
import { ref, type Ref } from 'vue'
import * as api from '../../lib/ai-api.js'
import type { Session, Message } from '../../lib/ai-api.js'

export interface AiHistory {
  // state
  activeSession: Ref<Session | null>
  messages: Ref<Message[]>
  sessions: Ref<Session[]>
  isLoading: Ref<boolean>

  // actions
  loadActive(): Promise<void>
  refreshSessions(): Promise<void>
  createSession(): Promise<Session>
  switchSession(id: number): Promise<void>
  renameSession(id: number, title: string): Promise<void>
  deleteSession(id: number): Promise<void>
  sendMessage(content: string): Promise<void>
}

let _state: AiHistory | null = null

// Test-only escape hatch: reset the singleton so each test starts
// from a clean slate. Not exported in the public type — tests reach
// for it via a re-export declared in __tests__.
export function __resetForTesting(): void {
  _state = null
}

export function useAiHistory(): AiHistory {
  if (_state) return _state

  const activeSession = ref<Session | null>(null)
  const messages = ref<Message[]>([])
  const sessions = ref<Session[]>([])
  const isLoading = ref(false)

  async function loadActive() {
    isLoading.value = true
    try {
      const id = await api.getActiveSessionId()
      if (id === null) {
        activeSession.value = null
        messages.value = []
        return
      }
      // We have an id but no full session object yet. Construct a
      // minimal one so the UI has something to render in the
      // header; if the user opens the picker, refreshSessions()
      // will fetch the full row (with title) for display.
      activeSession.value = { id, title: '', createdAt: 0, updatedAt: 0 }
      messages.value = await api.listMessages(id)
    } finally {
      isLoading.value = false
    }
  }

  async function refreshSessions() {
    sessions.value = await api.listSessions()
  }

  async function createSession(): Promise<Session> {
    const s = await api.createSession()
    activeSession.value = s
    messages.value = []
    // Newly created sessions are not auto-active on the server
    // (the service createSession is passive by design). We push
    // it as active here because every create-from-UI flow wants
    // the new session to be the one we're looking at.
    await api.setActiveSessionId(s.id)
    return s
  }

  async function switchSession(id: number) {
    isLoading.value = true
    try {
      await api.setActiveSessionId(id)
      activeSession.value = { id, title: '', createdAt: 0, updatedAt: 0 }
      messages.value = await api.listMessages(id)
    } finally {
      isLoading.value = false
    }
  }

  async function renameSession(id: number, title: string) {
    const updated = await api.renameSession(id, title)
    if (activeSession.value?.id === id) activeSession.value = updated
    // Patch the cached sessions list in place so the picker
    // reflects the new title without a full refetch.
    const idx = sessions.value.findIndex((s) => s.id === id)
    if (idx >= 0) sessions.value[idx] = updated
  }

  async function deleteSession(id: number) {
    await api.deleteSession(id)
    sessions.value = sessions.value.filter((s) => s.id !== id)
    if (activeSession.value?.id === id) {
      // Server has already cleared the active pointer as part of
      // deleteSession; mirror that locally.
      activeSession.value = null
      messages.value = []
    }
  }

  async function sendMessage(content: string) {
    if (content.trim().length === 0) return
    if (activeSession.value === null) {
      const s = await createSession()
      activeSession.value = s
    }
    const sessionId = activeSession.value.id

    // Optimistic: append a placeholder with id: 0. The server
    // response replaces it (id becomes the real auto-increment).
    const optimistic: Message = {
      id: 0,
      sessionId,
      role: 'user',
      content,
      createdAt: Date.now(),
    }
    messages.value = [...messages.value, optimistic]

    const saved = await api.appendMessage(sessionId, 'user', content)
    messages.value = messages.value.map((m) => (m.id === 0 && m.content === content ? saved : m))
  }

  _state = {
    activeSession,
    messages,
    sessions,
    isLoading,
    loadActive,
    refreshSessions,
    createSession,
    switchSession,
    renameSession,
    deleteSession,
    sendMessage,
  }
  return _state
}
