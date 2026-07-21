// @vitest-environment jsdom

// Edit-10.2 AiPanel integration: onSend captures the live workspace
// context synchronously BEFORE any async work, feeds the legacy
// path-only transport only for a live Document, and drives the
// composer/messages path chip + quick prompts from the same capture.
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '../../../components/vault/tabs'
import type {
  AiDiffContext,
  AiDocumentContext,
  AiHistoryContext,
  AiLiveContextCapture,
  AiRecoveryContext,
} from '../../../composables/vault/aiLiveContext'
import { createVaultContext } from '../../../composables/vault/context/createVaultContext'
import { createVaultFileChanges } from '../../../composables/vault/context/fileChanges'
import { provideVaultContext } from '../../../composables/vault/context/useVaultContext'
import { useAiHistory } from '../../../composables/vault/useAiHistory'
import { useI18n } from '../../../composables/useI18n'
import AiPanel from '../AiPanel.vue'
import AiChatMessages from '../AiChatMessages.vue'
import AiComposer from '../AiComposer.vue'

// The network layer is not part of this stage: the whole transport
// (session creation, streaming) is stubbed so only the capture/send
// orchestration is exercised.
vi.mock('../../../composables/vault/useAiHistory', async () => {
  const { ref: vueRef } = await import('vue')
  const history = {
    activeSession: vueRef(null),
    messages: vueRef([]),
    sessions: vueRef([]),
    isLoading: vueRef(false),
    busy: vueRef(false),
    errorState: vueRef<string | null>(null),
    configured: vueRef(true),
    loadActive: async () => {},
    refreshSessions: async () => {},
    createSession: async () => ({ id: 1, title: '', createdAt: 0, updatedAt: 0 }),
    switchSession: async () => {},
    renameSession: async () => {},
    deleteSession: async () => {},
    sendMessage: async () => {},
    sendAndStream: async (_text: string, _opts?: { path?: string }) => {},
    stop: () => {},
  }
  return { useAiHistory: () => history }
})

function documentCapture(path = 'notes/a.md'): AiLiveContextCapture {
  const context: AiDocumentContext = {
    v: 1,
    kind: 'document',
    capturedAt: 1,
    vaultId: 'vault-a',
    workspaceTabId: path,
    identity: { documentId: 'doc-a', path },
    title: 'a',
    raw: 'body',
    revision: 1,
    savedRevision: 1,
    dirty: false,
    saveStatus: 'idle',
  }
  return { status: 'ready', context }
}

function historyCapture(path = 'notes/h.md'): AiLiveContextCapture {
  const context: AiHistoryContext = {
    v: 1,
    kind: 'history',
    capturedAt: 1,
    vaultId: 'vault-a',
    workspaceTabId: `history:${path}`,
    readOnly: true,
    identity: { path, revisionId: 'rev-1', revisionTime: 1 },
    title: 'h',
    raw: 'old body',
  }
  return { status: 'ready', context }
}

function diffCapture(path = 'notes/d.md'): AiLiveContextCapture {
  const context: AiDiffContext = {
    v: 1,
    kind: 'diff',
    capturedAt: 1,
    vaultId: 'vault-a',
    workspaceTabId: `diff:${path}`,
    readOnly: true,
    identity: { path, revisionId: 'rev-1', revisionTime: 1, currentDocumentId: 'doc-a' },
    title: 'd',
    before: { raw: 'old', source: 'history' },
    after: { raw: 'new', source: 'live-editor', dirty: true },
  }
  return { status: 'ready', context }
}

function recoveryCapture(path = 'notes/r.md'): AiLiveContextCapture {
  const context: AiRecoveryContext = {
    v: 1,
    kind: 'recovery',
    capturedAt: 1,
    vaultId: 'vault-a',
    workspaceTabId: 'recovery:vault-a:doc-draft-a',
    readOnly: true,
    identity: { recoveryId: 'r-1', documentId: 'doc-draft-a', path, source: 'primary' },
    title: 'r',
    decisionKind: 'divergent',
    view: 'content',
    draft: { raw: 'draft' },
  }
  return { status: 'ready', context }
}

function mountPanel(captureAiContext: () => AiLiveContextCapture): VueWrapper {
  const context = createVaultContext({
    vaultId: ref('vault-a'),
    fileChanges: createVaultFileChanges(),
    tabs: ref<Tab[]>([]),
    activePath: ref<string | null>(null),
    activeTab: computed(() => null),
    openPost: async () => {},
    captureAiContext,
  })
  return mount(defineComponent({
    setup() {
      provideVaultContext(context)
      return () => h(AiPanel)
    },
  }))
}

async function typeAndSend(wrapper: VueWrapper, text: string): Promise<void> {
  await wrapper.find('textarea').setValue(text)
  wrapper.findComponent(AiComposer).vm.$emit('send')
  await nextTick()
}

const history = useAiHistory()

describe('AiPanel live context capture (Edit-10.2)', () => {
  beforeEach(() => {
    useI18n().setLocale('en')
    history.configured.value = true
    history.busy.value = false
  })
  afterEach(() => {
    vi.restoreAllMocks()
    useI18n().setLocale('zh')
  })

  it('captures synchronously before any send work and clears the composer', async () => {
    const events: string[] = []
    const captureSpy = vi.fn(() => {
      events.push('capture')
      return documentCapture('notes/a.md')
    })
    const sendSpy = vi.spyOn(history, 'sendAndStream').mockImplementation(async () => {
      events.push('send')
    })
    const wrapper = mountPanel(captureSpy)
    await nextTick()
    // Discard the render-time read of the display path; record only the
    // send flow from here on.
    events.length = 0
    captureSpy.mockClear()

    await typeAndSend(wrapper, 'hello')

    expect(events).toEqual(['capture', 'send'])
    expect(captureSpy).toHaveBeenCalledOnce()
    expect(sendSpy).toHaveBeenCalledWith('hello', { path: 'notes/a.md' })
    expect(wrapper.findComponent(AiComposer).props('modelValue')).toBe('')
  })

  it('sends the legacy path only for a live Document context', async () => {
    const sendSpy = vi.spyOn(history, 'sendAndStream').mockImplementation(async () => {})
    const wrapper = mountPanel(() => documentCapture('notes/a.md'))
    await typeAndSend(wrapper, 'hello')
    expect(sendSpy.mock.calls[0][1]).toEqual({ path: 'notes/a.md' })
  })

  it.each([
    ['history', () => historyCapture('notes/h.md')],
    ['diff', () => diffCapture('notes/d.md')],
    ['recovery', () => recoveryCapture('notes/r.md')],
    ['unavailable', () => ({ status: 'unavailable', reason: 'loading' }) as AiLiveContextCapture],
    ['none', () => ({ status: 'none' }) as AiLiveContextCapture],
  ])('claims no current file for %s context (fail closed)', async (_label, makeCapture) => {
    const sendSpy = vi.spyOn(history, 'sendAndStream').mockImplementation(async () => {})
    const wrapper = mountPanel(makeCapture)
    await typeAndSend(wrapper, 'hello')
    expect(sendSpy.mock.calls[0][1]).toEqual({ path: undefined })
  })

  it('keeps the send-time capture when the user switches tabs before the stream settles', async () => {
    let current: AiLiveContextCapture = documentCapture('notes/a.md')
    const captureSpy = vi.fn(() => current)
    let settle!: () => void
    const sendSpy = vi.spyOn(history, 'sendAndStream').mockImplementation(
      () => new Promise<void>((resolve) => { settle = resolve }),
    )
    const wrapper = mountPanel(captureSpy)
    await nextTick()
    captureSpy.mockClear() // drop the render-time display-path read

    await typeAndSend(wrapper, 'hello')
    expect(sendSpy.mock.calls[0][1]).toEqual({ path: 'notes/a.md' })

    // The user switches to tab B while this turn is still streaming.
    current = documentCapture('notes/b.md')
    await nextTick()
    settle()
    await nextTick()

    // This turn stays complete A: no send-time re-capture, no path
    // splicing.
    expect(captureSpy).toHaveBeenCalledOnce()
    expect(sendSpy).toHaveBeenCalledOnce()
    expect(sendSpy.mock.calls[0][1]).toEqual({ path: 'notes/a.md' })
  })

  it('skips the send-time capture when the guard rails reject the send', async () => {
    const captureSpy = vi.fn(() => documentCapture())
    const sendSpy = vi.spyOn(history, 'sendAndStream').mockImplementation(async () => {})

    // The display path reads capture() at render time by design; what
    // must not happen is an additional capture inside a rejected send.
    const sendAttempts = async (wrapper: VueWrapper, text: string) => {
      await nextTick()
      const callsBefore = captureSpy.mock.calls.length
      await typeAndSend(wrapper, text)
      expect(captureSpy.mock.calls.length).toBe(callsBefore)
    }

    await sendAttempts(mountPanel(captureSpy), '   ') // empty text

    history.busy.value = true
    await sendAttempts(mountPanel(captureSpy), 'hello') // busy

    history.busy.value = false
    history.configured.value = false
    await sendAttempts(mountPanel(captureSpy), 'hello') // not configured

    expect(sendSpy).not.toHaveBeenCalled()
  })

  it.each([
    ['document', () => documentCapture('notes/a.md'), 'notes/a.md'],
    ['history', () => historyCapture('notes/h.md'), 'notes/h.md'],
    ['diff', () => diffCapture('notes/d.md'), 'notes/d.md'],
    ['recovery', () => recoveryCapture('notes/r.md'), 'notes/r.md'],
  ])('shows the %s context path in the composer and chat header', (_label, makeCapture, path) => {
    const wrapper = mountPanel(makeCapture)
    expect(wrapper.findComponent(AiComposer).props('currentPath')).toBe(path)
    expect(wrapper.findComponent(AiChatMessages).props('currentPath')).toBe(path)
  })

  it.each([
    ['unavailable', () => ({ status: 'unavailable', reason: 'loading' }) as AiLiveContextCapture],
    ['none', () => ({ status: 'none' }) as AiLiveContextCapture],
  ])('shows no path for %s context', (_label, makeCapture) => {
    const wrapper = mountPanel(makeCapture)
    expect(wrapper.findComponent(AiComposer).props('currentPath')).toBeNull()
    expect(wrapper.findComponent(AiChatMessages).props('currentPath')).toBeNull()
  })

  it('offers note-scoped quick prompts whenever a ready context exists', () => {
    const { t } = useI18n()
    const withDocument = mountPanel(() => documentCapture())
    expect(withDocument.findComponent(AiChatMessages).props('quickPrompts').map((p: { label: string }) => p.label))
      .toEqual([
        t('quick_prompts.with_note.summarize.label'),
        t('quick_prompts.with_note.find_related.label'),
        t('quick_prompts.with_note.suggest_tidy.label'),
      ])
    // A read-only History context is still "about this note".
    const withHistory = mountPanel(() => historyCapture())
    expect(withHistory.findComponent(AiChatMessages).props('quickPrompts').map((p: { label: string }) => p.label))
      .toEqual([
        t('quick_prompts.with_note.summarize.label'),
        t('quick_prompts.with_note.find_related.label'),
        t('quick_prompts.with_note.suggest_tidy.label'),
      ])
  })

  it('falls back to vault-wide quick prompts without a displayable context', () => {
    const { t } = useI18n()
    const wrapper = mountPanel(() => ({ status: 'none' }))
    expect(wrapper.findComponent(AiChatMessages).props('quickPrompts').map((p: { label: string }) => p.label))
      .toEqual([
        t('quick_prompts.no_note.browse.label'),
        t('quick_prompts.no_note.find_unprocessed.label'),
        t('quick_prompts.no_note.suggest_tidy.label'),
      ])
  })

  it('tracks the live workspace in the display path without caching', async () => {
    const path = ref('notes/a.md')
    const wrapper = mountPanel(() => documentCapture(path.value))
    expect(wrapper.findComponent(AiComposer).props('currentPath')).toBe('notes/a.md')

    path.value = 'notes/b.md'
    await nextTick()

    expect(wrapper.findComponent(AiComposer).props('currentPath')).toBe('notes/b.md')
  })
})
