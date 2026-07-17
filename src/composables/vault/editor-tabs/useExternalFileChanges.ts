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
  // Per-path record of the latest event seq. Every event that passes through
  // applyExternalChange is tracked as the most recent authority for its path,
  // so any in-flight write confirm can detect whether a newer event (including
  // clean writes, history-restore, renames, and deletes) has superseded it.
  const latestEventSeqs = new Map<string, number>()

  function isLatestEvent(path: string, seq: number): boolean {
    return latestEventSeqs.get(path) === seq
  }

  async function applyExternalChange(event: InternalFileChangeEvent): Promise<void> {
    // Local lifecycle transactions already migrated/closed the owning tabs.
    // The event is for History, links, and other derived Vault consumers only.
    if (event.source === 'editor-lifecycle') return

    // Record this event as the latest authority for its path so any in-flight
    // write confirm can detect staleness and silently discard its application.
    // This covers ALL event types — rename, editor-save, history-restore,
    // delete, and both clean and dirty writes.
    latestEventSeqs.set(event.path, event.seq)

    if (event.kind === 'rename') {
      // Invalidate any in-flight disk poll read AND state observation for
      // both the new path and the old path. The rename delivers authoritative
      // file state (newRaw, newMtime) immediately, so any pending poll's
      // getPost/getFileStates responses for either path must be dropped —
      // otherwise a stale `exists=false` (or stale body) arriving after the
      // rename could clobber the rename-driven state.
      options.invalidateDiskObservation?.(event.path)
      if (event.oldPath) options.invalidateDiskObservation?.(event.oldPath)

      // Invalidate any pending confirm on the old path — when a file is
      // renamed, its old identity is gone and any in-flight write confirm
      // must be silently discarded rather than writing into a potentially
      // unrelated tab that now occupies the old path.
      if (event.oldPath) latestEventSeqs.set(event.oldPath, event.seq)

      const oldTab = options.tabs.value.find((tab) => tab.path === event.oldPath)
      if (!oldTab) return
      const closed = await options.closeTab(event.oldPath!)

      // After awaiting the close (which may involve a user confirm), this
      // rename may no longer be the latest event for either path. A newer
      // write to the target path or another rename supersedes it. Also
      // verify the old-path authority hasn't been bumped by a newer event.
      if (!isLatestEvent(event.path, event.seq)) return
      if (event.oldPath && !isLatestEvent(event.oldPath, event.seq)) return

      // If the user refused to close the old tab, the old path still has
      // an active editor. Don't apply the target-path side of the rename
      // while the old tab remains open — polling will eventually reconcile.
      if (closed === false) return

      if (event.newRaw != null) {
        const existing = options.tabs.value.find((tab) => tab.path === event.path)
        if (existing) {
          // Target path already has an open tab. If it is fully clean
          // (no unsaved local edits, no external conflict, no pending
          // save, no error), converge it completely to the rename result —
          // update content, sync the revision baseline, and clear any
          // residual error state. If the tab has local changes (dirty by
          // raw/originalRaw mismatch OR revision/savedRevision mismatch)
          // or an unresolved external conflict or a save failure, never
          // silently overwrite the local buffer. Instead present the
          // rename content as an external change the user must
          // explicitly resolve.
          const dirty = existing.raw !== existing.originalRaw
            || existing.revision !== existing.savedRevision
          const isClean = !dirty
            && existing.savingRevision === null
            && existing.externalRaw == null
            && !existing.externalKind
            && !existing.loading
            && !existing.loadError
            && (existing.saveStatus === 'idle' || existing.saveStatus === 'saved')

          if (isClean) {
            existing.raw = event.newRaw
            existing.originalRaw = event.newRaw
            existing.serverMtime = event.newMtime ?? existing.serverMtime
            existing.revision += 1
            existing.savedRevision = existing.revision
            existing.savingRevision = null
            existing.saveStatus = 'idle'
            existing.externalRaw = null
            existing.externalKind = null
            existing.loadError = null
            existing.error = null
          } else {
            // Preserve the local buffer. The rename result is shown as an
            // external conflict so the user can explicitly choose.
            existing.serverMtime = event.newMtime ?? existing.serverMtime
            existing.externalRaw = event.newRaw
            existing.externalKind = 'modified'
            existing.saveStatus = 'external'
            existing.loadError = null
            existing.error = '磁盘文件已变化，本地修改尚未保存'
          }
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
      // Capture state BEFORE the async confirm so we can detect whether a
      // newer event, user edit, delete, or poll changed the tab while we
      // were waiting.
      const capturedSeq = event.seq
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
        // Only update mtime if no newer event arrived AND the tab state is
        // completely unchanged. If a poll set external state, the user
        // edited, or anything else changed the tab while the confirm was
        // pending, we must not touch anything — partial updates would
        // create inconsistent state (e.g. externalRaw from poll but old
        // mtime from this event).
        const latestTab = options.tabs.value.find((item) => item.path === event.path)
        if (
          isLatestEvent(event.path, capturedSeq)
          && latestTab === requestedTab
          && latestTab?.revision === requestedRevision
          && latestTab?.raw === requestedRaw
          && latestTab?.originalRaw === requestedOriginalRaw
          && latestTab?.saveStatus === requestedSaveStatus
          && latestTab?.externalKind === requestedExternalKind
          && latestTab?.externalRaw === requestedExternalRaw
          && latestTab?.serverMtime === requestedServerMtime
          && latestTab?.loadError === requestedLoadError
        ) {
          latestTab.serverMtime = event.newMtime ?? latestTab.serverMtime
        }
        return
      }

      // After confirm, first check whether a newer event has arrived for
      // this path. If so, this event is stale — silently discard it without
      // touching any tab state (raw, external flags, serverMtime, revision,
      // or error). A newer event (with higher seq) makes an event stale;
      // user edits or poll updates do not change the latest seq.
      if (!isLatestEvent(event.path, capturedSeq)) {
        return
      }

      // The event is still current. Validate that no user edit or other
      // state mutation changed the tab while the confirm was pending. If
      // anything drifted, convert to external/modified so the user can
      // explicitly resolve rather than silently losing work — but only if
      // the tab is NOT already in an external state (which means another
      // conflict source such as a poll already set it correctly).
      const latestTab = options.tabs.value.find((item) => item.path === event.path)

      // When the tab object has been replaced (closed + reopened, or any
      // other path-identity reset), the old event must be unconditionally
      // discarded — no state drift into the new tab. A newer event (higher
      // seq) would already short-circuit via isLatestEvent above, but tab
      // replacement can happen without a new event (user close → user open).
      if (latestTab !== requestedTab) return

      if (
        latestTab.path !== event.path
        || latestTab.revision !== requestedRevision
        || latestTab.raw !== requestedRaw
        || latestTab.originalRaw !== requestedOriginalRaw
        || latestTab.saveStatus !== requestedSaveStatus
        || latestTab.externalKind !== requestedExternalKind
        || latestTab.externalRaw !== requestedExternalRaw
        || latestTab.serverMtime !== requestedServerMtime
        || latestTab.loadError !== requestedLoadError
      ) {
        // Object identity matches, but field-level state has drifted. Convert
        // to external/modified so the user resolves rather than silently
        // losing work. The tab must not already be in an external state
        // (which means another conflict source such as a poll already set
        // it correctly).
        if (latestTab.saveStatus !== 'external') {
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
