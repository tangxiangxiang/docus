import type { Ref } from 'vue'
import type { Tab } from '../../../components/vault/tabs'
import {
  SavePostConflictError,
  savePost,
  type PostSummary,
  type SavePostResult,
} from '../../../lib/api'
import { useI18n } from '../../useI18n'
import type { VaultFileChanges } from '../context/fileChanges'
import type {
  DraftOwner,
  UnsavedDraftPersistence,
} from '../draft-recovery/useUnsavedDraftPersistence'

export interface DocumentMutationBarrier {
  readonly paths: readonly string[]
  commit(resumePaths?: readonly string[]): void
  rollback(): void
}

export function useDocumentSave(options: {
  tabs: Ref<Tab[]>
  activePath: Ref<string | null>
  applyPostSummary: (post: PostSummary) => void
  fileChanges: VaultFileChanges
  toastError: (message: string) => void
  draftPersistence?: UnsavedDraftPersistence
  draftVaultId?: () => string | null
}) {
  const { t } = useI18n()
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const savePromises = new Map<string, Promise<void>>()
  const commitBarriers = new Map<string, { revision: number; raw: string }>()
  const lifecycleLocks = new Set<string>()
  let lifecycleGlobalLock = false
  let disposed = false
  const draftOwners = new WeakMap<Tab, DraftOwner>()

  function draftIdentity(tab: Tab): { vaultId: string; documentId: string } | null {
    const vaultId = options.draftVaultId?.() ?? null
    const documentId = tab.documentId ?? null
    return vaultId && documentId ? { vaultId, documentId } : null
  }

  function scheduleDraft(tab: Tab): void {
    const identity = draftIdentity(tab)
    if (!identity || tab.loading || tab.loadError) return
    const owner = options.draftPersistence?.schedule({
      ...identity,
      documentPath: tab.path,
      content: tab.raw,
      authoritativeContent: tab.originalRaw,
      baseContentHash: null,
      baseModifiedAt: tab.serverMtime,
      revision: tab.revision,
    })
    if (owner) draftOwners.set(tab, owner)
  }

  function clearReturnedToBaseline(tab: Tab): void {
    const identity = draftIdentity(tab)
    if (!identity) return
    draftOwners.delete(tab)
    void options.draftPersistence
      ?.returnedToBaseline(identity.vaultId, identity.documentId)
      .catch(() => {})
  }

  async function discardDocumentDrafts(paths: readonly string[]): Promise<void> {
    await Promise.all(paths.map(async (path) => {
      const tab = options.tabs.value.find((candidate) => candidate.path === path)
      if (!tab) return
      const owner = draftOwners.get(tab)
      if (!owner) return
      draftOwners.delete(tab)
      try {
        await options.draftPersistence?.discard(owner)
      } catch {
        // Draft persistence is best-effort and never changes close behavior.
      }
    }))
  }

  async function discardDocumentDraft(tab: Tab | undefined): Promise<void> {
    if (!tab) return
    const owner = draftOwners.get(tab)
    if (!owner) return
    draftOwners.delete(tab)
    try {
      await options.draftPersistence?.discard(owner)
    } catch {
      // Draft persistence is best-effort and never changes close behavior.
    }
  }

  function hasUnresolvedExternal(tab: Tab): boolean {
    return tab.saveStatus === 'external' || tab.externalRaw != null
  }

  function scheduleSave(path: string, delay = 800) {
    if (disposed || lifecycleGlobalLock || commitBarriers.has(path) || lifecycleLocks.has(path)) return
    const tab = options.tabs.value.find((candidate) => candidate.path === path)
    if (!tab || hasUnresolvedExternal(tab)) return
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
    if (!tab || hasUnresolvedExternal(tab)) return
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
    const sentBaseRaw = tab.originalRaw
    tab.savingRevision = sentRevision
    tab.saveStatus = 'saving'
    tab.error = null
    let data: SavePostResult
    try {
      data = await savePost(path, sentVersion, sentBaseRaw)
    } catch (error) {
      if (disposed) return
      if (error instanceof SavePostConflictError) {
        tab.externalRaw = error.current.raw
        tab.externalKind = 'modified'
        tab.serverMtime = error.current.mtime
        tab.saveStatus = 'external'
        tab.error = null
        tab.savingRevision = null
        return
      }
      tab.saveStatus = typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error'
      tab.error = (error as Error).message
      options.toastError(t('editor.save_failed', { error: tab.error }))
      tab.savingRevision = null
      return
    }

    if (disposed) return

    try {
      const externalAppearedDuringSave = hasUnresolvedExternal(tab)
      if (tab.raw === sentVersion) {
        tab.raw = data.raw
        tab.originalRaw = data.raw
      } else {
        tab.originalRaw = sentVersion
      }
      tab.savedRevision = sentRevision
      tab.saveStatus = externalAppearedDuringSave
        ? 'external'
        : tab.revision === sentRevision ? 'saved' : 'dirty'
      if (!externalAppearedDuringSave) {
        tab.serverMtime = data.post.mtime
        tab.externalKind = null
      }
      try {
        options.applyPostSummary(data.post)
      } catch (error) {
        console.warn(`[useDocumentSave] Saved ${path}, but the Workspace summary update failed`, error)
      }
      options.fileChanges.publish({
        path,
        kind: 'write',
        source: 'editor-save',
        newMtime: data.post.mtime,
      })
      if (!externalAppearedDuringSave
        && tab.revision === sentRevision
        && tab.raw === tab.originalRaw) {
        const owner = draftOwners.get(tab)
        if (owner) {
          draftOwners.delete(tab)
          void options.draftPersistence?.markClean(owner, sentRevision).catch(() => {})
        }
      } else if (!externalAppearedDuringSave && tab.revision !== tab.savedRevision) {
        // The acknowledged bytes are now the authoritative baseline while a
        // newer editor revision remains dirty. Refresh the draft snapshot so
        // recovery compares against that new baseline, not the pre-save one.
        scheduleDraft(tab)
      }
    } finally {
      tab.savingRevision = null
    }
  }

  async function doSave(path: string): Promise<void> {
    if (disposed || lifecycleGlobalLock || lifecycleLocks.has(path)) return
    const tab = options.tabs.value.find((candidate) => candidate.path === path)
    if (!tab || hasUnresolvedExternal(tab)) return
    const active = savePromises.get(path)
    if (active) return active
    const promise = (async () => {
      do {
        await saveLatest(path)
        const tab = options.tabs.value.find((candidate) => candidate.path === path)
        const barrier = commitBarriers.get(path)
        if (barrier && (!tab || tab.savedRevision >= barrier.revision)) break
        if (disposed || lifecycleGlobalLock || lifecycleLocks.has(path)
            || !tab || hasUnresolvedExternal(tab)
            || ['error', 'offline'].includes(tab.saveStatus)
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
    const external = hasUnresolvedExternal(tab)
    tab.raw = value
    tab.revision += 1
    if (external) {
      tab.saveStatus = 'external'
      scheduleDraft(tab)
      return
    }
    if (tab.raw === tab.originalRaw) {
      tab.savedRevision = tab.revision
      clearReturnedToBaseline(tab)
    } else {
      scheduleDraft(tab)
    }
    tab.saveStatus = tab.revision === tab.savedRevision ? 'idle' : 'dirty'
    scheduleSave(path)
  }

  function handleBeforeUnload(event: BeforeUnloadEvent) {
    const hasUnsaved = options.tabs.value.some((tab) =>
      tab.raw !== tab.originalRaw
      || tab.revision !== tab.savedRevision
      || tab.savingRevision !== null
      || hasUnresolvedExternal(tab)
      || ['error', 'offline'].includes(tab.saveStatus),
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
      rollback() {
        settle(lockAll ? options.tabs.value.map((tab) => tab.path) : uniquePaths)
      },
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
    discardDocumentDraft,
    discardDocumentDrafts,
    disposeDocumentSave,
  }
}
