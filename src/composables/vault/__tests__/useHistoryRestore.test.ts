import { ref } from 'vue'
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { Tab } from '../../../components/vault/tabs'
import { createVaultFileChanges } from '../context/fileChanges'
import {
  useHistoryRestore,
  type HistoryRestoreRequest,
  type HistoryRestoreSource,
} from '../useHistoryRestore'

function tab(overrides: Partial<Tab> = {}): Tab {
  return {
    path: 'inbox/redis',
    title: 'Redis Notes',
    raw: '# Current',
    originalRaw: '# Saved',
    revision: 2,
    savedRevision: 1,
    savingRevision: null,
    saveStatus: 'dirty',
    error: 'old save error',
    loadError: null,
    loading: false,
    externalRaw: 'stale external',
    serverMtime: 10,
    ...overrides,
  }
}

function source(overrides: Partial<HistoryRestoreSource> = {}): HistoryRestoreSource {
  return {
    documentPath: 'inbox/redis',
    documentTitle: 'Redis Notes',
    revisionId: 'revision-a',
    revisionTime: 1_752_548_260_000,
    historicalRaw: '# Historical',
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function harness(options: {
  tabs?: Tab[]
  confirm?: (request: HistoryRestoreRequest) => Promise<boolean>
  restoreFile?: Mock
} = {}) {
  const tabs = ref(options.tabs ?? [tab()])
  const fileChanges = createVaultFileChanges()
  const prepareEditorRestore = vi.fn().mockResolvedValue(undefined)
  const refreshVault = vi.fn().mockResolvedValue(undefined)
  const refreshComparison = vi.fn().mockResolvedValue(undefined)
  const onSuccess = vi.fn()
  const onError = vi.fn()
  const restoreFile = options.restoreFile ?? vi.fn().mockResolvedValue({
    path: 'inbox/redis.md',
    ref: 'revision-a',
    raw: '# Historical',
    mtime: 100,
  })
  const restore = useHistoryRestore({
    tabs,
    fileChanges,
    confirm: options.confirm ?? vi.fn().mockResolvedValue(true),
    prepareEditorRestore,
    refreshVault,
    refreshComparison,
    restoreFile,
    onSuccess,
    onError,
  })
  return {
    restore,
    tabs,
    fileChanges,
    prepareEditorRestore,
    refreshVault,
    refreshComparison,
    restoreFile,
    onSuccess,
    onError,
  }
}

describe('useHistoryRestore', () => {
  it('requires confirmation and performs no work when cancelled', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    const h = harness({ confirm })

    await expect(h.restore.restore(source())).resolves.toBe(false)

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      documentTitle: 'Redis Notes',
      revisionTime: 1_752_548_260_000,
      currentDirty: true,
    }))
    expect(h.restoreFile).not.toHaveBeenCalled()
    expect(h.tabs.value[0]?.raw).toBe('# Current')
  })

  it('restores exactly one file and updates the existing editor tab without duplicating it', async () => {
    const h = harness()

    await expect(h.restore.restore(source())).resolves.toBe(true)

    expect(h.restoreFile).toHaveBeenCalledOnce()
    expect(h.restoreFile).toHaveBeenCalledWith('inbox/redis.md', 'revision-a')
    expect(h.tabs.value).toHaveLength(1)
    expect(h.tabs.value[0]).toMatchObject({
      raw: '# Historical',
      originalRaw: '# Historical',
      revision: 3,
      savedRevision: 3,
      saveStatus: 'idle',
      error: null,
      loadError: null,
      externalRaw: null,
      serverMtime: 100,
    })
    expect(h.restore.buildRequest(source()).currentDirty).toBe(false)
    expect(h.prepareEditorRestore).toHaveBeenCalledWith('inbox/redis')
    expect(h.refreshComparison).toHaveBeenCalledWith('inbox/redis')
    expect(h.fileChanges.events.value).toEqual([
      expect.objectContaining({
        path: 'inbox/redis',
        kind: 'write',
        newRaw: '# Historical',
        source: 'history-restore',
      }),
    ])
    expect(h.onSuccess).toHaveBeenCalledOnce()
  })

  it('restores a closed document and refreshes vault state without opening a tab', async () => {
    const h = harness({ tabs: [] })

    await h.restore.restore(source())

    expect(h.tabs.value).toEqual([])
    expect(h.refreshVault).toHaveBeenCalledOnce()
    expect(h.fileChanges.events.value).toHaveLength(1)
  })

  it('leaves editor and history navigation state untouched when the API fails', async () => {
    const restoreFile = vi.fn().mockRejectedValue(new Error('disk denied'))
    const h = harness({ restoreFile })
    const before = { ...h.tabs.value[0]! }

    await expect(h.restore.restore(source())).resolves.toBe(false)

    expect(h.tabs.value[0]).toEqual(before)
    expect(h.fileChanges.events.value).toEqual([])
    expect(h.refreshVault).not.toHaveBeenCalled()
    expect(h.refreshComparison).not.toHaveBeenCalled()
    expect(h.onError).toHaveBeenCalledWith(expect.any(Object), expect.any(Error))
    expect(h.restore.error.value).toBe('disk denied')
  })

  it('prevents duplicate requests while a restore is in flight', async () => {
    const response = deferred<{ path: string; ref: string; raw: string; mtime: number }>()
    const restoreFile = vi.fn().mockReturnValue(response.promise)
    const h = harness({ restoreFile })

    const first = h.restore.restore(source())
    await vi.waitFor(() => expect(h.restore.restoring.value).toBe(true))
    await expect(h.restore.restore(source({ revisionId: 'revision-b' }))).resolves.toBe(false)
    response.resolve({ path: 'inbox/redis.md', ref: 'revision-a', raw: '# Historical', mtime: 100 })
    await first

    expect(restoreFile).toHaveBeenCalledOnce()
  })

  it('captures revision A even if the mutable viewer source changes before confirmation resolves', async () => {
    const answer = deferred<boolean>()
    const h = harness({ confirm: () => answer.promise })
    const selected = source()
    const operation = h.restore.restore(selected)
    selected.revisionId = 'revision-b'
    selected.historicalRaw = '# Revision B'
    answer.resolve(true)
    await operation

    expect(h.restoreFile).toHaveBeenCalledWith('inbox/redis.md', 'revision-a')
    expect(h.tabs.value[0]?.raw).toBe('# Historical')
  })

  it('does not treat loading or failed editor tabs as valid dirty current state', () => {
    const loading = harness({ tabs: [tab({ loading: true, raw: '', originalRaw: '' })] })
    const failed = harness({ tabs: [tab({ loading: false, loadError: 'HTTP 500' })] })

    expect(loading.restore.buildRequest(source()).currentDirty).toBe(false)
    expect(failed.restore.buildRequest(source()).currentDirty).toBe(false)
  })
})
