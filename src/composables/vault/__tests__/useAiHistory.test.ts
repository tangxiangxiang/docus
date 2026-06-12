// @vitest-environment jsdom
// Tests for the useAiHistory composable. We stub global.fetch (the
// same pattern as src/lib/__tests__/ai-api.test.ts) so the
// composable exercises the full flow without hitting the network.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useAiHistory, __resetForTesting, type AiHistory } from '../useAiHistory'
import { streamChat, type ChatRequest } from '../../../lib/ai-api'

interface Harness {
  activeSession: Ref<{ id: number; title: string; createdAt: number; updatedAt: number } | null>
  messages: Ref<{ id: number; sessionId: number; role: 'user' | 'assistant'; content: string; createdAt: number; blocks?: { v: 1; text: string; toolCalls: { id: string; name: string; input: Record<string, unknown>; result: { content: string; is_error: boolean } }[] }; noteAttachment?: { path: string; truncated: boolean; originalCodepoints: number; attachedCodepoints: number } }[]>
  sessions: Ref<{ id: number; title: string; createdAt: number; updatedAt: number }[]>
  isLoading: Ref<boolean>
  busy: Ref<boolean>
  errorState: Ref<string | null>
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
      queue.push({ status: 200, body: { activeId: null, configured: true } })
      const h = setup()
      await h.api.loadActive()
      expect(h.activeSession.value).toBeNull()
      expect(h.messages.value).toEqual([])
    })

    it('with an active session, populates activeSession and messages', async () => {
      queue.push({ status: 200, body: { activeId: 42, configured: true } })
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
      queue.push({ status: 200, body: { activeId: null, configured: true } })
      // createSession
      queue.push({ status: 201, body: { id: 1, title: '', createdAt: 1, updatedAt: 1 } })
      // setActiveSessionId (called inside createSession)
      queue.push({ status: 200, body: { sessionId: 1 } })
      // refreshSessions after done
      queue.push({ status: 200, body: [] })

      const h = setup()
      await h.api.loadActive()
      await h.api.sendMessage('x')
      expect(h.activeSession.value?.id).toBe(1)
      expect(h.messages.value).toHaveLength(2)
      expect(h.messages.value[0]).toMatchObject({ id: 7, role: 'user', content: 'x' })
      expect(h.messages.value[1]).toMatchObject({ id: 8, role: 'assistant' })
    })

    it('is a no-op for empty / whitespace content', async () => {
      const h = setup()
      await h.api.sendMessage('   ')
      expect(h.messages.value).toEqual([])
    })

    it('replaces the optimistic message with the server response', async () => {
      queue.push({ status: 200, body: { activeId: 5, configured: true } })
      queue.push({ status: 200, body: [] })
      // refreshSessions after done
      queue.push({ status: 200, body: [] })

      const h = setup()
      await h.api.loadActive()
      await h.api.sendMessage('hello')
      expect(h.messages.value).toHaveLength(2)
      expect(h.messages.value[0]).toMatchObject({ id: 7, role: 'user', content: 'hello' })
      expect(h.messages.value[1]).toMatchObject({ id: 8, role: 'assistant' })
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

// streamChat is mocked at the module boundary. The default mock
// produces a happy-path event sequence: user id, two tokens, done.
vi.mock('../../../lib/ai-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/ai-api')>()
  return {
    ...actual,
    streamChat: vi.fn(async function* () {
      yield { type: 'user', id: 7 }
      yield { type: 'token', text: 'hi ' }
      yield { type: 'token', text: 'there' }
      yield { type: 'done', userId: 7, assistantId: 8 }
    }),
  }
})

describe('sendAndStream', () => {
  it('optimistically inserts user + assistant, then replaces ids on done', async () => {
    // loadActive
    queue.push({ status: 200, body: { activeId: 1, configured: true } })
    queue.push({ status: 200, body: [] })
    // refreshSessions after done
    queue.push({ status: 200, body: [] })

    const h = setup()
    await h.api.loadActive()
    await h.api.sendAndStream('hello')
    expect(h.messages.value).toHaveLength(2)
    expect(h.messages.value[0]).toMatchObject({ id: 7, role: 'user', content: 'hello' })
    expect(h.messages.value[1]).toMatchObject({
      id: 8, role: 'assistant', content: 'hi there',
    })
    expect(h.busy.value).toBe(false)
    expect(h.errorState.value).toBeNull()
  })

  it('appends [error: ...] to the assistant and sets errorState on error event', async () => {
    const { streamChat } = await import('../../../lib/ai-api')
    vi.mocked(streamChat).mockImplementationOnce(async function* () {
      yield { type: 'user', id: 9 }
      yield { type: 'token', text: 'partial ' }
      yield { type: 'error', reason: 'llm-error' }
    })

    queue.push({ status: 200, body: { activeId: 1, configured: true } })
    queue.push({ status: 200, body: [] })

    const h = setup()
    await h.api.loadActive()
    await h.api.sendAndStream('hi')
    expect(h.messages.value[0].id).toBe(9)
    expect(h.messages.value[1].id).toBe(-1)
    expect(h.messages.value[1].content).toContain('partial ')
    expect(h.messages.value[1].content).toContain('[error: llm-error]')
    expect(h.errorState.value).toBe('llm-error')
  })

  it('is a no-op when called while busy is true', async () => {
    const { streamChat } = await import('../../../lib/ai-api')
    // First call: hangs (returns a never-resolving async gen).
    // Second call: would yield, but should be a no-op.
    vi.mocked(streamChat)
      .mockImplementationOnce(async function* () {
        // hang forever
        await new Promise(() => {})
      })
      .mockImplementationOnce(async function* () {
        yield { type: 'user', id: 1 }
        yield { type: 'done', userId: 1, assistantId: 2 }
      })

    queue.push({ status: 200, body: { activeId: 1, configured: true } })
    queue.push({ status: 200, body: [] })

    const h = setup()
    await h.api.loadActive()
    const p1 = h.api.sendAndStream('first')
    // Don't await — busy is now true.
    await h.api.sendAndStream('second')
    // The second call should not have queued any messages beyond
    // what the first one already optimistically inserted.
    expect(h.messages.value.filter((m) => m.content === 'second')).toHaveLength(0)
    // Clean up: resolve p1 by aborting. (Not strictly needed; the
    // test will end and vitest will GC the dangling promise.)
    void p1
  })

  it('accumulates tool_use / tool_result into the assistant blocks and forwards file_changed to the bus', async () => {
    const { streamChat } = await import('../../../lib/ai-api')
    // Reset the mockImplementationOnce queue from previous tests
    // (the "busy" test leaves a hanging implementation) and re-set
    // the file-level default before adding our own.
    vi.mocked(streamChat).mockReset()
    vi.mocked(streamChat).mockImplementation(async function* () {
      yield { type: 'user', id: 7 }
      yield { type: 'token', text: 'hi ' }
      yield { type: 'token', text: 'there' }
      yield { type: 'done', userId: 7, assistantId: 8 }
    })
    vi.mocked(streamChat).mockImplementationOnce(async function* () {
      yield { type: 'user', id: 7 }
      yield { type: 'token', text: '我先看下文件 ' }
      yield { type: 'tool_use', id: 'toolu_01', name: 'read_file', input: { path: 'a' } }
      yield { type: 'tool_result', tool_use_id: 'toolu_01', content: 'file body', is_error: false }
      yield { type: 'file_changed', path: 'a', kind: 'write', newMtime: 1, newRaw: 'file body' }
      yield { type: 'token', text: '改好了' }
      yield { type: 'done', userId: 7, assistantId: 8 }
    })

    queue.push({ status: 200, body: { activeId: 1, configured: true } })
    queue.push({ status: 200, body: [] })
    queue.push({ status: 200, body: [] }) // refreshSessions after done

    const { __resetFileChangeBusForTesting, getFileChangeBus } = await import('../useFileChangeBus')
    __resetFileChangeBusForTesting()
    const bus = getFileChangeBus()

    const h = setup()
    await h.api.loadActive()
    await h.api.sendAndStream('hi')
    const assistant = h.messages.value[1]
    expect(assistant.content).toBe('我先看下文件 改好了')
    expect(assistant.blocks?.toolCalls).toHaveLength(1)
    expect(assistant.blocks?.toolCalls[0]).toMatchObject({
      id: 'toolu_01',
      name: 'read_file',
      input: { path: 'a' },
      result: { content: 'file body', is_error: false },
    })
    expect(bus.value).toHaveLength(1)
    expect(bus.value[0]).toMatchObject({ path: 'a', kind: 'write', newMtime: 1, newRaw: 'file body', seq: 1 })
    expect(h.messages.value[0].id).toBe(7)
    expect(h.messages.value[1].id).toBe(8)
  })

  it('stop() aborts an in-flight stream, clears busy, and tags the assistant with [aborted]', async () => {
    const { streamChat } = await import('../../../lib/ai-api')
    vi.mocked(streamChat).mockReset()
    // The mock has to honor the AbortSignal: when stop() fires,
    // useAiHistory's AbortController rejects the signal, and the
    // in-flight generator's hang needs to bail out at that point.
    // In production streamChat passes the signal to fetch (which
    // raises AbortError on abort); here we replicate that by
    // listening to the signal ourselves.
    vi.mocked(streamChat).mockImplementation(async function* (_req, signal) {
      yield { type: 'user', id: 7 }
      yield { type: 'token', text: 'partial' }
      await new Promise<void>((_resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException('aborted', 'AbortError'))
          return
        }
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })

    queue.push({ status: 200, body: { activeId: 1, configured: true } })
    queue.push({ status: 200, body: [] })

    const h = setup()
    await h.api.loadActive()
    const p = h.api.sendAndStream('hi')
    // Give the microtask queue a chance to enter the streamChat
    // generator and start hanging.
    await Promise.resolve()
    expect(h.busy.value).toBe(true)

    h.api.stop()
    await p

    expect(h.busy.value).toBe(false)
    const assistant = h.messages.value[1]
    expect(assistant.id).toBe(-1)
    expect(assistant.content).toContain('partial')
    expect(assistant.content).toContain('[aborted]')
    // No errorState — abort is a user action, not an error.
    expect(h.errorState.value).toBeNull()
  })

  it('stop() is a no-op when nothing is in flight', async () => {
    const h = setup()
    // Just call it. Should not throw, should not flip busy.
    h.api.stop()
    expect(h.busy.value).toBe(false)
  })
})

// 📎 attach-note toggle. When the toggle is on, the composable
// composes the user content with the note body inlined, sets
// noteAttachment on the optimistic user message, and forwards the
// same metadata on the wire. When off, the user content is the
// typed text verbatim and no noteAttachment is sent.
//
// These tests pin both the optimistic-render contract (so the
// banner appears before the SSE `user` event) and the wire
// contract (so the server can persist the metadata).
describe('sendAndStream attach toggle', () => {
  // The default module-level streamChat mock from the previous
  // describe block was reset/replaced by the "stop()" test, which
  // left it as an abort-aware implementation that hangs forever
  // for non-aborted signals. Pin a happy-path default here so
  // these tests don't carry the leftover mock.
  beforeEach(() => {
    vi.mocked(streamChat).mockReset()
    vi.mocked(streamChat).mockImplementation(async function* () {
      yield { type: 'user', id: 7 }
      yield { type: 'token', text: 'ok' }
      yield { type: 'done', userId: 7, assistantId: 8 }
    })
  })

  it('without opts.attach, the optimistic user message is the typed text and has no noteAttachment', async () => {
    queue.push({ status: 200, body: { activeId: 1, configured: true } })
    queue.push({ status: 200, body: [] })
    queue.push({ status: 200, body: [] }) // refreshSessions after done

    const h = setup()
    await h.api.loadActive()
    await h.api.sendAndStream('hi', { path: 'inbox/foo.md', content: 'body' })
    const user = h.messages.value[0]
    expect(user.content).toBe('hi')
    expect(user.noteAttachment).toBeUndefined()
  })

  it('with opts.attach=true, the optimistic user message carries the attached note block and the metadata', async () => {
    queue.push({ status: 200, body: { activeId: 1, configured: true } })
    queue.push({ status: 200, body: [] })
    queue.push({ status: 200, body: [] }) // refreshSessions after done

    const h = setup()
    await h.api.loadActive()
    await h.api.sendAndStream('hi', {
      path: 'inbox/foo.md',
      content: 'body',
      attach: true,
    })
    const user = h.messages.value[0]
    expect(user.content).toContain('hi')
    expect(user.content).toContain('<attached_note path="inbox/foo.md">')
    expect(user.content).toContain('body')
    expect(user.noteAttachment).toEqual({
      path: 'inbox/foo.md',
      truncated: false,
      originalCodepoints: 4,
      attachedCodepoints: 4,
    })
  })

  it('forwards noteAttachment and the composed content on the wire when attach is on', async () => {
    queue.push({ status: 200, body: { activeId: 1, configured: true } })
    queue.push({ status: 200, body: [] })
    queue.push({ status: 200, body: [] }) // refreshSessions after done

    const capture: ChatRequest[] = []
    vi.mocked(streamChat).mockImplementation(async function* (req) {
      capture.push(req)
      yield { type: 'user', id: 7 }
      yield { type: 'token', text: 'ok' }
      yield { type: 'done', userId: 7, assistantId: 8 }
    })

    const h = setup()
    await h.api.loadActive()
    await h.api.sendAndStream('hi', {
      path: 'inbox/foo.md',
      content: 'body',
      attach: true,
    })
    expect(capture).toHaveLength(1)
    expect(capture[0].currentNotePath).toBe('inbox/foo.md')
    expect(capture[0].content).toContain('<attached_note path="inbox/foo.md">')
    expect(capture[0].noteAttachment).toEqual({
      path: 'inbox/foo.md',
      truncated: false,
      originalCodepoints: 4,
      attachedCodepoints: 4,
    })
  })

  it('does NOT send noteAttachment (and inlines nothing) when attach is off even if a note is open', async () => {
    queue.push({ status: 200, body: { activeId: 1, configured: true } })
    queue.push({ status: 200, body: [] })
    queue.push({ status: 200, body: [] }) // refreshSessions after done

    const capture: ChatRequest[] = []
    vi.mocked(streamChat).mockImplementation(async function* (req) {
      capture.push(req)
      yield { type: 'user', id: 7 }
      yield { type: 'done', userId: 7, assistantId: 8 }
    })

    const h = setup()
    await h.api.loadActive()
    await h.api.sendAndStream('just asking', {
      path: 'inbox/foo.md',
      content: 'huge note body',
      attach: false,
    })
    expect(capture[0].noteAttachment).toBeUndefined()
    expect(capture[0].content).toBe('just asking')
    expect(h.messages.value[0].noteAttachment).toBeUndefined()
  })

  it('truncates the attached note at 20K code points and reports it in the metadata', async () => {
    queue.push({ status: 200, body: { activeId: 1, configured: true } })
    queue.push({ status: 200, body: [] })
    queue.push({ status: 200, body: [] }) // refreshSessions after done

    const big = 'a'.repeat(25_000)
    const h = setup()
    await h.api.loadActive()
    await h.api.sendAndStream('hi', {
      path: 'inbox/big.md',
      content: big,
      attach: true,
    })
    const user = h.messages.value[0]
    expect(user.noteAttachment?.truncated).toBe(true)
    expect(user.noteAttachment?.originalCodepoints).toBe(25_000)
    expect(user.noteAttachment?.attachedCodepoints).toBe(20_000)
    expect(user.content).toContain('[... truncated; full file at inbox/big.md ...]')
    // The first 20K chars survived, the next 5K did not.
    expect(user.content).toContain('a'.repeat(20_000))
    expect(user.content).not.toContain('a'.repeat(20_001))
  })

  it('attaches even when opts.attach=true but content is empty (no-op attachment)', async () => {
    // Defensive: an open note with empty content (e.g. a brand-new
    // untitled file) shouldn't produce a no-content block. The
    // user text is sent verbatim and no noteAttachment is set.
    queue.push({ status: 200, body: { activeId: 1, configured: true } })
    queue.push({ status: 200, body: [] })
    queue.push({ status: 200, body: [] }) // refreshSessions after done

    const h = setup()
    await h.api.loadActive()
    await h.api.sendAndStream('hi', {
      path: 'inbox/empty.md',
      content: '',
      attach: true,
    })
    expect(h.messages.value[0].content).toBe('hi')
    expect(h.messages.value[0].noteAttachment).toBeUndefined()
  })
})
