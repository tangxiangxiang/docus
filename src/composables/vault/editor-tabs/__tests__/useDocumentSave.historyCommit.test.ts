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
})
