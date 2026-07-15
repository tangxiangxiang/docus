import { describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'
import { getLoadedEditorDocument, useHistoryComparisons } from '../useHistoryComparisons'
import type { HistorySnapshot } from '../useHistorySnapshots'

function snapshot(overrides: Partial<HistorySnapshot> = {}): HistorySnapshot {
  return {
    tabId: 'history:inbox/redis',
    documentPath: 'inbox/redis',
    documentTitle: 'Redis Notes',
    revisionId: 'revision-a',
    revisionTime: 1_752_566_260_000,
    summary: 'Update cache section',
    rawMarkdown: '# Redis\n\nHistorical.',
    status: 'ready',
    error: null,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

describe('useHistoryComparisons', () => {
  it('compares the Git snapshot against unsaved in-memory editor content', async () => {
    const loadCurrentDocument = vi.fn()
    const editorDocument = { raw: '# Redis\n\nUnsaved current.', dirty: true }
    const history = useHistoryComparisons({
      getCurrentDocument: () => editorDocument,
      loadCurrentDocument,
    })
    const statuses: Array<string | undefined> = []
    const stop = watch(
      () => history.activeComparison.value?.status,
      (status) => statuses.push(status),
      { immediate: true },
    )

    await history.openComparison(snapshot())

    expect(loadCurrentDocument).not.toHaveBeenCalled()
    expect(history.activeComparison.value?.tabId).toBe('diff:inbox/redis')
    expect(history.activeComparison.value?.oldRaw).toContain('Historical')
    expect(history.activeComparison.value?.newRaw).toContain('Unsaved current')
    expect(history.activeComparison.value?.currentDirty).toBe(true)
    expect(history.activeComparison.value?.diff?.stats).toMatchObject({ added: 1, removed: 1 })
    expect(editorDocument).toEqual({ raw: '# Redis\n\nUnsaved current.', dirty: true })
    expect(statuses).toContain('ready')
    stop()
  })

  it('falls back to the saved document API when the document is not open', async () => {
    const loadCurrentDocument = vi.fn().mockResolvedValue('# Redis\n\nSaved current.')
    const history = useHistoryComparisons({
      getCurrentDocument: () => null,
      loadCurrentDocument,
    })

    await history.openComparison(snapshot())

    expect(loadCurrentDocument).toHaveBeenCalledWith('inbox/redis')
    expect(history.activeComparison.value?.newRaw).toContain('Saved current')
    expect(history.activeComparison.value?.currentDirty).toBe(false)
  })

  it('falls back to the saved document API while the editor tab is still loading', async () => {
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

    await history.openComparison(snapshot())

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
    const first = deferred<string>()
    const second = deferred<string>()
    const loadCurrentDocument = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const history = useHistoryComparisons({
      getCurrentDocument: () => null,
      loadCurrentDocument,
    })

    const requestA = history.openComparison(snapshot({ rawMarkdown: 'old A' }))
    const requestB = history.openComparison(snapshot({
      revisionId: 'revision-b',
      rawMarkdown: 'old B',
      summary: 'Revision B',
    }))
    second.resolve('current B')
    await requestB
    first.resolve('current A')
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
    const current = deferred<string>()
    const history = useHistoryComparisons({
      getCurrentDocument: () => null,
      loadCurrentDocument: () => current.promise,
    })

    const request = history.openComparison(snapshot())
    history.closeComparison('diff:inbox/redis')
    current.resolve('late current')
    await request

    expect(history.comparisons.value).toHaveLength(0)
    expect(history.activeComparison.value).toBeNull()
  })

  it('refreshes the current side when a comparison tab is selected again', async () => {
    let currentRaw = 'current one'
    const history = useHistoryComparisons({
      getCurrentDocument: () => ({ raw: currentRaw, dirty: false }),
      loadCurrentDocument: vi.fn(),
    })
    await history.openComparison(snapshot())
    history.deactivate()
    currentRaw = 'current two with unsaved edits'

    history.selectComparison('diff:inbox/redis')
    await vi.waitFor(() => {
      expect(history.activeComparison.value?.newRaw).toBe('current two with unsaved edits')
    })
    expect(history.activeComparison.value?.oldRaw).toBe('# Redis\n\nHistorical.')
  })

  it('keeps comparison tabs isolated by document path', async () => {
    const history = useHistoryComparisons({
      getCurrentDocument: (path) => ({ raw: `current ${path}`, dirty: false }),
      loadCurrentDocument: vi.fn(),
    })
    await history.openComparison(snapshot())
    await history.openComparison(snapshot({
      tabId: 'history:inbox/sqlite',
      documentPath: 'inbox/sqlite',
      documentTitle: 'SQLite Notes',
      rawMarkdown: 'historical sqlite',
    }))

    expect(history.comparisons.value).toHaveLength(2)
    expect(history.comparisons.value.find((item) => item.documentPath === 'inbox/redis')?.oldRaw)
      .toContain('Historical')
    expect(history.activeComparison.value).toMatchObject({
      documentPath: 'inbox/sqlite',
      newRaw: 'current inbox/sqlite',
    })
  })

  it('keeps errors inline and supports retrying the current side', async () => {
    const loadCurrentDocument = vi.fn()
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockResolvedValueOnce('current after retry')
    const history = useHistoryComparisons({
      getCurrentDocument: () => null,
      loadCurrentDocument,
    })

    await history.openComparison(snapshot())
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
