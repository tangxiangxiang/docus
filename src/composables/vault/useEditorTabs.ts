// Public editor-tabs coordinator. Mutable state and behavior live in focused
// composables under editor-tabs/; this module preserves the VaultView API and
// wires lifecycle, persistence restore, command-palette creation, and cleanup.

import { onBeforeUnmount, onMounted } from 'vue'
import { createPost } from '../../lib/api'
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
import {
  __setVaultIdForTesting,
  readPersistedTabs,
  useTabPersistence,
} from './editor-tabs/useTabPersistence'
import {
  clearOpenPostForClicks,
  publishLiveTabs,
  setOpenPostForClicks,
} from './editor-tabs/liveTabPublishing'

export {
  __resetLiveTabsForTesting,
  __resetOpenPostForClicks,
  __setLiveTabsForTesting,
  getLiveTabs,
  getOpenPostForClicks,
  setOpenPostForClicks,
} from './editor-tabs/liveTabPublishing'
export { __setVaultIdForTesting } from './editor-tabs/useTabPersistence'

export function useEditorTabs(opts: {
  selectPanel: (panel: SidePanel) => void
  /* Wired into the Cmd-\ shortcut to flip the preview pane open/closed
     in edit mode. Accepted as a callback (not looked up globally) for
     the same reason selectPanel is — keeps the layout dependency
     explicit. */
  togglePreview: () => void
}) {
  const toast = useToast()
  const { confirm } = useConfirm()

  const {
    tree,
    posts,
    tabs,
    activePath,
    activeTab,
    isDirty,
    activeSize,
    refresh,
    openPost,
    restoreOneTab,
    closeTab,
    closeMany,
    selectTab,
    navigateTo,
  } = useTabWorkspace({
    confirm,
    toastError: toast.error,
    toastInfo: toast.info,
  })

  const { resolveVaultId } = useTabPersistence(tabs, activePath)

  const {
    scheduleSave,
    doSave,
    onEditorChange,
    handleBeforeUnload,
    doSaveNow,
    disposeDocumentSave,
  } = useDocumentSave({
    tabs,
    posts,
    activePath,
    refresh,
    toastError: toast.error,
  })

  const {
    handleOnline,
    pollExternalChanges,
    resolveExternal,
    startExternalPolling,
    stopExternalPolling,
  } = useDiskFileChanges({ tabs, doSave, scheduleSave })

  const { onKeydown } = useEditorShortcuts({
    tabs,
    activePath,
    doSaveNow,
    closeTab,
    selectTab,
    selectFilesPanel: () => opts.selectPanel('files'),
    togglePreview: opts.togglePreview,
  })

  async function onCommandPaletteNew(title: string) {
    const trimmed = (title ?? '').trim()
    if (!trimmed) return
    const parent = activePath.value ? activePath.value.replace(/\/[^/]+$/, '') : ''
    const filename = toLocalSlug(trimmed)
    if (!filename || !isSlugSegment(filename)) {
      toast.error('名称只能使用小写英文、数字和连字符')
      return
    }
    const newPath = parent ? `${parent}/${filename}` : filename
    try {
      await createPost({ path: newPath, title: trimmed })
      await refresh()
      await openPost(newPath)
      toast.success(`已创建: ${newPath}`)
    } catch (e) {
      toast.error(`创建失败: ${(e as Error).message}`)
    }
  }

  const { subscribeToFileChanges } = useExternalFileChanges({
    tabs,
    activePath,
    closeTab,
    openPost,
    navigateTo: (path) => { navigateTo(path) },
    confirm,
    toastInfo: toast.info,
  })

  const { routePath } = useRouteSync({ activePath, openPost })

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
    // Resolve the vault id once and cache it for the persist watcher.
    // The cache lifetime is the page session — a refresh re-fetches,
    // but for the duration of one mount the id is stable.
    const vaultId = await resolveVaultId()

    const saved = readPersistedTabs(vaultId)
    if (saved && saved.paths.length > 0) {
      const missing: string[] = []
      const toRestore = saved.paths.slice(0, TAB_HARD_LIMIT)
      for (const p of toRestore) {
        const ok = await restoreOneTab(p)
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
        const more = missing.length > 3 ? `\n(还有 ${missing.length - 3} 个)` : ''
        toast.info(`${missing.length} 个标签页已不存在:\n${sample}${more}`)
      }
    }

    if (routePath.value && routePath.value !== activePath.value) {
      await openPost(routePath.value)
    }
    // Subscribe to the file-change bus so AI tool writes/deletes/
    // renames get reflected in any open tab. The bus ref is stable
    // from module load (so a watcher set up before any publish can
    // still track it correctly).
    subscribeToFileChanges()
  })

  publishLiveTabs(tabs)
  setOpenPostForClicks(openPost)
  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', handleBeforeUnload)
    window.removeEventListener('online', handleOnline)
    stopExternalPolling()
    disposeDocumentSave()
    clearOpenPostForClicks(openPost)
  })

  startExternalPolling()

  return {
    tree,
    posts,
    tabs,
    activePath,
    activeTab,
    isDirty,
    activeSize,
    refresh,
    openPost,
    closeTab,
    closeMany,
    selectTab,
    onEditorChange,
    doSaveNow,
    resolveExternal,
    pollExternalChanges,
    onKeydown,
    onCommandPaletteNew,
  }
}
