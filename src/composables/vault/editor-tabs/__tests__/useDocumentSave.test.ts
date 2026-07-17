// @vitest-environment jsdom
import { computed, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '../../../../components/vault/tabs'
import type { PostSummary } from '../../../../lib/api'
import * as historyApi from '../../../../lib/history-api'
import { createVaultContext } from '../../context/createVaultContext'
import { createVaultFileChanges } from '../../context/fileChanges'
import { __resetHistoryStateForTesting, useHistory } from '../../useHistory'
import { useDocumentSave } from '../useDocumentSave'
import { deriveDocumentSavePresentation } from '../savePresentation'
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

function summary(raw: string, overrides: Partial<PostSummary> = {}): PostSummary {
  return {
    path: 'inbox/test',
    title: 'Test',
    created: '2026-01-01',
    updated: '2026-01-01',
    tags: [],
    summary: '',
    size: raw.length,
    mtime: 42,
    ...overrides,
  }
}

function ok(raw: string, overrides: Partial<PostSummary> = {}): Response {
  return new Response(JSON.stringify({ ok: true, raw, post: summary(raw, overrides) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function setupSave(tabs: Tab[] = [makeTab()]) {
  const tabRef = ref(tabs)
  const activePath = ref<string | null>(tabs[0]?.path ?? null)
  const fileChanges = createVaultFileChanges()
  const applyPostSummary = vi.fn()
  const toastError = vi.fn()
  const save = useDocumentSave({
    tabs: tabRef,
    activePath,
    applyPostSummary,
    fileChanges,
    toastError,
  })
  return { save, tabs: tabRef, activePath, fileChanges, applyPostSummary, toastError }
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
      newMtime: 42,
    })
    expect(h.fileChanges.events.value[0]).not.toHaveProperty('newRaw')
    expect(h.tabs.value[0]).toMatchObject({
      originalRaw: 'changed',
      savedRevision: 1,
      saveStatus: 'saved',
      serverMtime: 42,
    })
    expect(h.applyPostSummary).toHaveBeenCalledWith(summary('changed'))
  })

  it('does not publish or advance the baseline when persistence fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })))
    const h = setupSave()
    h.save.onEditorChange('inbox/test', 'changed')

    await h.save.doSave('inbox/test')

    expect(h.fileChanges.events.value).toEqual([])
    expect(h.applyPostSummary).not.toHaveBeenCalled()
    expect(h.tabs.value[0]).toMatchObject({
      originalRaw: 'saved',
      savedRevision: 0,
      saveStatus: 'error',
      error: 'HTTP 500',
      serverMtime: 1,
    })
    expect(h.toastError).toHaveBeenCalledOnce()
  })

  it('keeps a successful save successful when the local Workspace update throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok('changed')))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const h = setupSave()
    h.applyPostSummary.mockImplementationOnce(() => { throw new Error('patch failed') })
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
      return sent.length === 1
        ? first
        : Promise.resolve(ok(raw, { size: 20, mtime: 20 }))
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
    expect(deriveDocumentSavePresentation(h.tabs.value[0])).toMatchObject({
      status: 'saving', dirty: true, inFlight: true, hasNewerChanges: false,
    })
    h.save.onEditorChange('inbox/test', 'v2')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(deriveDocumentSavePresentation(h.tabs.value[0])).toMatchObject({
      status: 'saving-dirty', dirty: true, inFlight: true, hasNewerChanges: true,
    })

    finishFirst(ok('v1', { size: 10, mtime: 10 }))
    await saving
    await nextTick()

    expect(sent).toEqual(['v1', 'v2'])
    expect(h.applyPostSummary.mock.calls.map(([post]) => ({
      size: (post as PostSummary).size,
      mtime: (post as PostSummary).mtime,
    }))).toEqual([{ size: 10, mtime: 10 }, { size: 20, mtime: 20 }])
    expect(deriveDocumentSavePresentation(h.tabs.value[0])).toMatchObject({
      status: 'saved', dirty: false, inFlight: false, hasNewerChanges: false,
    })
    expect(confirm).not.toHaveBeenCalled()
    expect(h.tabs.value[0]).toMatchObject({
      raw: 'v2',
      originalRaw: 'v2',
      revision: 2,
      savedRevision: 2,
      saveStatus: 'saved',
      serverMtime: 20,
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

  it('ignores local lifecycle events before rename/delete external handling', async () => {
    const current = makeTab('inbox/test', 'v2')
    const tabs = ref([current])
    const closeTab = vi.fn()
    const openPost = vi.fn()
    const confirm = vi.fn()
    const external = useExternalFileChanges({
      tabs,
      activePath: ref('inbox/test'),
      closeTab,
      openPost,
      navigateTo: vi.fn(),
      confirm,
      toastInfo: vi.fn(),
      fileChanges: createVaultFileChanges(),
    })
    await external.applyExternalChange({
      seq: 1, oldPath: 'inbox/test', path: 'inbox/renamed', kind: 'rename', source: 'editor-lifecycle',
    })
    await external.applyExternalChange({
      seq: 2, path: 'inbox/test', kind: 'delete', source: 'editor-lifecycle',
    })
    expect(closeTab).not.toHaveBeenCalled()
    expect(openPost).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
    expect(current).toMatchObject({ path: 'inbox/test', raw: 'v2', loadError: null })
  })

  it('applies lifecycle reference writes before releasing the save barrier', async () => {
    const clean = makeTab('refs/clean', 'old')
    const dirty = makeTab('refs/dirty', 'local edit')
    dirty.originalRaw = 'old disk'
    dirty.revision = 4
    dirty.savedRevision = 3
    dirty.saveStatus = 'dirty'
    const tabs = ref([clean, dirty])
    const confirm = vi.fn().mockResolvedValue(false)
    const external = useExternalFileChanges({
      tabs,
      activePath: ref('refs/dirty'),
      closeTab: vi.fn(),
      openPost: vi.fn(),
      navigateTo: vi.fn(),
      confirm,
      toastInfo: vi.fn(),
      fileChanges: createVaultFileChanges(),
    })

    await external.applyLifecycleReferenceWrites([
      { path: 'refs/clean', raw: 'rewritten clean', mtime: 42 },
      { path: 'refs/dirty', raw: 'rewritten disk', mtime: 43 },
    ])

    expect(clean).toMatchObject({
      raw: 'rewritten clean', originalRaw: 'rewritten clean', saveStatus: 'idle', serverMtime: 42,
    })
    expect(clean.revision).toBe(clean.savedRevision)
    expect(dirty).toMatchObject({
      raw: 'local edit', originalRaw: 'rewritten disk', saveStatus: 'dirty', serverMtime: 43,
    })
    expect(dirty.revision).not.toBe(dirty.savedRevision)
    expect(confirm).toHaveBeenCalledOnce()
  })
})

describe('useDocumentSave lifecycle barriers', () => {
  it('rollback resumes a dirty queued save while commit does not resume a deleted path', async () => {
    vi.useFakeTimers()
    const sent: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const raw = (JSON.parse(String(init?.body)) as { raw: string }).raw
      sent.push(`${url}:${raw}`)
      return ok(raw)
    }))
    const h = setupSave()
    h.save.onEditorChange('inbox/test', 'dirty')
    const rollback = await h.save.prepareDocumentMutation(['inbox/test'])
    await vi.advanceTimersByTimeAsync(800)
    expect(sent).toEqual([])
    rollback.rollback()
    await vi.advanceTimersByTimeAsync(800)
    expect(sent).toEqual(['/api/posts/inbox/test:dirty'])

    h.save.onEditorChange('inbox/test', 'new dirty')
    const commit = await h.save.prepareDocumentMutation(['inbox/test'])
    commit.commit()
    await vi.advanceTimersByTimeAsync(800)
    expect(sent).toHaveLength(1)
  })

  it('dispose isolates a pending PUT completion from tabs, events, Workspace patches, and toast', async () => {
    let finish!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { finish = resolve })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending))
    const h = setupSave()
    h.save.onEditorChange('inbox/test', 'changed')
    const saving = h.save.doSave('inbox/test')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    h.save.disposeDocumentSave()

    finish(ok('changed'))
    await saving

    expect(h.tabs.value[0]).toMatchObject({
      raw: 'changed', originalRaw: 'saved', savedRevision: 0, saveStatus: 'saving',
    })
    expect(h.fileChanges.events.value).toEqual([])
    expect(h.applyPostSummary).not.toHaveBeenCalled()
    expect(h.toastError).not.toHaveBeenCalled()
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
