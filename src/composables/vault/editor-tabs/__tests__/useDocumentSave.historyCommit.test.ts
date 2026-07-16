// @vitest-environment jsdom
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocumentSave } from '../useDocumentSave'
import type { Tab } from '../../../../components/vault/tabs'

function tab(overrides: Partial<Tab> = {}): Tab {
  return {
    path: 'inbox/a',
    title: 'A',
    raw: '# Newer editor content',
    originalRaw: '# Saved content',
    revision: 2,
    savedRevision: 1,
    savingRevision: null,
    saveStatus: 'dirty',
    error: null,
    loadError: null,
    loading: false,
    serverMtime: 1,
    ...overrides,
  }
}

beforeEach(() => vi.restoreAllMocks())

describe('useDocumentSave prepareHistoryCommit', () => {
  it('flushes selected open editor content through the existing save pipeline', async () => {
    const current = tab()
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ok: true, raw: current.raw }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)
    const save = useDocumentSave({
      tabs: ref([current]),
      posts: ref([]),
      activePath: ref(current.path),
      refresh: vi.fn(),
      toastError: vi.fn(),
    })

    await save.prepareHistoryCommit(['inbox/a.md'])

    expect(fetchMock).toHaveBeenCalledWith('/api/posts/inbox/a', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ raw: '# Newer editor content' }),
    }))
    expect(current.originalRaw).toBe('# Newer editor content')
    expect(current.savedRevision).toBe(current.revision)
  })

  it('blocks version creation coordination when a selected editor cannot be saved', async () => {
    const current = tab()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })))
    const save = useDocumentSave({
      tabs: ref([current]),
      posts: ref([]),
      activePath: ref(current.path),
      refresh: vi.fn(),
      toastError: vi.fn(),
    })

    await expect(save.prepareHistoryCommit(['inbox/a.md'])).rejects.toThrow('HTTP 500')
    expect(fetch).toHaveBeenCalledOnce()
    expect(current.raw).toBe('# Newer editor content')
    expect(current.saveStatus).toBe('error')
  })

  it('does not touch open documents that are not selected', async () => {
    const current = tab()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const save = useDocumentSave({
      tabs: ref([current]),
      posts: ref([]),
      activePath: ref(current.path),
      refresh: vi.fn(),
      toastError: vi.fn(),
    })

    await save.prepareHistoryCommit(['inbox/other.md'])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(current.raw).toBe('# Newer editor content')
    expect(current.saveStatus).toBe('dirty')
  })

  it('commits the click-time snapshot and saves edits made behind the barrier afterward', async () => {
    const current = tab()
    let finishSnapshotSave!: (response: Response) => void
    const snapshotSave = new Promise<Response>((resolve) => { finishSnapshotSave = resolve })
    const fetchMock = vi.fn()
      .mockReturnValueOnce(snapshotSave)
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ ok: true, raw: '# Typed after click' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ))
    vi.stubGlobal('fetch', fetchMock)
    const save = useDocumentSave({
      tabs: ref([current]),
      posts: ref([]),
      activePath: ref(current.path),
      refresh: vi.fn(),
      toastError: vi.fn(),
    })

    const preparing = save.prepareHistoryCommit(['inbox/a.md'])
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    save.onEditorChange(current.path, '# Typed after click')
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledOnce()

    finishSnapshotSave(new Response(
      JSON.stringify({ ok: true, raw: '# Newer editor content' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    const release = await preparing

    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      body: JSON.stringify({ raw: '# Newer editor content' }),
    }))
    expect(current.raw).toBe('# Typed after click')
    expect(current.revision).not.toBe(current.savedRevision)

    await release()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      body: JSON.stringify({ raw: '# Typed after click' }),
    }))
    expect(current.revision).toBe(current.savedRevision)
  })

  it('keeps the dirty state when manual save is pressed behind an active barrier', async () => {
    const current = tab()
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ok: true, raw: current.raw }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)
    const save = useDocumentSave({
      tabs: ref([current]),
      posts: ref([]),
      activePath: ref(current.path),
      refresh: vi.fn(),
      toastError: vi.fn(),
    })
    const release = await save.prepareHistoryCommit(['inbox/a.md'])
    save.onEditorChange(current.path, '# After click')

    await save.doSave(current.path)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(current.revision).not.toBe(current.savedRevision)
    expect(current.saveStatus).toBe('dirty')
    await release()
  })
})
