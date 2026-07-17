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
      applyPostSummary: h.applyPostSummary,
      fileChanges: h.fileChanges,
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
      applyPostSummary: h.applyPostSummary,
      fileChanges: h.fileChanges,
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

  it('does not apply a pending disk read after a save finishes', async () => {
    let finishGet!: (response: Response) => void
    const pendingGet = new Promise<Response>((resolve) => { finishGet = resolve })
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/files/state') {
        return Promise.resolve(new Response(JSON.stringify([
          { path: 'inbox/test', exists: true, mtime: 10, size: 5 },
        ]), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      if (url === '/api/posts/inbox/test' && init?.method === 'PUT') {
        return Promise.resolve(ok('local B', { mtime: 20 }))
      }
      if (url === '/api/posts/inbox/test') return pendingGet
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const h = setupSave()
    h.save.onEditorChange('inbox/test', 'local B')
    const disk = useDiskFileChanges({
      tabs: h.tabs,
      doSave: h.save.doSave,
      scheduleSave: h.save.scheduleSave,
      applyPostSummary: h.applyPostSummary,
      fileChanges: h.fileChanges,
    })

    const polling = disk.pollExternalChanges()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/posts/inbox/test'))
    await h.save.doSave('inbox/test')

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
      originalRaw: 'local B',
      savedRevision: 1,
      serverMtime: 20,
      saveStatus: 'saved',
    })
  })

  it('does not treat a failed read of an existing file as deletion', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/files/state') {
        return Promise.resolve(new Response(JSON.stringify([
          { path: 'inbox/test', exists: true, mtime: 10, size: 5 },
        ]), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      if (url === '/api/posts/inbox/test') {
        return Promise.resolve(new Response('', { status: 500 }))
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const h = setupSave()
    h.save.onEditorChange('inbox/test', 'local B')
    const disk = useDiskFileChanges({
      tabs: h.tabs,
      doSave: h.save.doSave,
      scheduleSave: h.save.scheduleSave,
      applyPostSummary: h.applyPostSummary,
      fileChanges: h.fileChanges,
    })

    await disk.pollExternalChanges()
    await disk.resolveExternal('inbox/test', 'local')

    expect(h.tabs.value[0]).toMatchObject({
      raw: 'local B',
      originalRaw: 'saved',
      saveStatus: 'external',
      externalRaw: null,
      externalKind: 'unreadable',
    })
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/posts/inbox/test')).toHaveLength(2)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/recover/'))).toBe(false)
  })

  it('does not overwrite newer input when an unreadable disk retry resolves', async () => {
    let finishGet!: (response: Response) => void
    const pendingGet = new Promise<Response>((resolve) => { finishGet = resolve })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pendingGet))
    const h = setupSave()
    Object.assign(h.tabs.value[0], {
      raw: 'local B',
      originalRaw: 'saved',
      revision: 1,
      savedRevision: 0,
      saveStatus: 'external',
      externalKind: 'unreadable',
    })
    const disk = useDiskFileChanges({
      tabs: h.tabs,
      doSave: h.save.doSave,
      scheduleSave: h.save.scheduleSave,
      applyPostSummary: h.applyPostSummary,
      fileChanges: h.fileChanges,
    })

    const resolving = disk.resolveExternal('inbox/test', 'disk')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    h.save.onEditorChange('inbox/test', 'local B2')
    finishGet(new Response(JSON.stringify({
      path: 'inbox/test',
      raw: 'disk C',
      content: '',
      frontmatter: {},
      size: 6,
      mtime: 20,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await resolving

    expect(h.tabs.value[0]).toMatchObject({
      raw: 'local B2',
      originalRaw: 'saved',
      externalRaw: 'disk C',
      externalKind: 'modified',
      saveStatus: 'external',
      serverMtime: 20,
      error: null,
    })
  })

  it('keeps the latest external resolution when unreadable requests resolve out of order', async () => {
    let finishDisk!: (response: Response) => void
    let finishLocal!: (response: Response) => void
    const diskGet = new Promise<Response>((resolve) => { finishDisk = resolve })
    const localGet = new Promise<Response>((resolve) => { finishLocal = resolve })
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(diskGet)
      .mockReturnValueOnce(localGet))
    const h = setupSave()
    Object.assign(h.tabs.value[0], {
      raw: 'local B',
      originalRaw: 'saved',
      revision: 1,
      savedRevision: 0,
      saveStatus: 'external',
      externalKind: 'unreadable',
    })
    const scheduleSave = vi.fn()
    const disk = useDiskFileChanges({
      tabs: h.tabs,
      doSave: h.save.doSave,
      scheduleSave,
      applyPostSummary: h.applyPostSummary,
      fileChanges: h.fileChanges,
    })

    const useDisk = disk.resolveExternal('inbox/test', 'disk')
    const keepLocal = disk.resolveExternal('inbox/test', 'local')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    finishLocal(new Response(JSON.stringify({
      path: 'inbox/test',
      raw: 'disk C2',
      content: '',
      frontmatter: {},
      size: 7,
      mtime: 22,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await keepLocal
    finishDisk(new Response(JSON.stringify({
      path: 'inbox/test',
      raw: 'disk C1',
      content: '',
      frontmatter: {},
      size: 7,
      mtime: 21,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await useDisk

    expect(h.tabs.value[0]).toMatchObject({
      raw: 'local B',
      originalRaw: 'disk C2',
      externalRaw: null,
      externalKind: null,
      saveStatus: 'dirty',
      serverMtime: 22,
    })
    expect(scheduleSave).toHaveBeenCalledWith('inbox/test', 0)
  })

  it('invalidates an in-flight poll read when manual external resolution begins', async () => {
    let finishPollGet!: (response: Response) => void
    let finishResolveGet!: (response: Response) => void
    const pollGet = new Promise<Response>((resolve) => { finishPollGet = resolve })
    const resolveGet = new Promise<Response>((resolve) => { finishResolveGet = resolve })
    let getPostCalls = 0
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/api/files/state') {
        return Promise.resolve(new Response(JSON.stringify([
          { path: 'inbox/test', exists: true, mtime: 10, size: 5 },
        ]), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      if (url === '/api/posts/inbox/test') {
        getPostCalls += 1
        return getPostCalls === 1 ? pollGet : resolveGet
      }
      throw new Error(`unexpected request: ${url}`)
    }))
    const h = setupSave()
    Object.assign(h.tabs.value[0], {
      raw: 'local B',
      originalRaw: 'saved',
      revision: 1,
      savedRevision: 0,
      saveStatus: 'external',
      externalKind: 'unreadable',
      serverMtime: 10,
    })
    const scheduleSave = vi.fn()
    const disk = useDiskFileChanges({
      tabs: h.tabs,
      doSave: h.save.doSave,
      scheduleSave,
      applyPostSummary: h.applyPostSummary,
      fileChanges: h.fileChanges,
    })

    // Poll A starts first and is awaiting its getPost (readId=1).
    const polling = disk.pollExternalChanges()
    await vi.waitFor(() => expect(getPostCalls).toBe(1))
    // User clicks "keep local" while the poll is in flight. The resolution
    // bumps `diskReadIds`, so Poll A's readId is now stale.
    const resolving = disk.resolveExternal('inbox/test', 'local')
    await vi.waitFor(() => expect(getPostCalls).toBe(2))

    // Poll A's response arrives first. Its readId is stale, so it must NOT
    // overwrite `externalKind` (otherwise the resolution's check below would
    // fail and the user click would be silently dropped).
    finishPollGet(new Response(JSON.stringify({
      path: 'inbox/test',
      raw: 'disk C',
      content: '',
      frontmatter: {},
      size: 5,
      mtime: 10,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await polling
    expect(h.tabs.value[0].externalKind).toBe('unreadable')
    expect(h.tabs.value[0].externalRaw).toBeNull()

    // Resolution's response arrives. externalKind is still unreadable, so the
    // user choice must run end-to-end into a dirty state and queue a save.
    finishResolveGet(new Response(JSON.stringify({
      path: 'inbox/test',
      raw: 'disk C',
      content: '',
      frontmatter: {},
      size: 5,
      mtime: 10,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await resolving

    expect(h.tabs.value[0]).toMatchObject({
      raw: 'local B',
      originalRaw: 'disk C',
      externalRaw: null,
      externalKind: null,
      saveStatus: 'dirty',
      serverMtime: 10,
    })
    expect(scheduleSave).toHaveBeenCalledWith('inbox/test', 0)
  })

  it('keeps the newer poll result when two concurrent polls race with unchanged mtime', async () => {
    let finishFirst!: (response: Response) => void
    let finishSecond!: (response: Response) => void
    const firstGet = new Promise<Response>((resolve) => { finishFirst = resolve })
    const secondGet = new Promise<Response>((resolve) => { finishSecond = resolve })
    let getPostCalls = 0
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/api/files/state') {
        return Promise.resolve(new Response(JSON.stringify([
          { path: 'inbox/test', exists: true, mtime: 10, size: 6 },
        ]), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      if (url === '/api/posts/inbox/test') {
        getPostCalls += 1
        return getPostCalls === 1 ? firstGet : secondGet
      }
      throw new Error(`unexpected request: ${url}`)
    }))
    const h = setupSave()
    Object.assign(h.tabs.value[0], {
      raw: 'local B',
      originalRaw: 'saved',
      revision: 1,
      savedRevision: 0,
      saveStatus: 'external',
      externalKind: 'unreadable',
      serverMtime: 10,
    })
    const disk = useDiskFileChanges({
      tabs: h.tabs,
      doSave: h.save.doSave,
      scheduleSave: h.save.scheduleSave,
      applyPostSummary: h.applyPostSummary,
      fileChanges: h.fileChanges,
    })

    // Poll A starts first (readId=1), Poll B starts second (readId=2).
    // Both are awaiting getPost; mtime is unchanged so the unreadable retry
    // path took the getPost for both.
    const pollingA = disk.pollExternalChanges()
    await vi.waitFor(() => expect(getPostCalls).toBe(1))
    const pollingB = disk.pollExternalChanges()
    await vi.waitFor(() => expect(getPostCalls).toBe(2))

    // Poll B's response arrives first with the newer disk body. Its readId
    // is still current, so it writes.
    finishSecond(new Response(JSON.stringify({
      path: 'inbox/test',
      raw: 'disk C2',
      content: '',
      frontmatter: {},
      size: 6,
      mtime: 10,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await pollingB
    expect(h.tabs.value[0]).toMatchObject({
      externalRaw: 'disk C2',
      externalKind: 'modified',
      saveStatus: 'external',
      serverMtime: 10,
    })

    // Poll A's older response arrives. Its readId is stale (the field
    // snapshot also matches because mtime did not move), so the older poll
    // must NOT clobber Poll B's `externalRaw` with the stale disk C1.
    finishFirst(new Response(JSON.stringify({
      path: 'inbox/test',
      raw: 'disk C1',
      content: '',
      frontmatter: {},
      size: 6,
      mtime: 10,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await pollingA
    expect(h.tabs.value[0]).toMatchObject({
      externalRaw: 'disk C2',
      externalKind: 'modified',
      saveStatus: 'external',
      serverMtime: 10,
    })
  })

  it('invalidates an in-flight poll read when a newer observation reports deletion', async () => {
    let finishGet!: (response: Response) => void
    const pendingGet = new Promise<Response>((resolve) => { finishGet = resolve })
    let stateCalls = 0
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/files/state') {
        stateCalls += 1
        if (stateCalls === 1) {
          return Promise.resolve(new Response(JSON.stringify([
            { path: 'inbox/test', exists: true, mtime: 10, size: 8 },
          ]), { status: 200, headers: { 'content-type': 'application/json' } }))
        }
        return Promise.resolve(new Response(JSON.stringify([
          { path: 'inbox/test', exists: false, mtime: 0, size: 0 },
        ]), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      if (url === '/api/posts/inbox/test') return pendingGet
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const h = setupSave()
    Object.assign(h.tabs.value[0], {
      saveStatus: 'external',
      externalKind: 'unreadable',
      serverMtime: 5,
    })
    const disk = useDiskFileChanges({
      tabs: h.tabs,
      doSave: h.save.doSave,
      scheduleSave: h.save.scheduleSave,
      applyPostSummary: h.applyPostSummary,
      fileChanges: h.fileChanges,
    })

    // Poll A observes the file still exists; its getPost is in flight
    // (readId=1). serverMtime/mtime mismatch + unreadable forces getPost.
    const pollingA = disk.pollExternalChanges()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/posts/inbox/test'))

    // Poll B observes the file is now deleted. It must invalidate Poll A's
    // readId as soon as it sees the new state.
    await disk.pollExternalChanges()
    expect(h.tabs.value[0]).toMatchObject({
      saveStatus: 'external',
      externalKind: 'deleted',
      externalRaw: null,
      error: '文件已从磁盘删除',
    })

    // Poll A's stale getPost returns with the old body. diskReadIds was
    // bumped by Poll B, so the write must be skipped — otherwise the
    // deleted tab could be flipped back to idle via the clean-apply path.
    finishGet(new Response(JSON.stringify({
      path: 'inbox/test',
      raw: 'old body A',
      content: '',
      frontmatter: {},
      size: 8,
      mtime: 10,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await pollingA
    expect(h.tabs.value[0]).toMatchObject({
      saveStatus: 'external',
      externalKind: 'deleted',
      externalRaw: null,
      error: '文件已从磁盘删除',
    })
  })

  it('blocks poll writes while manual external resolution is pending', async () => {
    let finishResolveGet!: (response: Response) => void
    const pendingResolveGet = new Promise<Response>((resolve) => { finishResolveGet = resolve })
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/files/state') {
        return Promise.resolve(new Response(JSON.stringify([
          { path: 'inbox/test', exists: true, mtime: 10, size: 5 },
        ]), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      if (url === '/api/posts/inbox/test') return pendingResolveGet
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const h = setupSave()
    Object.assign(h.tabs.value[0], {
      raw: 'local B',
      originalRaw: 'saved',
      revision: 1,
      savedRevision: 0,
      saveStatus: 'external',
      externalKind: 'unreadable',
      serverMtime: 10,
    })
    const scheduleSave = vi.fn()
    const disk = useDiskFileChanges({
      tabs: h.tabs,
      doSave: h.save.doSave,
      scheduleSave,
      applyPostSummary: h.applyPostSummary,
      fileChanges: h.fileChanges,
    })

    // User clicks keep-local first; the resolution's getPost is pending.
    const resolving = disk.resolveExternal('inbox/test', 'local')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/posts/inbox/test'))

    // A new poll fires (e.g., from the 5s timer). It must be blocked by
    // the pending resolution: no getPost, no write to the tab.
    await disk.pollExternalChanges()
    expect(h.tabs.value[0]).toMatchObject({
      externalKind: 'unreadable',
      externalRaw: null,
    })
    const getPostCalls = fetchMock.mock.calls.filter(
      ([url]) => url === '/api/posts/inbox/test',
    ).length
    expect(getPostCalls).toBe(1)

    // Resolution's getPost returns with the disk body. The user's choice
    // must run end-to-end because poll never raced in to change
    // externalKind.
    finishResolveGet(new Response(JSON.stringify({
      path: 'inbox/test',
      raw: 'disk C',
      content: '',
      frontmatter: {},
      size: 5,
      mtime: 10,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await resolving

    expect(h.tabs.value[0]).toMatchObject({
      raw: 'local B',
      originalRaw: 'disk C',
      externalRaw: null,
      externalKind: null,
      saveStatus: 'dirty',
      serverMtime: 10,
    })
    expect(scheduleSave).toHaveBeenCalledWith('inbox/test', 0)
  })

  it('keeps delete state from external file change when a poll getPost is pending', async () => {
    let finishGet!: (response: Response) => void
    const pendingGet = new Promise<Response>((resolve) => { finishGet = resolve })
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/files/state') {
        return Promise.resolve(new Response(JSON.stringify([
          { path: 'inbox/test', exists: true, mtime: 10, size: 5 },
        ]), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      if (url === '/api/posts/inbox/test') return pendingGet
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const h = setupSave()
    const disk = useDiskFileChanges({
      tabs: h.tabs,
      doSave: h.save.doSave,
      scheduleSave: h.save.scheduleSave,
      applyPostSummary: h.applyPostSummary,
      fileChanges: h.fileChanges,
    })
    const external = useExternalFileChanges({
      tabs: h.tabs,
      activePath: h.activePath,
      closeTab: vi.fn(),
      openPost: vi.fn(),
      navigateTo: vi.fn(),
      confirm: vi.fn(),
      toastInfo: vi.fn(),
      fileChanges: h.fileChanges,
      invalidateDiskRead: disk.invalidateDiskRead,
    })

    // Poll starts: getFileStates confirms exists=true, getPost is pending.
    const polling = disk.pollExternalChanges()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/posts/inbox/test'))

    // AI delete event fires while getPost is in flight — must invalidate
    // the pending disk read so the stale response cannot restore idle.
    await external.applyExternalChange({
      seq: 1,
      path: 'inbox/test',
      kind: 'delete',
      source: 'ai-tool',
    })
    expect(h.tabs.value[0]).toMatchObject({
      saveStatus: 'external',
      externalKind: 'deleted',
      externalRaw: null,
      loadError: expect.any(String),
    })

    // Stale getPost returns with old body. Must NOT flip tab to idle/clean.
    finishGet(new Response(JSON.stringify({
      path: 'inbox/test',
      raw: 'old body A',
      content: '',
      frontmatter: {},
      size: 5,
      mtime: 10,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await polling

    expect(h.tabs.value[0]).toMatchObject({
      saveStatus: 'external',
      externalKind: 'deleted',
      externalRaw: null,
      loadError: expect.any(String),
    })
  })

  it('keeps newer poll result when an older files/state response arrives out of order', async () => {
    let finishStateA!: (response: Response) => void
    const pendingStateA = new Promise<Response>((resolve) => { finishStateA = resolve })
    let stateCalls = 0
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/files/state') {
        stateCalls += 1
        if (stateCalls === 1) return pendingStateA
        // Poll B: file exists with new mtime/content.
        return Promise.resolve(new Response(JSON.stringify([
          { path: 'inbox/test', exists: true, mtime: 20, size: 6 },
        ]), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      if (url === '/api/posts/inbox/test') {
        return Promise.resolve(new Response(JSON.stringify({
          path: 'inbox/test',
          raw: 'disk C',
          content: '',
          frontmatter: {},
          size: 6,
          mtime: 20,
        }), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const h = setupSave()
    Object.assign(h.tabs.value[0], {
      saveStatus: 'external',
      externalKind: 'deleted',
      loadError: 'deleted',
      serverMtime: 20,
    })
    const disk = useDiskFileChanges({
      tabs: h.tabs,
      doSave: h.save.doSave,
      scheduleSave: h.save.scheduleSave,
      applyPostSummary: h.applyPostSummary,
      fileChanges: h.fileChanges,
    })

    // Poll A: getFileStates is pending (will return exists=false).
    const pollingA = disk.pollExternalChanges()
    await vi.waitFor(() => expect(stateCalls).toBe(1))

    // Poll B: getFileStates returns exists=true, getPost returns disk C.
    // The newer state observation must invalidate Poll A's observation.
    await disk.pollExternalChanges()
    expect(h.tabs.value[0]).toMatchObject({
      saveStatus: 'external',
      externalKind: 'modified',
      externalRaw: 'disk C',
      serverMtime: 20,
    })

    // Poll A's stale getFileStates finally returns with exists=false.
    // Its state observation was superseded — must not overwrite Poll B.
    finishStateA(new Response(JSON.stringify([
      { path: 'inbox/test', exists: false, mtime: 0, size: 0 },
    ]), { status: 200, headers: { 'content-type': 'application/json' } }))
    await pollingA

    expect(h.tabs.value[0]).toMatchObject({
      saveStatus: 'external',
      externalKind: 'modified',
      externalRaw: 'disk C',
    })
  })

  it('turns a deleted conflict into modified when the file reappears', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/files/state') {
        return Promise.resolve(new Response(JSON.stringify([
          { path: 'inbox/test', exists: true, mtime: 20, size: 6 },
        ]), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      if (url === '/api/posts/inbox/test') {
        return Promise.resolve(new Response(JSON.stringify({
          path: 'inbox/test',
          raw: 'disk C',
          content: '',
          frontmatter: {},
          size: 6,
          mtime: 20,
        }), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const h = setupSave()
    Object.assign(h.tabs.value[0], {
      saveStatus: 'external',
      externalKind: 'deleted',
      loadError: 'deleted',
      serverMtime: 20,
    })
    const disk = useDiskFileChanges({
      tabs: h.tabs,
      doSave: h.save.doSave,
      scheduleSave: h.save.scheduleSave,
      applyPostSummary: h.applyPostSummary,
      fileChanges: h.fileChanges,
    })

    await disk.pollExternalChanges()

    expect(h.tabs.value[0]).toMatchObject({
      raw: 'saved',
      externalRaw: 'disk C',
      externalKind: 'modified',
      saveStatus: 'external',
      loadError: null,
      serverMtime: 20,
    })
  })

  it('retries polling after a reappeared deleted file is temporarily unreadable', async () => {
    let postReads = 0
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/files/state') {
        return Promise.resolve(new Response(JSON.stringify([
          { path: 'inbox/test', exists: true, mtime: 20, size: 6 },
        ]), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      if (url === '/api/posts/inbox/test') {
        postReads += 1
        if (postReads === 1) return Promise.resolve(new Response('', { status: 500 }))
        return Promise.resolve(new Response(JSON.stringify({
          path: 'inbox/test',
          raw: 'disk C',
          content: '',
          frontmatter: {},
          size: 6,
          mtime: 20,
        }), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const h = setupSave()
    Object.assign(h.tabs.value[0], {
      saveStatus: 'external',
      externalKind: 'deleted',
      loadError: 'deleted',
      serverMtime: 20,
    })
    const disk = useDiskFileChanges({
      tabs: h.tabs,
      doSave: h.save.doSave,
      scheduleSave: h.save.scheduleSave,
      applyPostSummary: h.applyPostSummary,
      fileChanges: h.fileChanges,
    })

    await disk.pollExternalChanges()
    expect(h.tabs.value[0]).toMatchObject({
      externalKind: 'unreadable',
      saveStatus: 'external',
      loadError: null,
    })

    await disk.pollExternalChanges()

    expect(postReads).toBe(2)
    expect(h.tabs.value[0]).toMatchObject({
      raw: 'disk C',
      originalRaw: 'disk C',
      externalKind: null,
      saveStatus: 'idle',
      loadError: null,
      serverMtime: 20,
    })
  })

  it('settles deleted recovery without poll interference while recover is pending', async () => {
    let finishRecover!: (response: Response) => void
    const pendingRecover = new Promise<Response>((resolve) => { finishRecover = resolve })
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/recover/inbox/test') return pendingRecover
      if (url === '/api/files/state') {
        return Promise.resolve(new Response(JSON.stringify([
          { path: 'inbox/test', exists: true, mtime: 30, size: 5 },
        ]), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      if (url === '/api/posts/inbox/test') {
        // If poll is incorrectly allowed to read, returning a 500 here would
        // route the tab through `unreadable` and the recover's success below
        // would be silently dropped by the `recoveryObservedByPoll` check
        // (which only matches `modified + same raw`).
        return Promise.resolve(new Response('', { status: 500 }))
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const h = setupSave()
    Object.assign(h.tabs.value[0], {
      saveStatus: 'external',
      externalKind: 'deleted',
      loadError: 'deleted',
    })
    const disk = useDiskFileChanges({
      tabs: h.tabs,
      doSave: h.save.doSave,
      scheduleSave: h.save.scheduleSave,
      applyPostSummary: h.applyPostSummary,
      fileChanges: h.fileChanges,
    })

    const resolving = disk.resolveExternal('inbox/test', 'local')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/recover/inbox/test',
      expect.anything(),
    ))
    // Poll fires while recover is pending. The pending resolution must
    // block it from calling getPost or writing any state.
    await disk.pollExternalChanges()
    expect(h.tabs.value[0]).toMatchObject({
      externalRaw: null,
      externalKind: 'deleted',
      saveStatus: 'external',
    })
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/posts/inbox/test')).toHaveLength(0)

    finishRecover(new Response(JSON.stringify({
      ok: true,
      raw: 'saved',
      mtime: 30,
      post: summary('saved', { mtime: 30 }),
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await resolving

    expect(h.tabs.value[0]).toMatchObject({
      raw: 'saved',
      originalRaw: 'saved',
      saveStatus: 'saved',
      externalRaw: null,
      externalKind: null,
      loadError: null,
      serverMtime: 30,
    })
    expect(h.applyPostSummary).toHaveBeenCalledOnce()
    expect(h.fileChanges.events.value).toHaveLength(1)
    expect(h.fileChanges.events.value[0]).toMatchObject({
      path: 'inbox/test',
      kind: 'write',
      source: 'editor-lifecycle',
      newMtime: 30,
    })
  })

  it('keeps a deleted-file recovery resolved after a second concurrent recovery conflicts', async () => {
    let finishFirst!: (response: Response) => void
    let finishSecond!: (response: Response) => void
    const firstRecover = new Promise<Response>((resolve) => { finishFirst = resolve })
    const secondRecover = new Promise<Response>((resolve) => { finishSecond = resolve })
    let recoverCalls = 0
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/recover/inbox/test') {
        recoverCalls += 1
        return recoverCalls === 1 ? firstRecover : secondRecover
      }
      if (url === '/api/posts/inbox/test') {
        return Promise.resolve(new Response(JSON.stringify({
          path: 'inbox/test',
          raw: 'saved',
          content: '',
          frontmatter: {},
          size: 5,
          mtime: 30,
        }), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const h = setupSave()
    Object.assign(h.tabs.value[0], {
      saveStatus: 'external',
      externalKind: 'deleted',
      loadError: 'deleted',
    })
    const disk = useDiskFileChanges({
      tabs: h.tabs,
      doSave: h.save.doSave,
      scheduleSave: h.save.scheduleSave,
      applyPostSummary: h.applyPostSummary,
      fileChanges: h.fileChanges,
    })

    const first = disk.resolveExternal('inbox/test', 'local')
    const second = disk.resolveExternal('inbox/test', 'local')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    finishFirst(new Response(JSON.stringify({
      ok: true,
      raw: 'saved',
      mtime: 30,
      post: summary('saved', { mtime: 30 }),
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await first
    finishSecond(new Response('', { status: 409 }))
    await second

    expect(h.tabs.value[0]).toMatchObject({
      raw: 'saved',
      originalRaw: 'saved',
      saveStatus: 'saved',
      externalRaw: null,
      externalKind: null,
      loadError: null,
      serverMtime: 30,
    })
  })

  it('reconciles a failed deleted recovery when the file has reappeared', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/recover/inbox/test') {
        return Promise.resolve(new Response('', { status: 409 }))
      }
      if (url === '/api/posts/inbox/test') {
        return Promise.resolve(new Response(JSON.stringify({
          path: 'inbox/test',
          raw: 'disk C',
          content: '',
          frontmatter: {},
          size: 6,
          mtime: 20,
        }), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const h = setupSave()
    Object.assign(h.tabs.value[0], {
      saveStatus: 'external',
      externalKind: 'deleted',
      loadError: 'deleted',
    })
    const disk = useDiskFileChanges({
      tabs: h.tabs,
      doSave: h.save.doSave,
      scheduleSave: h.save.scheduleSave,
      applyPostSummary: h.applyPostSummary,
      fileChanges: h.fileChanges,
    })

    await disk.resolveExternal('inbox/test', 'local')

    expect(h.tabs.value[0]).toMatchObject({
      raw: 'saved',
      externalRaw: 'disk C',
      externalKind: 'modified',
      saveStatus: 'external',
      loadError: null,
      serverMtime: 20,
    })
  })

  it('continues autosave when editing advances during deleted-file recovery', async () => {
    let finishRecover!: (response: Response) => void
    const pendingRecover = new Promise<Response>((resolve) => { finishRecover = resolve })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pendingRecover))
    const h = setupSave()
    Object.assign(h.tabs.value[0], {
      saveStatus: 'external',
      externalKind: 'deleted',
      loadError: 'deleted',
    })
    const scheduleSave = vi.fn()
    const disk = useDiskFileChanges({
      tabs: h.tabs,
      doSave: h.save.doSave,
      scheduleSave,
      applyPostSummary: h.applyPostSummary,
      fileChanges: h.fileChanges,
    })

    const resolving = disk.resolveExternal('inbox/test', 'local')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    h.save.onEditorChange('inbox/test', 'newer B')
    finishRecover(new Response(JSON.stringify({
      ok: true,
      raw: 'saved',
      mtime: 30,
      post: summary('saved', { mtime: 30 }),
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await resolving

    expect(h.tabs.value[0]).toMatchObject({
      raw: 'newer B',
      originalRaw: 'saved',
      revision: 1,
      savedRevision: 0,
      saveStatus: 'dirty',
      externalKind: null,
      loadError: null,
    })
    expect(scheduleSave).toHaveBeenCalledWith('inbox/test', 0)
    expect(h.fileChanges.events.value.at(-1)).toMatchObject({
      path: 'inbox/test',
      kind: 'write',
      source: 'editor-lifecycle',
      newMtime: 30,
    })
    expect(h.fileChanges.events.value.at(-1)).not.toHaveProperty('newRaw')
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
  it('warns before unload when a clean buffer represents an externally deleted file', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { path: 'inbox/test', exists: false, mtime: 0, size: 0 },
    ]), { status: 200, headers: { 'content-type': 'application/json' } })))
    const h = setupSave()
    const disk = useDiskFileChanges({
      tabs: h.tabs,
      doSave: h.save.doSave,
      scheduleSave: h.save.scheduleSave,
      applyPostSummary: h.applyPostSummary,
      fileChanges: h.fileChanges,
    })
    await disk.pollExternalChanges()

    const event = {
      preventDefault: vi.fn(),
      returnValue: undefined,
    } as unknown as BeforeUnloadEvent
    h.save.handleBeforeUnload(event)

    expect(h.tabs.value[0]).toMatchObject({
      raw: 'saved',
      originalRaw: 'saved',
      revision: 0,
      savedRevision: 0,
      saveStatus: 'external',
      externalKind: 'deleted',
    })
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.returnValue).toBe('')
  })

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
