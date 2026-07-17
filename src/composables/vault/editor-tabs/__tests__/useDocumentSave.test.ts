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
import { useDiskFileChanges } from '../useDiskFileChanges'
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

function conflict(raw: string, mtime = 7, size = raw.length): Response {
  return new Response(JSON.stringify({
    error: 'document changed on disk',
    code: 'EDIT_CONFLICT',
    current: { raw, mtime, size },
  }), {
    status: 409,
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
  it('sends the immutable originalRaw baseline with the edited body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok('changed'))
    vi.stubGlobal('fetch', fetchMock)
    const h = setupSave()
    h.save.onEditorChange('inbox/test', 'changed')

    await h.save.doSave('inbox/test')

    expect(fetchMock).toHaveBeenCalledWith('/api/posts/inbox/test', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ raw: 'changed', baseRaw: 'saved' }),
    }))
  })

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
    const sent: Array<{ raw: string; baseRaw: string }> = []
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const input = JSON.parse(String(init?.body)) as { raw: string; baseRaw: string }
      sent.push(input)
      return sent.length === 1
        ? first
        : Promise.resolve(ok(input.raw, { size: 20, mtime: 20 }))
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

    expect(sent).toEqual([
      { raw: 'v1', baseRaw: 'saved' },
      { raw: 'v2', baseRaw: 'v1' },
    ])
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

describe('useDocumentSave optimistic conflicts', () => {
  it('enters external without advancing or publishing on a typed 409', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(conflict('disk C', 9, 6)))
    const h = setupSave()
    h.save.onEditorChange('inbox/test', 'local B')

    await h.save.doSave('inbox/test')

    expect(h.tabs.value[0]).toMatchObject({
      raw: 'local B',
      originalRaw: 'saved',
      revision: 1,
      savedRevision: 0,
      savingRevision: null,
      externalRaw: 'disk C',
      serverMtime: 9,
      saveStatus: 'external',
      error: null,
    })
    expect(h.applyPostSummary).not.toHaveBeenCalled()
    expect(h.fileChanges.events.value).toEqual([])
    expect(h.toastError).not.toHaveBeenCalled()
  })

  it('keeps external while editing and blocks queued and manual saves', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(conflict('disk C'))
    vi.stubGlobal('fetch', fetchMock)
    const h = setupSave()
    h.save.onEditorChange('inbox/test', 'local B')
    await h.save.doSave('inbox/test')

    h.save.onEditorChange('inbox/test', 'local B2')
    await vi.advanceTimersByTimeAsync(800)
    await h.save.doSaveNow()

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(h.tabs.value[0]).toMatchObject({
      raw: 'local B2',
      originalRaw: 'saved',
      externalRaw: 'disk C',
      saveStatus: 'external',
      revision: 2,
      savedRevision: 0,
    })
  })

  it('treats a malformed 409 as a normal save error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'document changed on disk',
      code: 'EDIT_CONFLICT',
      current: { mtime: 9, size: 6 },
    }), { status: 409, headers: { 'content-type': 'application/json' } })))
    const h = setupSave()
    h.save.onEditorChange('inbox/test', 'local B')

    await h.save.doSave('inbox/test')

    expect(h.tabs.value[0]).toMatchObject({
      externalRaw: null,
      saveStatus: 'error',
      savedRevision: 0,
    })
    expect(h.toastError).toHaveBeenCalledOnce()
  })

  it('ignores disk polling while savingRevision is in flight and continues with S2', async () => {
    let finishFirst!: (response: Response) => void
    const first = new Promise<Response>((resolve) => { finishFirst = resolve })
    const sent: Array<{ raw: string; baseRaw: string }> = []
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/files/state') {
        return Promise.resolve(new Response(JSON.stringify([
          { path: 'inbox/test', exists: true, mtime: 10, size: 2 },
        ]), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      if (url === '/api/posts/inbox/test' && init?.method === 'PUT') {
        const input = JSON.parse(String(init.body)) as { raw: string; baseRaw: string }
        sent.push(input)
        return sent.length === 1 ? first : Promise.resolve(ok(input.raw, { mtime: 20 }))
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const h = setupSave()
    const disk = useDiskFileChanges({
      tabs: h.tabs,
      doSave: h.save.doSave,
      scheduleSave: h.save.scheduleSave,
    })

    h.save.onEditorChange('inbox/test', 'v1')
    const saving = h.save.doSave('inbox/test')
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    h.save.onEditorChange('inbox/test', 'v2')
    expect(h.tabs.value[0]).toMatchObject({ saveStatus: 'dirty', savingRevision: 1 })

    await disk.pollExternalChanges()
    expect(h.tabs.value[0].externalRaw).toBeNull()

    finishFirst(ok('v1', { mtime: 10 }))
    await saving
    expect(sent).toEqual([
      { raw: 'v1', baseRaw: 'saved' },
      { raw: 'v2', baseRaw: 'v1' },
    ])
  })

  it('does not apply a pending disk read after editing and saving begin', async () => {
    let finishGet!: (response: Response) => void
    let finishPut!: (response: Response) => void
    const pendingGet = new Promise<Response>((resolve) => { finishGet = resolve })
    const pendingPut = new Promise<Response>((resolve) => { finishPut = resolve })
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/files/state') {
        return Promise.resolve(new Response(JSON.stringify([
          { path: 'inbox/test', exists: true, mtime: 10, size: 5 },
        ]), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      if (url === '/api/posts/inbox/test' && init?.method === 'PUT') return pendingPut
      if (url === '/api/posts/inbox/test') return pendingGet
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const h = setupSave()
    const disk = useDiskFileChanges({
      tabs: h.tabs,
      doSave: h.save.doSave,
      scheduleSave: h.save.scheduleSave,
    })

    const polling = disk.pollExternalChanges()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/posts/inbox/test'))
    h.save.onEditorChange('inbox/test', 'local B')
    const saving = h.save.doSave('inbox/test')
    await vi.waitFor(() => expect(h.tabs.value[0].savingRevision).toBe(1))

    finishGet(new Response(JSON.stringify({
      path: 'inbox/test',
      raw: 'saved',
      content: '',
      frontmatter: {},
      size: 5,
      mtime: 10,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await polling
    expect(h.tabs.value[0]).toMatchObject({
      raw: 'local B',
      originalRaw: 'saved',
      savingRevision: 1,
      externalRaw: null,
    })

    finishPut(ok('local B', { mtime: 20 }))
    await saving
    expect(h.tabs.value[0]).toMatchObject({
      raw: 'local B',
      originalRaw: 'local B',
      savingRevision: null,
      saveStatus: 'saved',
    })
  })

  it('terminates the save loop if an external snapshot appears during a request', async () => {
    let finish!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { finish = resolve })
    const fetchMock = vi.fn().mockReturnValue(pending)
    vi.stubGlobal('fetch', fetchMock)
    const h = setupSave()
    h.save.onEditorChange('inbox/test', 'v1')
    const saving = h.save.doSave('inbox/test')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    h.save.onEditorChange('inbox/test', 'v2')
    h.tabs.value[0].externalRaw = 'external C'

    finish(ok('v1'))
    await saving

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(h.tabs.value[0]).toMatchObject({
      externalRaw: 'external C',
      saveStatus: 'external',
      serverMtime: 1,
    })
    expect(h.tabs.value[0].revision).not.toBe(h.tabs.value[0].savedRevision)
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

  it('dispose isolates a pending conflict response from the old Workspace', async () => {
    let finish!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { finish = resolve })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending))
    const h = setupSave()
    h.save.onEditorChange('inbox/test', 'changed')
    const saving = h.save.doSave('inbox/test')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    h.save.disposeDocumentSave()

    finish(conflict('disk C', 9))
    await saving

    expect(h.tabs.value[0]).toMatchObject({
      raw: 'changed',
      originalRaw: 'saved',
      externalRaw: null,
      serverMtime: 1,
      saveStatus: 'saving',
    })
    expect(h.fileChanges.events.value).toEqual([])
    expect(h.applyPostSummary).not.toHaveBeenCalled()
    expect(h.toastError).not.toHaveBeenCalled()
  })
})

describe('useDocumentSave scheduling', () => {
  it('warns before unload while a save remains in flight after editing back to baseline', async () => {
    let finishFirst!: (response: Response) => void
    const first = new Promise<Response>((resolve) => { finishFirst = resolve })
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(ok('saved', { mtime: 20 }))
    vi.stubGlobal('fetch', fetchMock)
    const h = setupSave()

    h.save.onEditorChange('inbox/test', 'changed')
    const saving = h.save.doSave('inbox/test')
    await vi.waitFor(() => expect(h.tabs.value[0].savingRevision).toBe(1))
    h.save.onEditorChange('inbox/test', 'saved')
    expect(h.tabs.value[0]).toMatchObject({
      raw: 'saved',
      originalRaw: 'saved',
      revision: 2,
      savedRevision: 2,
      savingRevision: 1,
      saveStatus: 'idle',
    })

    const event = {
      preventDefault: vi.fn(),
      returnValue: undefined,
    } as unknown as BeforeUnloadEvent
    h.save.handleBeforeUnload(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.returnValue).toBe('')

    finishFirst(ok('changed', { mtime: 10 }))
    await saving
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

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
