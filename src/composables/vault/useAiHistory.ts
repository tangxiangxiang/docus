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
//
// sendAndStream is the streaming equivalent of sendMessage. It
// uses the same optimistic-update pattern but iterates the SSE
// event stream from /api/ai/chat, appending tokens to the
// assistant message in place. Tool events (`tool_use` /
// `tool_result`) accumulate into the assistant message's
// `blocks.toolCalls` so the panel can render a per-tool card.
// `file_changed` events are forwarded to the file-change bus so
// the editor can refresh any open tab.
import { ref, type Ref } from 'vue'
import * as api from '../../lib/ai-api.js'
import type { Session, Message, ChatEvent, ToolCallRecord } from '../../lib/ai-api.js'
import { streamChat } from '../../lib/ai-api.js'
import { publishFileChange } from './useFileChangeBus.js'
import { composeUserMessage } from './noteAttachment.js'

export interface AiHistory {
  // state
  activeSession: Ref<Session | null>
  messages: Ref<Message[]>
  sessions: Ref<Session[]>
  isLoading: Ref<boolean>
  busy: Ref<boolean>
  errorState: Ref<string | null>
  configured: Ref<boolean>

  // actions
  loadActive(): Promise<void>
  refreshSessions(): Promise<void>
  createSession(): Promise<Session>
  switchSession(id: number): Promise<void>
  renameSession(id: number, title: string): Promise<void>
  deleteSession(id: number): Promise<void>
  sendMessage(content: string): Promise<void>
  sendAndStream(
    text: string,
    opts?: { path?: string; content?: string; attach?: boolean },
  ): Promise<void>
  // Cancel the in-flight stream. No-op when nothing is running.
  // The AbortController lives in sendAndStream's closure so the
  // composable's singleton interface doesn't have to expose the
  // controller itself; stop() is the only handle the UI needs.
  stop(): void
}

let _state: AiHistory | null = null

// The currently in-flight AbortController (or null when nothing is
// streaming). Stored in module scope so stop() in the returned
// closure can reach the same controller that sendAndStream created,
// without leaking the controller into the public interface.
let _activeController: AbortController | null = null

// Test-only escape hatch: reset the singleton so each test starts
// from a clean slate. Not exported in the public type — tests reach
// for it via a re-export declared in __tests__.
export function __resetForTesting(): void {
  _state = null
  _activeController = null
}

export function useAiHistory(): AiHistory {
  if (_state) return _state

  const activeSession = ref<Session | null>(null)
  const messages = ref<Message[]>([])
  const sessions = ref<Session[]>([])
  const isLoading = ref(false)
  const busy = ref(false)
  const errorState = ref<string | null>(null)
  const configured = ref(false)

  async function loadActive() {
    isLoading.value = true
    try {
      const out = await api.getActiveSession()
      configured.value = out.configured
      if (out.activeId === null) {
        activeSession.value = null
        messages.value = []
        return
      }
      activeSession.value = { id: out.activeId, title: '', createdAt: 0, updatedAt: 0 }
      messages.value = await api.listMessages(out.activeId)
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
    const idx = sessions.value.findIndex((s) => s.id === id)
    if (idx >= 0) sessions.value[idx] = updated
  }

  async function deleteSession(id: number) {
    await api.deleteSession(id)
    sessions.value = sessions.value.filter((s) => s.id !== id)
    if (activeSession.value?.id === id) {
      activeSession.value = null
      messages.value = []
    }
  }

  async function sendMessage(content: string) {
    return sendAndStream(content)
  }

  async function sendAndStream(
    text: string,
    opts?: { path?: string; content?: string; attach?: boolean },
  ): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return
    if (!configured.value) return
    if (busy.value) return
    if (activeSession.value === null) {
      const s = await createSession()
      activeSession.value = s
    }
    const sessionId = activeSession.value.id

    // Compose the final user message + attachment metadata up front.
    // When the toggle is on, the note body is inlined into the
    // user content as an <attached_note> block; the model sees it
    // in the user message itself, not in the system prompt. When
    // off, the user content is the verbatim typed text and
    // noteAttachment is undefined (server skips the column).
    const { userContent, noteAttachment } = composeUserMessage({
      text: trimmed,
      path: opts?.attach ? opts.path ?? '' : '',
      content: opts?.attach ? opts.content ?? '' : '',
    })

    // Optimistic insert: user message (id 0) + empty assistant (id 0).
    // Object identity is the in-flight discriminator (see spec §3.9).
    // The user message shows the FULL composed text (including the
    // attached note block) so the user sees exactly what was sent.
    // noteAttachment is set immediately so the truncation banner
    // appears on the optimistic bubble without waiting for the
    // server's `user` event (which only carries the row id).
    const optimisticUser: Message = {
      id: 0,
      sessionId,
      role: 'user',
      content: userContent,
      createdAt: Date.now(),
      ...(noteAttachment ? { noteAttachment } : {}),
    }
    const optimisticAssistant: Message = {
      id: 0,
      sessionId,
      role: 'assistant',
      content: '',
      createdAt: Date.now() + 1,
      // Initialize the structured-blocks field so tool events
      // have a place to land. The text is kept in sync with
      // `content` as tokens stream in.
      blocks: { v: 1, text: '', toolCalls: [] },
    }
    messages.value = [...messages.value, optimisticUser, optimisticAssistant]

    busy.value = true
    errorState.value = null
    const ac = new AbortController()
    _activeController = ac

    try {
      for await (const event of streamChat(
        {
          sessionId,
          content: userContent,
          // currentNotePath is still useful even with the toggle
          // off — the system prompt mentions what's on screen, so
          // the model knows it can use read_file if it wants to.
          currentNotePath: opts?.path,
          ...(noteAttachment ? { noteAttachment } : {}),
        },
        ac.signal,
      )) {
        applyEvent(event, optimisticUser, optimisticAssistant)
        if (event.type === 'done' || event.type === 'error') break
      }
      await refreshSessions()
    } catch (e) {
      // Abort is the expected path when the user clicks Stop; surface
      // it as a quiet "[aborted]" tag on the assistant bubble and
      // move on. Other errors are rethrown so the existing
      // finally (which clears busy) still runs, but the catch
      // block doesn't swallow them silently.
      if (ac.signal.aborted) {
        optimisticAssistant.content += '\n\n[aborted]'
        if (optimisticAssistant.blocks) {
          optimisticAssistant.blocks.text = optimisticAssistant.content
        }
        messages.value = messages.value.map((m) =>
          m === optimisticAssistant
            ? { ...m, id: -1, content: optimisticAssistant.content, blocks: optimisticAssistant.blocks }
            : m,
        )
        optimisticAssistant.id = -1
      } else {
        throw e
      }
    } finally {
      _activeController = null
      busy.value = false
    }
  }

  function stop(): void {
    // Just trigger the signal; the catch above handles the
    // visible side-effect. No busy-flag manipulation here —
    // that's the for-await's finally's job.
    _activeController?.abort()
  }

  function applyEvent(
    event: ChatEvent,
    optimisticUser: Message,
    optimisticAssistant: Message,
  ): void {
    if (event.type === 'user') {
      messages.value = messages.value.map((m) =>
        m === optimisticUser ? { ...m, id: event.id } : m
      )
      optimisticUser.id = event.id
    } else if (event.type === 'token') {
      optimisticAssistant.content += event.text
      if (optimisticAssistant.blocks) {
        optimisticAssistant.blocks.text = optimisticAssistant.content
      }
      messages.value = messages.value.map((m) =>
        m === optimisticAssistant
          ? { ...m, content: optimisticAssistant.content, blocks: optimisticAssistant.blocks }
          : m,
      )
    } else if (event.type === 'tool_use') {
      if (!optimisticAssistant.blocks) {
        optimisticAssistant.blocks = { v: 1, text: optimisticAssistant.content, toolCalls: [] }
      }
      const tc: ToolCallRecord = {
        id: event.id,
        name: event.name,
        input: event.input,
        result: { content: '', is_error: false },
      }
      optimisticAssistant.blocks.toolCalls.push(tc)
      messages.value = messages.value.map((m) =>
        m === optimisticAssistant ? { ...m, blocks: optimisticAssistant.blocks } : m,
      )
    } else if (event.type === 'tool_result') {
      if (optimisticAssistant.blocks) {
        const tc = optimisticAssistant.blocks.toolCalls.find((t) => t.id === event.tool_use_id)
        if (tc) {
          tc.result = { content: event.content, is_error: event.is_error }
          messages.value = messages.value.map((m) =>
            m === optimisticAssistant ? { ...m, blocks: optimisticAssistant.blocks } : m,
          )
        }
      }
    } else if (event.type === 'file_changed') {
      // Forward to the file-change bus so the editor can refresh
      // any open tab. We don't mutate the message — the tool card
      // already shows what the AI did.
      publishFileChange({
        path: event.path,
        kind: event.kind,
        newMtime: event.newMtime,
        newRaw: event.newRaw,
        oldPath: event.oldPath,
      })
    } else if (event.type === 'done') {
      messages.value = messages.value.map((m) =>
        m === optimisticAssistant ? { ...m, id: event.assistantId } : m,
      )
      optimisticAssistant.id = event.assistantId
    } else if (event.type === 'error') {
      optimisticAssistant.content += `\n\n[error: ${event.reason}]`
      if (optimisticAssistant.blocks) {
        optimisticAssistant.blocks.text = optimisticAssistant.content
      }
      messages.value = messages.value.map((m) =>
        m === optimisticAssistant
          ? { ...m, id: -1, content: optimisticAssistant.content, blocks: optimisticAssistant.blocks }
          : m,
      )
      optimisticAssistant.id = -1
      errorState.value = event.reason
    }
  }

  _state = {
    activeSession,
    messages,
    sessions,
    isLoading,
    busy,
    errorState,
    configured,
    loadActive,
    refreshSessions,
    createSession,
    switchSession,
    renameSession,
    deleteSession,
    sendMessage,
    sendAndStream,
    stop,
  }
  return _state
}
