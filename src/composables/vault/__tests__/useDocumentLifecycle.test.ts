// @vitest-environment jsdom
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '../../../components/vault/tabs'
import * as api from '../../../lib/api'
import { createVaultFileChanges } from '../context/fileChanges'
import { useDocumentSave } from '../editor-tabs/useDocumentSave'
import { createPathMutationLock } from '../pathMutationLock'
import { DocumentMutationConflictError, useDocumentLifecycle } from '../useDocumentLifecycle'

function tab(path = 'inbox/a', raw = 'saved'): Tab {
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

function saveResponse(raw: string): Response {
  return new Response(JSON.stringify({ ok: true, raw }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function setup(initialTabs: Tab[] = [tab()]) {
  const tabs = ref(initialTabs)
  const posts = ref([])
  const activePath = ref(initialTabs[0]?.path ?? null)
  const fileChanges = createVaultFileChanges()
  const refresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const save = useDocumentSave({
    tabs,
    posts,
    activePath,
    refresh,
    fileChanges,
    toastError: vi.fn(),
  })
  const renamed: Array<{ from: string; to: string }> = []
  const removed: string[] = []
  const lifecycle = useDocumentLifecycle({
    fileChanges,
    mutationLock: createPathMutationLock(),
    prepareDocumentMutation: save.prepareDocumentMutation,
    renameOpenDocuments(mappings) {
      renamed.push(...mappings)
      for (const mapping of mappings) {
        const current = tabs.value.find((item) => item.path === mapping.from)
        if (current) current.path = mapping.to
        if (activePath.value === mapping.from) activePath.value = mapping.to
      }
    },
    removeOpenDocuments(paths) {
      removed.push(...paths)
      tabs.value = tabs.value.filter((item) => !paths.includes(item.path))
      if (activePath.value && paths.includes(activePath.value)) activePath.value = tabs.value[0]?.path ?? null
    },
    refresh,
  })
  return { tabs, activePath, fileChanges, refresh, save, lifecycle, renamed, removed }
}

beforeEach(() => vi.restoreAllMocks())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useDocumentLifecycle rename', () => {
  it('waits for an in-flight save before PATCH rename', async () => {
    let finishSave!: (response: Response) => void
    const pendingSave = new Promise<Response>((resolve) => { finishSave = resolve })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pendingSave))
    const patch = vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'inbox/b', title: 'B', created: '', updated: '', tags: [], size: 1, mtime: 2,
    })
    const h = setup()
    h.save.onEditorChange('inbox/a', 'v1')
    const saving = h.save.doSave('inbox/a')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())

    const renaming = h.lifecycle.renameFile('inbox/a', { name: 'b' })
    await Promise.resolve()
    expect(patch).not.toHaveBeenCalled()

    finishSave(saveResponse('v1'))
    await saving
    await renaming
    expect(patch).toHaveBeenCalledOnce()
    expect(h.tabs.value[0].path).toBe('inbox/b')
  })

  it('cancels the old timer, preserves edits during PATCH, and saves only to the actual new path', async () => {
    vi.useFakeTimers()
    let finishRename!: (value: api.PostSummary) => void
    const pendingRename = new Promise<api.PostSummary>((resolve) => { finishRename = resolve })
    vi.spyOn(api, 'patchPost').mockReturnValue(pendingRename)
    const puts: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const raw = (JSON.parse(String(init?.body)) as { raw: string }).raw
      puts.push(`${url}:${raw}`)
      return saveResponse(raw)
    }))
    const h = setup()
    h.save.onEditorChange('inbox/a', 'v1')
    const renaming = h.lifecycle.renameFile('inbox/a', { targetPath: 'archive/a' })
    await Promise.resolve()
    h.save.onEditorChange('inbox/a', 'v2')
    await vi.advanceTimersByTimeAsync(800)
    expect(puts).toEqual([])

    finishRename({
      path: 'archive/a-2', title: 'A', created: '', updated: '', tags: [], size: 2, mtime: 2,
    })
    await renaming
    expect(h.tabs.value[0]).toMatchObject({ path: 'archive/a-2', raw: 'v2', revision: 2, savedRevision: 0 })
    await vi.advanceTimersByTimeAsync(800)
    expect(puts).toEqual(['/api/posts/archive/a-2:v2'])
    expect(h.tabs.value[0]).toMatchObject({ originalRaw: 'v2', savedRevision: 2, saveStatus: 'saved' })
    expect(h.fileChanges.events.value[0]).toMatchObject({
      oldPath: 'inbox/a', path: 'archive/a-2', kind: 'rename', source: 'editor-lifecycle',
    })
    expect(h.fileChanges.events.value[0]).not.toHaveProperty('newRaw')
  })

  it('rolls back a failed rename and resumes dirty autosave on the old path', async () => {
    vi.useFakeTimers()
    vi.spyOn(api, 'patchPost').mockRejectedValue(new Error('rename failed'))
    const puts: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const raw = (JSON.parse(String(init?.body)) as { raw: string }).raw
      puts.push(`${url}:${raw}`)
      return saveResponse(raw)
    }))
    const h = setup()
    h.save.onEditorChange('inbox/a', 'dirty')

    await expect(h.lifecycle.renameFile('inbox/a', { name: 'b' })).rejects.toThrow('rename failed')
    expect(h.tabs.value[0].path).toBe('inbox/a')
    expect(h.fileChanges.events.value).toEqual([])
    await vi.advanceTimersByTimeAsync(800)
    expect(puts).toEqual(['/api/posts/inbox/a:dirty'])
  })

  it('publishes rename identity before deduplicated reference writes, including destination writes', async () => {
    vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'inbox/b', title: 'B', created: '', updated: '', tags: [], size: 1, mtime: 2,
      updatedReferences: [
        { path: 'inbox/b', raw: 'self rewritten' },
        { path: 'refs/c', raw: 'ref rewritten' },
        { path: 'refs/c', raw: 'ref rewritten' },
      ],
    })
    const h = setup()
    await h.lifecycle.renameFile('inbox/a', { name: 'b', updateReferences: true })
    expect(h.fileChanges.events.value.map(({ kind, path, newRaw }) => ({ kind, path, newRaw }))).toEqual([
      { kind: 'rename', path: 'inbox/b', newRaw: undefined },
      { kind: 'write', path: 'inbox/b', newRaw: 'self rewritten' },
      { kind: 'write', path: 'refs/c', newRaw: 'ref rewritten' },
    ])
  })
})

describe('useDocumentLifecycle folder and delete operations', () => {
  it('migrates every exact folder descendant and leaves prefix-similar paths alone', async () => {
    vi.spyOn(api, 'renameFolder').mockResolvedValue({
      path: 'renamed', moved: ['renamed/a', 'renamed/sub/b'], updatedReferences: [],
    })
    const h = setup([tab('folder/a'), tab('folder/sub/b'), tab('folderish/c')])
    h.activePath.value = 'folder/sub/b'
    await h.lifecycle.renameFolder('folder', 'renamed', ['folder/a', 'folder/sub/b'])
    expect(h.tabs.value.map((item) => item.path)).toEqual(['renamed/a', 'renamed/sub/b', 'folderish/c'])
    expect(h.activePath.value).toBe('renamed/sub/b')
    expect(h.fileChanges.events.value.filter((event) => event.kind === 'rename')).toHaveLength(2)
  })

  it('waits for an in-flight save before delete, then closes and publishes once', async () => {
    let finishSave!: (response: Response) => void
    const pendingSave = new Promise<Response>((resolve) => { finishSave = resolve })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pendingSave))
    const remove = vi.spyOn(api, 'deletePost').mockResolvedValue({ ok: true })
    const h = setup()
    h.save.onEditorChange('inbox/a', 'v1')
    const saving = h.save.doSave('inbox/a')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const deleting = h.lifecycle.deleteFile('inbox/a')
    await Promise.resolve()
    expect(remove).not.toHaveBeenCalled()
    finishSave(saveResponse('v1'))
    await saving
    await deleting
    expect(h.tabs.value).toEqual([])
    expect(h.fileChanges.events.value.at(-1)).toMatchObject({
      path: 'inbox/a', kind: 'delete', source: 'editor-lifecycle',
    })
  })

  it('closes only server-confirmed folder deletions', async () => {
    vi.spyOn(api, 'deleteFolder').mockResolvedValue({ deleted: ['folder/a', 'folder/sub/b'] })
    const h = setup([tab('folder/a'), tab('folder/sub/b'), tab('folderish/c')])
    await h.lifecycle.deleteFolder('folder', ['folder/a', 'folder/sub/b'])
    expect(h.tabs.value.map((item) => item.path)).toEqual(['folderish/c'])
    expect(h.fileChanges.events.value.map((event) => event.path)).toEqual(['folder/a', 'folder/sub/b'])
  })

  it('rolls back delete failure and refresh failure does not roll back success', async () => {
    vi.useFakeTimers()
    const remove = vi.spyOn(api, 'deletePost').mockRejectedValueOnce(new Error('delete failed'))
      .mockResolvedValueOnce({ ok: true })
    const puts: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const raw = (JSON.parse(String(init?.body)) as { raw: string }).raw
      puts.push(`${url}:${raw}`)
      return saveResponse(raw)
    }))
    const h = setup()
    h.save.onEditorChange('inbox/a', 'dirty')
    await expect(h.lifecycle.deleteFile('inbox/a')).rejects.toThrow('delete failed')
    expect(h.tabs.value).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(800)
    expect(puts).toEqual(['/api/posts/inbox/a:dirty'])

    const clean = setup()
    clean.refresh.mockRejectedValueOnce(new Error('refresh failed'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await clean.lifecycle.deleteFile('inbox/a')
    expect(remove).toHaveBeenCalledTimes(2)
    expect(clean.tabs.value).toEqual([])
    expect(clean.fileChanges.events.value).toHaveLength(1)
  })

  it('does not call the API when the shared History mutation lock owns the path', async () => {
    const mutationLock = createPathMutationLock()
    const release = mutationLock.acquire(['inbox/a.md'])!
    const remove = vi.spyOn(api, 'deletePost')
    const h = setup()
    const lifecycle = useDocumentLifecycle({
      fileChanges: h.fileChanges,
      mutationLock,
      prepareDocumentMutation: h.save.prepareDocumentMutation,
      renameOpenDocuments: vi.fn(),
      removeOpenDocuments: vi.fn(),
      refresh: h.refresh,
    })
    await expect(lifecycle.deleteFile('inbox/a')).rejects.toBeInstanceOf(DocumentMutationConflictError)
    expect(remove).not.toHaveBeenCalled()
    release()
  })

  it('publishes create only after POST succeeds', async () => {
    const create = vi.spyOn(api, 'createPost')
      .mockResolvedValueOnce({ path: 'inbox/new', title: 'New', created: '', updated: '', tags: [], size: 1, mtime: 1 })
      .mockRejectedValueOnce(new Error('create failed'))
    const h = setup([])
    await h.lifecycle.createFile({ path: 'inbox/new', title: 'New' })
    expect(h.fileChanges.events.value[0]).toMatchObject({
      path: 'inbox/new', kind: 'write', source: 'editor-lifecycle',
    })
    expect(h.fileChanges.events.value[0]).not.toHaveProperty('newRaw')
    await expect(h.lifecycle.createFile({ path: 'inbox/fail' })).rejects.toThrow('create failed')
    expect(create).toHaveBeenCalledTimes(2)
    expect(h.fileChanges.events.value).toHaveLength(1)
  })
})
