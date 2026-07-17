// Public editor-tabs coordinator. Mutable state and behavior live in focused
// composables under editor-tabs/; this module preserves the VaultView API and
// wires lifecycle, persistence restore, command-palette creation, and cleanup.

import { onBeforeUnmount, onMounted } from 'vue'
import { createPost, type PostSummary } from '../../lib/api'
import { useToast } from '../useToast'
import { useConfirm } from '../useConfirm'
import type { SidePanel } from '../../components/vault/ActivityBar.vue'
import { isSlugSegment, toLocalSlug } from '../../lib/slug'
import { TAB_HARD_LIMIT } from './editor-tabs/tabState'
import { useEditorShortcuts } from './editor-tabs/useEditorShortcuts'
import { useRouteSync } from './editor-tabs/useRouteSync'
import { useExternalFileChanges } from './editor-tabs/useExternalFileChanges'
import { useDiskFileChanges } from './editor-tabs/useDiskFileChanges'
import { useTabWorkspace } from './editor-tabs/useTabWorkspace'
import { useDocumentSave } from './editor-tabs/useDocumentSave'
import type { VaultFileChanges } from './context/fileChanges'
import {
  __setVaultIdForTesting,
  readPersistedTabs,
  useTabPersistence,
} from './editor-tabs/useTabPersistence'
import { useI18n } from '../useI18n'
import { createPathMutationLock, toMutationPaths } from './pathMutationLock'
export { __setVaultIdForTesting } from './editor-tabs/useTabPersistence'

export function useEditorTabs(opts: {
  selectPanel: (panel: SidePanel) => void
  /* Wired into the Cmd/Ctrl+E shortcut to toggle between edit and read
     mode. Accepted as a callback (not looked up globally) for the same
     reason selectPanel is — keeps the layout dependency explicit. */
  toggleViewMode: () => void
  fileChanges: VaultFileChanges
  mutationLock?: ReturnType<typeof createPathMutationLock>
  createDocument?: (input: { path: string; title?: string }) => Promise<PostSummary>
}) {
  const toast = useToast()
  const { confirm } = useConfirm()
  const { t } = useI18n()
  const fileChanges = opts.fileChanges

  const {
    tree,
    posts,
    tabs,
    activePath,
    activeTab,
    isDirty,
    activeSize,
    refresh,
    applyPostSummary,
    openPost,
    restoreOneTab,
    closeTab: closeTabState,
    confirmCloseMany: confirmCloseManyState,
    closeManyConfirmed,
    selectTab,
    navigateTo,
    renameOpenDocuments,
    removeOpenDocuments,
  } = useTabWorkspace({
    confirm,
    toastError: toast.error,
    toastInfo: toast.info,
  })

  const { vaultId, resolveVaultId } = useTabPersistence(tabs, activePath)

  const {
    scheduleSave,
    doSave,
    onEditorChange,
    handleBeforeUnload,
    doSaveNow,
    prepareHistoryCommit,
    prepareHistoryRestore,
    prepareDocumentMutation,
    prepareDocumentClose,
    disposeDocumentSave,
  } = useDocumentSave({
    tabs,
    activePath,
    applyPostSummary,
    fileChanges,
    toastError: toast.error,
  })

  async function closeTab(path: string): Promise<boolean> {
    const release = opts.mutationLock?.acquire(toMutationPaths([path])) ?? null
    if (opts.mutationLock && !release) return false
    try {
      const barrier = await prepareDocumentClose([path])
      const closed = await closeTabState(path)
      if (closed) barrier.commit()
      else barrier.rollback()
      return closed
    } finally {
      release?.()
    }
  }

  async function confirmCloseMany(paths: string[]): Promise<boolean> {
    const release = opts.mutationLock?.acquire(toMutationPaths(paths)) ?? null
    if (opts.mutationLock && !release) return false
    try {
      const barrier = await prepareDocumentClose(paths)
      const confirmed = await confirmCloseManyState(paths)
      if (confirmed) barrier.commit()
      else barrier.rollback()
      return confirmed
    } finally {
      release?.()
    }
  }

  async function closeMany(paths: string[]): Promise<boolean> {
    if (!(await confirmCloseMany(paths))) return false
    closeManyConfirmed(paths)
    return true
  }

  const {
    handleOnline,
    pollExternalChanges,
    resolveExternal,
    startExternalPolling,
    stopExternalPolling,
    invalidateDiskRead,
    invalidateDiskObservation,
  } = useDiskFileChanges({ tabs, doSave, scheduleSave, applyPostSummary, fileChanges })

  const { onKeydown } = useEditorShortcuts({
    tabs,
    activePath,
    doSaveNow,
    closeTab,
    selectTab,
    selectFilesPanel: () => opts.selectPanel('files'),
    toggleViewMode: opts.toggleViewMode,
  })

  async function onCommandPaletteNew(title: string) {
    const trimmed = (title ?? '').trim()
    if (!trimmed) return
    const parent = activePath.value ? activePath.value.replace(/\/[^/]+$/, '') : ''
    const filename = toLocalSlug(trimmed)
    if (!filename || !isSlugSegment(filename)) {
      toast.error(t('common.name_invalid'))
      return
    }
    const newPath = parent ? `${parent}/${filename}` : filename
    try {
      let created: PostSummary
      if (opts.createDocument) {
        created = await opts.createDocument({ path: newPath, title: trimmed })
      } else {
        created = await createPost({ path: newPath, title: trimmed })
        fileChanges.publish({ path: created.path, kind: 'write', source: 'editor-lifecycle' })
        try {
          await refresh()
        } catch (error) {
          console.warn(`[useEditorTabs] Created ${created.path}, but Vault refresh failed`, error)
        }
      }
      await openPost(created.path, { refresh: false })
      toast.success(t('common.created', { path: created.path }))
    } catch (e) {
      toast.error(t('common.create_failed', { error: (e as Error).message }))
    }
  }

  const { applyLifecycleReferenceWrites, subscribeToFileChanges } = useExternalFileChanges({
    fileChanges,
    tabs,
    activePath,
    closeTab,
    openPost,
    navigateTo: (path) => { navigateTo(path) },
    confirm,
    toastInfo: toast.info,
    invalidateDiskRead,
    invalidateDiskObservation,
  })

  const { routePath } = useRouteSync({ activePath, openPost })
  let disposed = false
  let stopFileChangeSubscription: (() => void) | null = null

  // Initial load: refresh the tree + posts, then restore any tabs
  // persisted from the previous session, then handle a deep-link
  // override if the URL specifies a path. Order matters:
  //   1. refresh() — needed for getPost calls inside restoreOneTab.
  //   2. Restore persisted tabs. Each path is probed via getPost so
  //      a deleted/renamed file silently drops out (and is reported
  //      in one aggregate toast). Restore is capped at TAB_HARD_LIMIT
  //      to match the runtime cap, so we never end up with more tabs
  //      than the UI accepts.
  //   3. Deep-link override. If the URL points to a different path
  //      than the restored active, open it (additive — the restored
  //      tabs stay). If the deep-link points to one of the restored
  //      tabs, openPost just reactivates it (no duplicate tab).
  // The routePath watcher (no `immediate: true`) handles subsequent
  // URL changes; we don't want it to also fire on mount or we'd
  // double-open.
  onMounted(async () => {
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('online', handleOnline)
    await refresh()
    if (disposed) return
    // Resolve the vault id once and cache it for the persist watcher.
    // The cache lifetime is the page session — a refresh re-fetches,
    // but for the duration of one mount the id is stable.
    const vaultId = await resolveVaultId()
    if (disposed) return

    const saved = readPersistedTabs(vaultId)
    if (saved && saved.paths.length > 0) {
      const missing: string[] = []
      const toRestore = saved.paths.slice(0, TAB_HARD_LIMIT)
      for (const p of toRestore) {
        const ok = await restoreOneTab(p)
        if (disposed) return
        if (!ok) missing.push(p)
      }
      if (tabs.value.length > 0) {
        // Prefer the saved active if it survived restore; otherwise
        // fall back to the first restored tab (left-to-right reading
        // order matches the persisted order).
        const target = saved.active && tabs.value.some((t) => t.path === saved.active)
          ? saved.active
          : tabs.value[0].path
        activePath.value = target
        navigateTo(target)
      }
      if (missing.length > 0) {
        const sample = missing.slice(0, 3).map((p) => `· ${p}`).join('\n')
        const more = missing.length > 3 ? t('editor.missing_more', { count: missing.length - 3 }) : ''
        toast.info(t('editor.missing_tabs', { count: missing.length, paths: sample, more }))
      }
    }

    if (routePath.value && routePath.value !== activePath.value) {
      await openPost(routePath.value)
      if (disposed) return
    }
    // Subscribe to the file-change bus so AI tool writes/deletes/
    // renames get reflected in any open tab. The bus ref is stable
    // for the lifetime of this Vault instance (so a watcher set up
    // before any publish can still track it correctly).
    stopFileChangeSubscription = subscribeToFileChanges()
  })

  onBeforeUnmount(() => {
    disposed = true
    stopFileChangeSubscription?.()
    stopFileChangeSubscription = null
    window.removeEventListener('beforeunload', handleBeforeUnload)
    window.removeEventListener('online', handleOnline)
    stopExternalPolling()
    disposeDocumentSave()
  })

  startExternalPolling()

  return {
    tree,
    vaultId,
    posts,
    tabs,
    activePath,
    activeTab,
    isDirty,
    activeSize,
    refresh,
    applyPostSummary,
    openPost,
    closeTab,
    closeMany,
    confirmCloseMany,
    closeManyConfirmed,
    renameOpenDocuments,
    removeOpenDocuments,
    applyLifecycleReferenceWrites,
    selectTab,
    onEditorChange,
    doSaveNow,
    prepareHistoryCommit,
    prepareHistoryRestore,
    prepareDocumentMutation,
    resolveExternal,
    pollExternalChanges,
    onKeydown,
    onCommandPaletteNew,
  }
}
