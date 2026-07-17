import { watch, type Ref } from 'vue'
import type { Tab } from '../../../components/vault/tabs'
import type { InternalFileChangeEvent } from '../context/fileChanges.js'
import type { VaultFileChanges } from '../context/fileChanges'
import { makeEmptyTab } from './tabState'
import { useI18n } from '../../useI18n'

export function useExternalFileChanges(options: {
  tabs: Ref<Tab[]>
  activePath: Ref<string | null>
  closeTab: (path: string) => Promise<boolean | void>
  openPost: (path: string) => Promise<void>
  navigateTo: (path: string) => void
  confirm: (message: string) => Promise<boolean>
  toastInfo: (message: string) => void
  fileChanges: VaultFileChanges
  invalidateDiskRead?: (path: string) => number
  invalidateDiskObservation?: (path: string) => void
}) {
  const { t } = useI18n()
  async function applyExternalChange(event: InternalFileChangeEvent): Promise<void> {
    // Local lifecycle transactions already migrated/closed the owning tabs.
    // The event is for History, links, and other derived Vault consumers only.
    if (event.source === 'editor-lifecycle') return
    if (event.kind === 'rename') {
      const oldTab = options.tabs.value.find((tab) => tab.path === event.oldPath)
      if (!oldTab) return
      await options.closeTab(event.oldPath!)
      if (event.newRaw != null) {
        const existing = options.tabs.value.find((tab) => tab.path === event.path)
        if (existing) {
          existing.raw = event.newRaw
          existing.originalRaw = event.newRaw
          existing.serverMtime = event.newMtime ?? existing.serverMtime
        } else {
          const newTab = makeEmptyTab(event.path)
          newTab.raw = event.newRaw
          newTab.originalRaw = event.newRaw
          newTab.serverMtime = event.newMtime ?? 0
          newTab.loading = false
          options.tabs.value.push(newTab)
          options.activePath.value = event.path
          options.navigateTo(event.path)
        }
      } else {
        await options.openPost(event.path)
      }
      options.toastInfo(t('editor.ai_renamed', { from: event.oldPath ?? '', to: event.path }))
      return
    }

    const tab = options.tabs.value.find((candidate) => candidate.path === event.path)
    if (!tab) return
    // An editor save is an acknowledgement from this same editor/save
    // coordinator. Other Vault consumers still need the event, but feeding the
    // saved snapshot back through the external-change path would reset status
    // or prompt over newer unsaved input. Only accept trusted metadata here.
    if (event.source === 'editor-save') {
      if (tab.saveStatus !== 'external' && tab.externalRaw == null) {
        tab.serverMtime = event.newMtime ?? tab.serverMtime
      }
      return
    }
    // History restore updates the owning tab synchronously before publishing.
    // Other consumers still need the event, but the editor must not treat its
    // own applied restore as a second external overwrite.
    if (event.source === 'history-restore') {
      tab.serverMtime = event.newMtime ?? tab.serverMtime
      return
    }
    if (tab.savingRevision !== null) return

    if (event.kind === 'delete') {
      // Invalidate any in-flight disk poll read AND state observation so a
      // pending getPost or getFileStates cannot overwrite the delete state
      // with stale content once it returns.
      options.invalidateDiskObservation?.(event.path)
      tab.loadError = t('editor.ai_deleted')
      tab.saveStatus = 'external'
      tab.externalRaw = null
      tab.externalKind = 'deleted'
      tab.error = t('editor.ai_deleted')
      return
    }

    const isDirty = tab.raw !== tab.originalRaw
    if (isDirty) {
      const ok = await options.confirm(
        t('editor.ai_overwrite', { path: event.path }),
      )
      if (!ok) {
        tab.serverMtime = event.newMtime ?? tab.serverMtime
        return
      }
    }
    if (event.newRaw != null) {
      // Invalidate any in-flight disk poll read AND state observation so a
      // pending getPost or getFileStates cannot overwrite the externally
      // written content once it returns.
      options.invalidateDiskObservation?.(event.path)
      tab.raw = event.newRaw
      tab.originalRaw = event.newRaw
    }
    tab.serverMtime = event.newMtime ?? tab.serverMtime
    tab.saveStatus = 'idle'
    tab.error = null
  }

  async function applyLifecycleReferenceWrites(
    updatedReferences: ReadonlyArray<{ path: string; raw: string; mtime: number }>,
  ): Promise<void> {
    for (const updated of updatedReferences) {
      const tab = options.tabs.value.find((candidate) => candidate.path === updated.path)
      if (!tab) continue
      const dirty = tab.raw !== tab.originalRaw || tab.revision !== tab.savedRevision
      let overwriteLocal = !dirty
      if (dirty) {
        try {
          overwriteLocal = await options.confirm(t('editor.ai_overwrite', { path: updated.path }))
        } catch {
          // The server rewrite has already succeeded. Treat a dismissed or
          // failed prompt as "keep local" so the local buffer remains dirty
          // and is saved only after this lifecycle transaction releases it.
          overwriteLocal = false
        }
      }
      if (overwriteLocal) {
        tab.raw = updated.raw
        tab.originalRaw = updated.raw
        tab.revision += 1
        tab.savedRevision = tab.revision
        tab.saveStatus = 'idle'
      } else {
        tab.originalRaw = updated.raw
        if (tab.savedRevision >= tab.revision) {
          tab.savedRevision = Math.max(0, tab.revision - 1)
        }
        tab.saveStatus = 'dirty'
      }
      tab.error = null
      tab.externalRaw = null
      tab.externalKind = null
      tab.serverMtime = updated.mtime
    }
  }

  function subscribeToFileChanges(): () => void {
    const fileBus = options.fileChanges.events
    let lastSeenSeq = 0
    return watch(
      () => fileBus.value,
      (events) => {
        for (const event of events) {
          if (event.seq <= lastSeenSeq) continue
          void applyExternalChange(event)
        }
        lastSeenSeq = events.at(-1)?.seq ?? lastSeenSeq
      },
      { flush: 'post' },
    )
  }

  return { applyExternalChange, applyLifecycleReferenceWrites, subscribeToFileChanges }
}
