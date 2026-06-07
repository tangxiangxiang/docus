// @vitest-environment jsdom
// Tests for the useAiHistory composable. We stub global.fetch (the
// same pattern as src/lib/__tests__/ai-api.test.ts) so the
// composable exercises the full flow without hitting the network.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useAiHistory, __resetForTesting, type AiHistory } from '../useAiHistory'

interface Harness {
  activeSession: Ref<{ id: number; title: string; createdAt: number; updatedAt: number } | null>
  messages: Ref<{ id: number; sessionId: number; role: 'user' | 'assistant'; content: string; createdAt: number }[]>
  sessions: Ref<{ id: number; title: string; createdAt: number; updatedAt: number }[]>
  isLoading: Ref<boolean>
  api: AiHistory
}

function setup(): Harness {
  let captured: AiHistory | null = null
  const Comp = defineComponent({
    setup() {
      const api = useAiHistory()
      captured = api
      return () => h('div')
    },
  })
  mount(Comp)
  const api = captured!
  return { ...api, api } as unknown as Harness
}

type FetchResponse = { status: number; body: unknown }
let queue: FetchResponse[] = []

beforeEach(() => {
  queue = []
  globalThis.fetch = vi.fn(async () => {
    const r = queue.shift() ?? { status: 200, body: {} }
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  __resetForTesting()
})

describe('useAiHistory', () => {
  it('starts with no active session, empty messages, and isLoading=false', () => {
    const h = setup()
    expect(h.activeSession.value).toBeNull()
    expect(h.messages.value).toEqual([])
    expect(h.sessions.value).toEqual([])
    expect(h.isLoading.value).toBe(false)
  })

  describe('loadActive', () => {
    it('with no active session, leaves activeSession null and messages empty', async () => {
      queue.push({ status: 200, body: { sessionId: null } })
      const h = setup()
      await h.api.loadActive()
      expect(h.activeSession.value).toBeNull()
      expect(h.messages.value).toEqual([])
    })

    it('with an active session, populates activeSession and messages', async () => {
      queue.push({ status: 200, body: { sessionId: 42 } })
      queue.push({ status: 200, body: [{ id: 1, sessionId: 42, role: 'user', content: 'hi', createdAt: 100 }] })
      const h = setup()
      await h.api.loadActive()
      expect(h.activeSession.value).toEqual({ id: 42, title: '', createdAt: expect.any(Number), updatedAt: expect.any(Number) })
      expect(h.messages.value[0].content).toBe('hi')
    })
  })

  describe('sendMessage', () => {
    it('auto-creates a session when none is active, then appends the message', async () => {
      // loadActive: no active
      queue.push({ status: 200, body: { sessionId: null } })
      // createSession
      queue.push({ status: 201, body: { id: 1, title: '', createdAt: 1, updatedAt: 1 } })
      // setActiveSessionId (called inside createSession)
      queue.push({ status: 200, body: { sessionId: 1 } })
      // appendMessage
      queue.push({ status: 201, body: { id: 7, sessionId: 1, role: 'user', content: 'x', createdAt: 2 } })

      const h = setup()
      await h.api.loadActive()
      await h.api.sendMessage('x')
      expect(h.activeSession.value?.id).toBe(1)
      expect(h.messages.value).toHaveLength(1)
      expect(h.messages.value[0].id).toBe(7) // not the optimistic 0
    })

    it('is a no-op for empty / whitespace content', async () => {
      const h = setup()
      await h.api.sendMessage('   ')
      expect(h.messages.value).toEqual([])
    })

    it('replaces the optimistic message with the server response', async () => {
      queue.push({ status: 200, body: { sessionId: 5 } })
      queue.push({ status: 200, body: [] })
      queue.push({ status: 201, body: { id: 99, sessionId: 5, role: 'user', content: 'hello', createdAt: 3 } })

      const h = setup()
      await h.api.loadActive()
      await h.api.sendMessage('hello')
      expect(h.messages.value).toHaveLength(1)
      expect(h.messages.value[0].id).toBe(99)
      expect(h.messages.value[0].content).toBe('hello')
    })
  })

  describe('switchSession', () => {
    it('sets the active session, fetches messages, and updates state', async () => {
      queue.push({ status: 200, body: { sessionId: 42 } }) // setActive
      queue.push({ status: 200, body: [{ id: 1, sessionId: 42, role: 'user', content: 'm', createdAt: 1 }] })
      const h = setup()
      await h.api.switchSession(42)
      expect(h.activeSession.value?.id).toBe(42)
      expect(h.messages.value[0].content).toBe('m')
    })
  })

  describe('refreshSessions', () => {
    it('populates the sessions list', async () => {
      queue.push({ status: 200, body: [{ id: 1, title: 'a', createdAt: 1, updatedAt: 1 }] })
      const h = setup()
      await h.api.refreshSessions()
      expect(h.sessions.value).toHaveLength(1)
      expect(h.sessions.value[0].title).toBe('a')
    })
  })
})
