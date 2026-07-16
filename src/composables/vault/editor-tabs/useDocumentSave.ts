import type { Ref } from 'vue'
import type { Tab } from '../../../components/vault/tabs'
import type { PostSummary } from '../../../lib/api'
import { useI18n } from '../../useI18n'
import type { VaultFileChanges } from '../context/fileChanges'

export interface DocumentMutationBarrier {
  readonly paths: readonly string[]
  commit(resumePaths?: readonly string[]): void
  rollback(): void
}

export function useDocumentSave(options: {
  tabs: Ref<Tab[]>
  posts: Ref<PostSummary[]>
  activePath: Ref<string | null>
  refresh: () => Promise<void>
  fileChanges: VaultFileChanges
  toastError: (message: string) => void
}) {
  const { t } = useI18n()
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const savePromises = new Map<string, Promise<void>>()
  const commitBarriers = new Map<string, { revision: number; raw: string }>()
  const lifecycleLocks = new Set<string>()
  let lifecycleGlobalLock = false
  let disposed = false

  function scheduleSave(path: string, delay = 800) {
    if (disposed || lifecycleGlobalLock || commitBarriers.has(path) || lifecycleLocks.has(path)) return
    const current = saveTimers.get(path)
    if (current) clearTimeout(current)
    saveTimers.set(path, setTimeout(() => {
      saveTimers.delete(path)
      void doSave(path)
    }, delay))
  }

  function cancelScheduledSave(path: string): boolean {
    const timer = saveTimers.get(path)
    if (!timer) return false
    clearTimeout(timer)
    saveTimers.delete(path)
    return true
  }

  async function saveLatest(path: string): Promise<void> {
    if (disposed) return
    const tab = options.tabs.value.find((candidate) => candidate.path === path)
    if (!tab) return
    if (lifecycleGlobalLock || lifecycleLocks.has(path)) {
      tab.saveStatus = tab.revision === tab.savedRevision ? 'idle' : 'dirty'
      return
    }
    const barrier = commitBarriers.get(path)
    if (barrier ? tab.savedRevision >= barrier.revision : tab.revision === tab.savedRevision) {
      tab.saveStatus = tab.revision === tab.savedRevision ? 'idle' : 'dirty'
      return
    }
    const sentRevision = barrier?.revision ?? tab.revision
    const sentVersion = barrier?.raw ?? tab.raw
    tab.savingRevision = sentRevision
    tab.saveStatus = 'saving'
    tab.error = null
    let data: { ok: true; raw: string }
    try {
      const response = await fetch('/api/posts/' + encodeURI(path), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ raw: sentVersion }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      data = (await response.json()) as { ok: true; raw: string }
    } catch (error) {
      if (disposed) return
      tab.saveStatus = typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error'
      tab.error = (error as Error).message
      options.toastError(t('editor.save_failed', { error: tab.error }))
      tab.savingRevision = null
      return
    }

    if (disposed) return

    try {
      if (tab.raw === sentVersion) {
        tab.raw = data.raw
        tab.originalRaw = data.raw
      } else {
        tab.originalRaw = sentVersion
      }
      tab.savedRevision = sentRevision
      tab.saveStatus = tab.revision === sentRevision ? 'saved' : 'dirty'
      options.fileChanges.publish({
        path,
        kind: 'write',
        source: 'editor-save',
      })
    } finally {
      tab.savingRevision = null
    }

    try {
      await options.refresh()
      if (disposed) return
      const post = options.posts.value.find((candidate) => candidate.path === path)
      if (post) tab.serverMtime = post.mtime
    } catch (error) {
      if (!disposed) console.warn(`[useDocumentSave] Saved ${path}, but Vault refresh failed`, error)
    }
  }

  async function doSave(path: string): Promise<void> {
    if (disposed || lifecycleGlobalLock || lifecycleLocks.has(path)) return
    const active = savePromises.get(path)
    if (active) return active
    const promise = (async () => {
      do {
        await saveLatest(path)
        const tab = options.tabs.value.find((candidate) => candidate.path === path)
        const barrier = commitBarriers.get(path)
        if (barrier && (!tab || tab.savedRevision >= barrier.revision)) break
        if (disposed || lifecycleGlobalLock || lifecycleLocks.has(path)
            || !tab || ['error', 'offline', 'external'].includes(tab.saveStatus)
            || tab.revision === tab.savedRevision) break
      } while (true)
    })().finally(() => savePromises.delete(path))
    savePromises.set(path, promise)
    return promise
  }

  function onEditorChange(path: string, value: string) {
    if (disposed) return
    const tab = options.tabs.value.find((candidate) => candidate.path === path)
    if (!tab) return
    tab.raw = value
    tab.revision += 1
    if (tab.raw === tab.originalRaw) tab.savedRevision = tab.revision
    tab.saveStatus = tab.revision === tab.savedRevision ? 'idle' : 'dirty'
    scheduleSave(path)
  }

  function handleBeforeUnload(event: BeforeUnloadEvent) {
    const hasUnsaved = options.tabs.value.some((tab) =>
      tab.raw !== tab.originalRaw
      || tab.revision !== tab.savedRevision
      || ['error', 'offline', 'saving'].includes(tab.saveStatus),
    )
    if (!hasUnsaved) return
    event.preventDefault()
    event.returnValue = ''
  }

  async function doSaveNow() {
    const path = options.activePath.value
    if (!path) return
    cancelScheduledSave(path)
    await doSave(path)
  }

  async function prepareDocumentMutation(
    paths: readonly string[],
    lockAll = false,
  ): Promise<DocumentMutationBarrier> {
    const uniquePaths = [...new Set(paths.filter((path) => path.trim().length > 0))]
    if (disposed) return { paths: uniquePaths, commit() {}, rollback() {} }

    if (lockAll) lifecycleGlobalLock = true
    else for (const path of uniquePaths) lifecycleLocks.add(path)
    for (const path of uniquePaths) cancelScheduledSave(path)
    const activePromises = uniquePaths
      .map((path) => savePromises.get(path))
      .filter((promise): promise is Promise<void> => Boolean(promise))
    if (activePromises.length > 0) await Promise.allSettled(activePromises)
    for (const path of uniquePaths) cancelScheduledSave(path)

    let settled = false
    function settle(resumePaths: readonly string[]): void {
      if (settled) return
      settled = true
      if (lockAll) lifecycleGlobalLock = false
      else for (const path of uniquePaths) lifecycleLocks.delete(path)
      if (disposed) return
      for (const path of [...new Set(resumePaths)]) {
        const tab = options.tabs.value.find((candidate) => candidate.path === path)
        if (tab && tab.revision !== tab.savedRevision) scheduleSave(path)
      }
    }

    return {
      paths: uniquePaths,
      commit(resumePaths = []) { settle(resumePaths) },
      rollback() { settle(uniquePaths) },
    }
  }

  async function prepareHistoryCommit(historyPaths: readonly string[]): Promise<(
    options?: { flushPending?: boolean }
  ) => Promise<void>> {
    const appPaths = historyPaths.map((path) => path.endsWith('.md') ? path.slice(0, -3) : path)
    const barrierPaths: string[] = []
    for (const path of appPaths) {
      const tab = options.tabs.value.find((candidate) => candidate.path === path)
      if (!tab) continue
      commitBarriers.set(path, { revision: tab.revision, raw: tab.raw })
      barrierPaths.push(path)
    }

    let released = false
    const release = async (releaseOptions: { flushPending?: boolean } = {}): Promise<void> => {
      if (released) return
      released = true
      for (const path of barrierPaths) commitBarriers.delete(path)
      if (releaseOptions.flushPending === false) return
      await Promise.all(barrierPaths.map(async (path) => {
        const tab = options.tabs.value.find((candidate) => candidate.path === path)
        if (tab && tab.revision !== tab.savedRevision) await doSave(path)
      }))
    }

    for (const path of appPaths) {
      cancelScheduledSave(path)
    }

    try {
      for (const path of barrierPaths) {
        const tab = options.tabs.value.find((candidate) => candidate.path === path)
        const barrier = commitBarriers.get(path)
        if (!tab || !barrier) continue
        if (tab.savedRevision < barrier.revision) await doSave(path)
        if (tab.savedRevision < barrier.revision || ['error', 'offline', 'external'].includes(tab.saveStatus)) {
          throw new Error(tab.error || t('editor.save_failed', { error: path }))
        }
      }
      return release
    } catch (error) {
      await release({ flushPending: false })
      throw error
    }
  }

  function prepareHistoryRestore(path: string): Promise<DocumentMutationBarrier> {
    return prepareDocumentMutation([path])
  }

  function prepareDocumentClose(paths: readonly string[]): Promise<DocumentMutationBarrier> {
    return prepareDocumentMutation(paths)
  }

  function disposeDocumentSave() {
    disposed = true
    for (const timer of saveTimers.values()) clearTimeout(timer)
    saveTimers.clear()
    commitBarriers.clear()
    lifecycleLocks.clear()
    lifecycleGlobalLock = false
  }

  return {
    scheduleSave,
    doSave,
    onEditorChange,
    handleBeforeUnload,
    doSaveNow,
    prepareDocumentMutation,
    prepareHistoryCommit,
    prepareHistoryRestore,
    prepareDocumentClose,
    disposeDocumentSave,
  }
}
