// @vitest-environment jsdom
import { computed, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '../../../../components/vault/tabs'
import * as historyApi from '../../../../lib/history-api'
import { createVaultContext } from '../../context/createVaultContext'
import { createVaultFileChanges } from '../../context/fileChanges'
import { __resetHistoryStateForTesting, useHistory } from '../../useHistory'
import { useDocumentSave } from '../useDocumentSave'
import { useExternalFileChanges } from '../useExternalFileChanges'

function makeTab(path = 'inbox/test', raw = 'saved'): Tab {
  return {
    path,
    title: path,
    raw,
    originalRaw: raw,
    revision: 0,
    savedRevision: 0,
    savingRevision: null,
    saveStatus: 'idle',
    error: null,
    loadError: null,
    loading: false,
    serverMtime: 1,
    externalRaw: null,
  }
}

function ok(raw: string): Response {
  return new Response(JSON.stringify({ ok: true, raw }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function setupSave(tabs: Tab[] = [makeTab()]) {
  const tabRef = ref(tabs)
  const posts = ref([])
  const activePath = ref<string | null>(tabs[0]?.path ?? null)
  const fileChanges = createVaultFileChanges()
  const refresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const toastError = vi.fn()
  const save = useDocumentSave({
    tabs: tabRef,
    posts,
    activePath,
    refresh,
    fileChanges,
    toastError,
  })
  return { save, tabs: tabRef, posts, activePath, fileChanges, refresh, toastError }
}

beforeEach(() => {
  vi.restoreAllMocks()
  __resetHistoryStateForTesting()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  __resetHistoryStateForTesting()
})

describe('useDocumentSave successful transaction', () => {
  it('publishes exactly one editor-save event without newRaw after PUT succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok('changed')))
    const h = setupSave()
    h.save.onEditorChange('inbox/test', 'changed')

    await h.save.doSave('inbox/test')

    expect(h.fileChanges.events.value).toHaveLength(1)
    expect(h.fileChanges.events.value[0]).toMatchObject({
      path: 'inbox/test',
      kind: 'write',
      source: 'editor-save',
    })
    expect(h.fileChanges.events.value[0]).not.toHaveProperty('newRaw')
    expect(h.tabs.value[0]).toMatchObject({
      originalRaw: 'changed',
      savedRevision: 1,
      saveStatus: 'saved',
    })
  })

  it('does not publish or advance the baseline when persistence fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })))
    const h = setupSave()
    h.save.onEditorChange('inbox/test', 'changed')

    await h.save.doSave('inbox/test')

    expect(h.fileChanges.events.value).toEqual([])
    expect(h.tabs.value[0]).toMatchObject({
      originalRaw: 'saved',
      savedRevision: 0,
      saveStatus: 'error',
      error: 'HTTP 500',
    })
    expect(h.toastError).toHaveBeenCalledOnce()
  })

  it('keeps a successful save successful when the derived Vault refresh fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok('changed')))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const h = setupSave()
    h.refresh.mockRejectedValueOnce(new Error('refresh failed'))
    h.save.onEditorChange('inbox/test', 'changed')

    await h.save.doSave('inbox/test')

    expect(h.fileChanges.events.value).toHaveLength(1)
    expect(h.tabs.value[0]).toMatchObject({
      originalRaw: 'changed',
      savedRevision: 1,
      saveStatus: 'saved',
      error: null,
    })
    expect(h.toastError).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('serializes v1 and v2, preserving v2 when the v1 event is published', async () => {
    let finishFirst!: (response: Response) => void
    const first = new Promise<Response>((resolve) => { finishFirst = resolve })
    const sent: string[] = []
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const raw = (JSON.parse(String(init?.body)) as { raw: string }).raw
      sent.push(raw)
      return sent.length === 1 ? first : Promise.resolve(ok(raw))
    })
    vi.stubGlobal('fetch', fetchMock)
    const h = setupSave()
    const confirm = vi.fn().mockResolvedValue(true)
    const external = useExternalFileChanges({
      tabs: h.tabs,
      activePath: h.activePath,
      closeTab: vi.fn(),
      openPost: vi.fn(),
      navigateTo: vi.fn(),
      confirm,
      toastInfo: vi.fn(),
      fileChanges: h.fileChanges,
    })
    const stop = external.subscribeToFileChanges()

    h.save.onEditorChange('inbox/test', 'v1')
    const saving = h.save.doSave('inbox/test')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    h.save.onEditorChange('inbox/test', 'v2')
    expect(fetchMock).toHaveBeenCalledOnce()

    finishFirst(ok('v1'))
    await saving
    await nextTick()

    expect(sent).toEqual(['v1', 'v2'])
    expect(confirm).not.toHaveBeenCalled()
    expect(h.tabs.value[0]).toMatchObject({
      raw: 'v2',
      originalRaw: 'v2',
      revision: 2,
      savedRevision: 2,
      saveStatus: 'saved',
    })
    expect(h.fileChanges.events.value).toHaveLength(2)
    expect(h.fileChanges.events.value.every((event) => !('newRaw' in event))).toBe(true)
    stop()
  })
})

describe('useExternalFileChanges editor-save acknowledgement', () => {
  it('only synchronizes a trusted mtime and preserves all editor state', async () => {
    const current = makeTab('inbox/test', 'v2')
    Object.assign(current, {
      originalRaw: 'v1',
      revision: 2,
      savedRevision: 1,
      saveStatus: 'dirty',
      error: 'keep me',
    })
    const tabs = ref([current])
    const confirm = vi.fn().mockResolvedValue(true)
    const fileChanges = createVaultFileChanges()
    const external = useExternalFileChanges({
      tabs,
      activePath: ref('inbox/test'),
      closeTab: vi.fn(),
      openPost: vi.fn(),
      navigateTo: vi.fn(),
      confirm,
      toastInfo: vi.fn(),
      fileChanges,
    })

    await external.applyExternalChange({
      seq: 1,
      path: 'inbox/test',
      kind: 'write',
      source: 'editor-save',
      newMtime: 42,
    })

    expect(confirm).not.toHaveBeenCalled()
    expect(current).toMatchObject({
      raw: 'v2',
      originalRaw: 'v1',
      revision: 2,
      savedRevision: 1,
      saveStatus: 'dirty',
      error: 'keep me',
      serverMtime: 42,
    })
  })
})

describe('useDocumentSave scheduling', () => {
  it('manual save consumes only the active path debounce', async () => {
    vi.useFakeTimers()
    const a = makeTab('a', 'A')
    const b = makeTab('b', 'B')
    const sent: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      sent.push(`${url}:${(JSON.parse(String(init?.body)) as { raw: string }).raw}`)
      return ok((JSON.parse(String(init?.body)) as { raw: string }).raw)
    }))
    const h = setupSave([a, b])
    h.save.onEditorChange('a', 'A1')
    h.save.onEditorChange('b', 'B1')

    await h.save.doSaveNow()
    expect(sent).toEqual(['/api/posts/a:A1'])

    await vi.advanceTimersByTimeAsync(800)
    expect(sent).toEqual(['/api/posts/a:A1', '/api/posts/b:B1'])
  })

  it('keeps debounce timers independent across tabs', async () => {
    vi.useFakeTimers()
    const sent: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const raw = (JSON.parse(String(init?.body)) as { raw: string }).raw
      sent.push(`${url}:${raw}`)
      return ok(raw)
    }))
    const h = setupSave([makeTab('a', 'A'), makeTab('b', 'B')])
    h.save.onEditorChange('a', 'A1')
    await vi.advanceTimersByTimeAsync(400)
    h.save.onEditorChange('b', 'B1')
    await vi.advanceTimersByTimeAsync(400)
    expect(sent).toEqual(['/api/posts/a:A1'])
    await vi.advanceTimersByTimeAsync(400)
    expect(sent).toEqual(['/api/posts/a:A1', '/api/posts/b:B1'])
  })
})

describe('Edit save to History integration', () => {
  it('refreshes History status from the shared editor-save event', async () => {
    const h = setupSave()
    const context = createVaultContext({
      vaultId: ref('test-vault'),
      fileChanges: h.fileChanges,
      tabs: h.tabs,
      activePath: h.activePath,
      activeTab: computed(() => h.tabs.value[0] ?? null),
      openPost: async () => {},
    })
    vi.spyOn(historyApi, 'getCapability').mockResolvedValue({ gitAvailable: true, repoInitialized: true })
    const status = vi.spyOn(historyApi, 'getStatus')
      .mockResolvedValueOnce({ available: true, dirty: [] })
      .mockResolvedValueOnce({
        available: true,
        dirty: [{ path: 'inbox/test.md', index: ' ', worktree: 'M' }],
      })
    vi.spyOn(historyApi, 'getLog').mockResolvedValue({ commits: [] })
    const history = useHistory(context)
    await vi.waitFor(() => expect(status).toHaveBeenCalledOnce())

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok('changed')))
    h.save.onEditorChange('inbox/test', 'changed')
    await h.save.doSave('inbox/test')

    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(history.status.value).toEqual([
      { path: 'inbox/test.md', index: ' ', worktree: 'M' },
    ]))
  })
})
