import { beforeEach, describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'
import {
  getLoadedEditorDocument,
  useHistoryComparisons,
  type HistoryRevisionSelection,
} from '../useHistoryComparisons'
import * as api from '../../../lib/history-api'

vi.mock('../../../lib/history-api', async () => {
  const actual = await vi.importActual<typeof api>('../../../lib/history-api')
  return { ...actual, getFileAt: vi.fn() }
})

function selection(overrides: Partial<HistoryRevisionSelection> = {}): HistoryRevisionSelection {
  return {
    documentPath: 'inbox/redis',
    documentTitle: 'Redis Notes',
    revisionId: 'revision-a',
    revisionTime: 1_752_566_260_000,
    summary: 'Update cache section',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useHistoryComparisons', () => {
  it('opens a diff directly from a selection — no snapshot intermediate', async () => {
    vi.mocked(api.getFileAt).mockResolvedValue({
      path: 'inbox/redis.md',
      ref: 'revision-a',
      content: '# Redis\n\nHistorical.',
    })
    const loadCurrentDocument = vi.fn().mockResolvedValue('# Redis\n\nSaved current.')
    const history = useHistoryComparisons({
      getCurrentDocument: () => null,
      loadCurrentDocument,
    })
    const statuses: Array<string | undefined> = []
    const stop = watch(
      () => history.activeComparison.value?.status,
      (status) => statuses.push(status),
      { immediate: true },
    )

    // Status must be 'loading' from the very first reactive read — the
    // user must see a loading indicator the instant the diff opens,
    // before any network request settles.
    const request = history.openComparison(selection())
    expect(history.activeComparison.value?.status).toBe('loading')
    expect(history.activeComparison.value?.oldRaw).toBe('')
    expect(history.activeComparison.value?.newRaw).toBe('')
    expect(history.activeComparison.value?.diff).toBeNull()

    await request

    expect(api.getFileAt).toHaveBeenCalledWith('inbox/redis.md', 'revision-a')
    expect(loadCurrentDocument).toHaveBeenCalledWith('inbox/redis')
    expect(history.activeComparison.value?.tabId).toBe('diff:inbox/redis')
    expect(history.activeComparison.value?.oldRaw).toContain('Historical')
    expect(history.activeComparison.value?.newRaw).toContain('Saved current')
    expect(history.activeComparison.value?.currentDirty).toBe(false)
    expect(history.activeComparison.value?.diff?.stats).toMatchObject({ added: 1, removed: 1 })
    expect(statuses).toEqual(expect.arrayContaining(['loading', 'ready']))
    stop()
  })

  it('compares the Git revision against unsaved in-memory editor content', async () => {
    vi.mocked(api.getFileAt).mockResolvedValue({
      path: 'inbox/redis.md',
      ref: 'revision-a',
      content: '# Redis\n\nHistorical.',
    })
    const loadCurrentDocument = vi.fn()
    const editorDocument = { raw: '# Redis\n\nUnsaved current.', dirty: true }
    const history = useHistoryComparisons({
      getCurrentDocument: () => editorDocument,
      loadCurrentDocument,
    })

    await history.openComparison(selection())

    expect(loadCurrentDocument).not.toHaveBeenCalled()
    expect(history.activeComparison.value?.oldRaw).toContain('Historical')
    expect(history.activeComparison.value?.newRaw).toContain('Unsaved current')
    expect(history.activeComparison.value?.currentDirty).toBe(true)
    expect(history.activeComparison.value?.diff?.stats).toMatchObject({ added: 1, removed: 1 })
  })

  it('falls back to the saved document API when the document is not open', async () => {
    vi.mocked(api.getFileAt).mockResolvedValue({
      path: 'inbox/redis.md',
      ref: 'revision-a',
      content: '# Redis\n\nHistorical.',
    })
    const loadCurrentDocument = vi.fn().mockResolvedValue('# Redis\n\nSaved current.')
    const history = useHistoryComparisons({
      getCurrentDocument: () => null,
      loadCurrentDocument,
    })

    await history.openComparison(selection())

    expect(loadCurrentDocument).toHaveBeenCalledWith('inbox/redis')
    expect(history.activeComparison.value?.newRaw).toContain('Saved current')
    expect(history.activeComparison.value?.currentDirty).toBe(false)
  })

  it('starts loading historical and current content in parallel', async () => {
    let resolveHistorical!: (value: Awaited<ReturnType<typeof api.getFileAt>>) => void
    vi.mocked(api.getFileAt).mockReturnValue(new Promise((resolve) => {
      resolveHistorical = resolve
    }))
    const loadCurrentDocument = vi.fn().mockResolvedValue('current')
    const history = useHistoryComparisons({
      getCurrentDocument: () => null,
      loadCurrentDocument,
    })

    const request = history.openComparison(selection())
    await vi.waitFor(() => expect(loadCurrentDocument).toHaveBeenCalledWith('inbox/redis'))
    expect(history.activeComparison.value?.status).toBe('loading')

    resolveHistorical({
      path: 'inbox/redis.md',
      ref: 'revision-a',
      content: 'historical',
    })
    await request
    expect(history.activeComparison.value).toMatchObject({
      status: 'ready',
      oldRaw: 'historical',
      newRaw: 'current',
    })
  })

  it('replaces discarded editor content with saved content after the Current tab closes', async () => {
    vi.mocked(api.getFileAt).mockResolvedValue({
      path: 'inbox/redis.md',
      ref: 'revision-a',
      content: '# Redis\n\nHistorical.',
    })
    const tabs = [{
      path: 'inbox/redis',
      raw: '# Redis\n\nDiscarded unsaved current.',
      originalRaw: '# Redis\n\nSaved current.',
      loading: false,
      loadError: null,
    }]
    const loadCurrentDocument = vi.fn().mockResolvedValue('# Redis\n\nSaved current.')
    const history = useHistoryComparisons({
      getCurrentDocument: (path) => getLoadedEditorDocument(tabs, path),
      loadCurrentDocument,
    })
    await history.openComparison(selection())
    expect(history.activeComparison.value).toMatchObject({
      newRaw: '# Redis\n\nDiscarded unsaved current.',
      currentDirty: true,
    })

    tabs.splice(0, 1)
    await history.refreshDocumentComparison('inbox/redis')

    expect(loadCurrentDocument).toHaveBeenCalledWith('inbox/redis')
    expect(history.activeComparison.value).toMatchObject({
      newRaw: '# Redis\n\nSaved current.',
      currentDirty: false,
      status: 'ready',
    })
  })

  it('falls back to the saved document API while the editor tab is still loading', async () => {
    vi.mocked(api.getFileAt).mockResolvedValue({
      path: 'inbox/redis.md',
      ref: 'revision-a',
      content: '# Redis\n\nHistorical.',
    })
    const tabs = [{
      path: 'inbox/redis',
      raw: '',
      originalRaw: '',
      loading: true,
      loadError: null,
    }]
    const loadCurrentDocument = vi.fn().mockResolvedValue('# Redis\n\nSaved current.')
    const history = useHistoryComparisons({
      getCurrentDocument: (path) => getLoadedEditorDocument(tabs, path),
      loadCurrentDocument,
    })

    await history.openComparison(selection())

    expect(loadCurrentDocument).toHaveBeenCalledWith('inbox/redis')
    expect(history.activeComparison.value).toMatchObject({
      newRaw: '# Redis\n\nSaved current.',
      currentDirty: false,
      status: 'ready',
    })
  })

  it('does not trust an editor tab whose initial load failed', () => {
    const tabs = [{
      path: 'inbox/redis',
      raw: '',
      originalRaw: '',
      loading: false,
      loadError: 'HTTP 500',
    }]

    expect(getLoadedEditorDocument(tabs, 'inbox/redis')).toBeNull()
  })

  it('reuses one comparison tab and ignores a slower obsolete request', async () => {
    function deferred<T>() {
      let resolve!: (value: T) => void
      let reject!: (reason?: unknown) => void
      const promise = new Promise<T>((onResolve, onReject) => {
        resolve = onResolve
        reject = onReject
      })
      return { promise, resolve, reject }
    }

    // Both sides begin concurrently. The second openComparison wins;
    // resolving the first request later must not overwrite it.
    const winnerCurrent = deferred<string>()
    const obsoleteCurrent = deferred<string>()
    vi.mocked(api.getFileAt)
      .mockResolvedValueOnce({ path: 'inbox/redis.md', ref: 'revision-a', content: 'old A' })
      .mockResolvedValueOnce({ path: 'inbox/redis.md', ref: 'revision-b', content: 'old B' })
    const history = useHistoryComparisons({
      getCurrentDocument: () => null,
      loadCurrentDocument: vi.fn()
        .mockReturnValueOnce(obsoleteCurrent.promise)
        .mockReturnValueOnce(winnerCurrent.promise),
    })

    const requestA = history.openComparison(selection())
    const requestB = history.openComparison(selection({
      revisionId: 'revision-b',
      summary: 'Revision B',
    }))
    winnerCurrent.resolve('current B')
    await requestB
    obsoleteCurrent.resolve('current A')
    await requestA

    expect(history.comparisons.value).toHaveLength(1)
    expect(history.activeComparison.value).toMatchObject({
      revisionId: 'revision-b',
      oldRaw: 'old B',
      newRaw: 'current B',
      status: 'ready',
    })
  })

  it('invalidates an in-flight request when its tab closes', async () => {
    function deferred<T>() {
      let resolve!: (value: T) => void
      let reject!: (reason?: unknown) => void
      const promise = new Promise<T>((onResolve, onReject) => {
        resolve = onResolve
        reject = onReject
      })
      return { promise, resolve, reject }
    }

    vi.mocked(api.getFileAt).mockResolvedValue({
      path: 'inbox/redis.md',
      ref: 'revision-a',
      content: 'historical',
    })
    const current = deferred<string>()
    const history = useHistoryComparisons({
      getCurrentDocument: () => null,
      loadCurrentDocument: () => current.promise,
    })

    const request = history.openComparison(selection())
    history.closeComparison('diff:inbox/redis')
    current.resolve('late current')
    await request

    expect(history.comparisons.value).toHaveLength(0)
    expect(history.activeComparison.value).toBeNull()
  })

  it('refreshes the current side when a comparison tab is selected again', async () => {
    let currentRaw = 'current one'
    vi.mocked(api.getFileAt).mockResolvedValue({
      path: 'inbox/redis.md',
      ref: 'revision-a',
      content: '# Redis\n\nHistorical.',
    })
    const history = useHistoryComparisons({
      getCurrentDocument: () => ({ raw: currentRaw, dirty: false }),
      loadCurrentDocument: vi.fn(),
    })
    await history.openComparison(selection())
    history.deactivate()
    currentRaw = 'current two with unsaved edits'

    history.selectComparison('diff:inbox/redis')
    await vi.waitFor(() => {
      expect(history.activeComparison.value?.newRaw).toBe('current two with unsaved edits')
    })
    expect(history.activeComparison.value?.oldRaw).toBe('# Redis\n\nHistorical.')
  })

  it('keeps comparison tabs isolated by document path', async () => {
    vi.mocked(api.getFileAt)
      .mockResolvedValueOnce({ path: 'inbox/redis.md', ref: 'revision-a', content: 'historical redis' })
      .mockResolvedValueOnce({ path: 'inbox/sqlite.md', ref: 'revision-a', content: 'historical sqlite' })
    const history = useHistoryComparisons({
      getCurrentDocument: (path) => ({ raw: `current ${path}`, dirty: false }),
      loadCurrentDocument: vi.fn(),
    })
    await history.openComparison(selection())
    await history.openComparison(selection({
      documentPath: 'inbox/sqlite',
      documentTitle: 'SQLite Notes',
    }))

    expect(history.comparisons.value).toHaveLength(2)
    expect(history.comparisons.value.find((item) => item.documentPath === 'inbox/redis')?.oldRaw)
      .toBe('historical redis')
    expect(history.activeComparison.value).toMatchObject({
      documentPath: 'inbox/sqlite',
      newRaw: 'current inbox/sqlite',
    })
  })

  it('surfaces a historical load failure on the diff tab with retry', async () => {
    vi.mocked(api.getFileAt).mockRejectedValueOnce(new Error('history offline'))
    const history = useHistoryComparisons({
      getCurrentDocument: () => null,
      loadCurrentDocument: vi.fn().mockResolvedValue('current'),
    })

    await history.openComparison(selection())
    expect(history.activeComparison.value).toMatchObject({
      status: 'error',
      error: 'history offline',
    })

    vi.mocked(api.getFileAt).mockResolvedValueOnce({
      path: 'inbox/redis.md',
      ref: 'revision-a',
      content: 'recovered historical',
    })
    await history.refreshComparison('diff:inbox/redis')
    expect(history.activeComparison.value).toMatchObject({
      status: 'ready',
      oldRaw: 'recovered historical',
      error: null,
    })
  })

  it('surfaces a current-document load failure on the diff tab with retry', async () => {
    vi.mocked(api.getFileAt).mockResolvedValue({
      path: 'inbox/redis.md',
      ref: 'revision-a',
      content: 'historical',
    })
    const loadCurrentDocument = vi.fn()
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockResolvedValueOnce('current after retry')
    const history = useHistoryComparisons({
      getCurrentDocument: () => null,
      loadCurrentDocument,
    })

    await history.openComparison(selection())
    expect(history.activeComparison.value).toMatchObject({
      status: 'error',
      error: 'disk unavailable',
    })

    await history.refreshComparison('diff:inbox/redis')
    expect(history.activeComparison.value).toMatchObject({
      status: 'ready',
      newRaw: 'current after retry',
      error: null,
    })
  })
})
