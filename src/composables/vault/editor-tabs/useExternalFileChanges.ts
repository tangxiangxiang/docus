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
  // Per-path generation counter for external events that require confirmation.
  // Bumped before `await confirm()` so that when multiple events for the same
  // path race or the user edits during a pending confirm, the older event can
  // detect the staleness and convert to external/modified instead of silently
  // overwriting the newer state.
  const externalEventIds = new Map<string, number>()

  function beginExternalEvent(path: string): number {
    const id = (externalEventIds.get(path) ?? 0) + 1
    externalEventIds.set(path, id)
    return id
  }

  function isCurrentExternalEvent(path: string, id: number): boolean {
    return externalEventIds.get(path) === id
  }

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
      // Bump the external-event generation so any in-flight write confirm
      // for this path can detect that a newer authoritative event has
      // arrived and silently discard its stale application.
      beginExternalEvent(event.path)
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
      // Capture state BEFORE the async confirm so we can detect whether a
      // newer event, user edit, delete, or poll changed the tab while we
      // were waiting.
      const eventId = beginExternalEvent(event.path)
      const requestedTab = tab
      const requestedRevision = tab.revision
      const requestedRaw = tab.raw
      const requestedOriginalRaw = tab.originalRaw
      const requestedSaveStatus = tab.saveStatus
      const requestedExternalKind = tab.externalKind
      const requestedExternalRaw = tab.externalRaw
      const requestedServerMtime = tab.serverMtime
      const requestedLoadError = tab.loadError

      const ok = await options.confirm(
        t('editor.ai_overwrite', { path: event.path }),
      )
      if (!ok) {
        // Only update mtime if no newer event arrived for this path and the
        // tab is still the same object — avoid touching a stale reference.
        if (
          isCurrentExternalEvent(event.path, eventId)
          && options.tabs.value.find((item) => item.path === event.path) === requestedTab
        ) {
          requestedTab.serverMtime = event.newMtime ?? requestedTab.serverMtime
        }
        return
      }

      // After confirm, first check whether a newer event has arrived for
      // this path. If so, this event is stale — silently discard it without
      // touching any tab state (raw, external flags, serverMtime, revision,
      // or error). Only a newer event (bumping externalEventIds) can make
      // an event stale; user edits or poll updates do not bump the counter.
      if (!isCurrentExternalEvent(event.path, eventId)) {
        return
      }

      // The event is still current. Validate that no user edit or other
      // state mutation changed the tab while the confirm was pending. If
      // anything drifted, convert to external/modified so the user can
      // explicitly resolve rather than silently losing work — but only if
      // the tab is NOT already in an external state (which means another
      // conflict source such as a poll already set it correctly).
      const latestTab = options.tabs.value.find((item) => item.path === event.path)
      if (
        latestTab !== requestedTab
        || latestTab?.path !== event.path
        || latestTab.revision !== requestedRevision
        || latestTab.raw !== requestedRaw
        || latestTab.originalRaw !== requestedOriginalRaw
        || latestTab.saveStatus !== requestedSaveStatus
        || latestTab.externalKind !== requestedExternalKind
        || latestTab.externalRaw !== requestedExternalRaw
        || latestTab.serverMtime !== requestedServerMtime
        || latestTab.loadError !== requestedLoadError
      ) {
        if (latestTab && latestTab.saveStatus !== 'external') {
          latestTab.serverMtime = event.newMtime ?? latestTab.serverMtime
          if (event.newRaw != null) {
            latestTab.externalRaw = event.newRaw
          }
          latestTab.externalKind = 'modified'
          latestTab.saveStatus = 'external'
          latestTab.loadError = null
          latestTab.error = '磁盘文件已变化，本地修改尚未保存'
        }
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
    // Fully converge tab state: accepting an authoritative external write
    // must clear any residual external/deleted flags and sync the revision
    // baseline so the presentation layer shows clean (not dirty).
    tab.revision += 1
    tab.savedRevision = tab.revision
    tab.savingRevision = null
    tab.saveStatus = 'idle'
    tab.externalRaw = null
    tab.externalKind = null
    tab.loadError = null
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
