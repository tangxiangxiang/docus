import type { Ref } from 'vue'
import type { Tab } from '../../../components/vault/tabs'
import { getFileStates, getPost, recoverPost, type PostSummary } from '../../../lib/api'

export function useDiskFileChanges(options: {
  tabs: Ref<Tab[]>
  doSave: (path: string) => Promise<void>
  scheduleSave: (path: string, delay?: number) => void
  applyPostSummary: (post: PostSummary) => void
}) {
  let externalPollTimer: ReturnType<typeof setInterval> | null = null

  async function pollExternalChanges() {
    const loaded = options.tabs.value.filter((tab) => !tab.loading && !tab.loadError)
    if (!loaded.length) return
    let states: Awaited<ReturnType<typeof getFileStates>>
    try { states = await getFileStates(loaded.map((tab) => tab.path)) } catch { return }
    for (const state of states) {
      const tab = options.tabs.value.find((item) => item.path === state.path)
      if (!tab || tab.savingRevision !== null || state.mtime === tab.serverMtime) continue
      if (!state.exists) {
        tab.saveStatus = 'external'
        tab.error = '文件已从磁盘删除'
        tab.externalRaw = null
        tab.externalKind = 'deleted'
        continue
      }

      const requestedPath = tab.path
      const requestedRevision = tab.revision
      const requestedSavedRevision = tab.savedRevision
      const requestedOriginalRaw = tab.originalRaw
      const requestedServerMtime = tab.serverMtime
      const requestedTab = tab
      try {
        const post = await getPost(requestedPath)
        const latestTab = options.tabs.value.find((item) => item.path === requestedPath)
        if (
          latestTab !== requestedTab
          || latestTab.path !== requestedPath
          || latestTab.savingRevision !== null
          || state.mtime === latestTab.serverMtime
          || latestTab.revision !== requestedRevision
          || latestTab.savedRevision !== requestedSavedRevision
          || latestTab.originalRaw !== requestedOriginalRaw
          || latestTab.serverMtime !== requestedServerMtime
        ) continue

        const dirty = latestTab.raw !== latestTab.originalRaw
          || latestTab.revision !== latestTab.savedRevision
        if (dirty) {
          latestTab.externalRaw = post.raw
          latestTab.externalKind = 'modified'
          latestTab.serverMtime = post.mtime
          latestTab.saveStatus = 'external'
          latestTab.error = '磁盘文件已变化，本地修改尚未保存'
          continue
        }

        latestTab.raw = post.raw
        latestTab.originalRaw = post.raw
        latestTab.revision += 1
        latestTab.savedRevision = latestTab.revision
        latestTab.serverMtime = post.mtime
        latestTab.saveStatus = 'idle'
        latestTab.error = null
        latestTab.externalKind = null
      } catch {
        const latestTab = options.tabs.value.find((item) => item.path === requestedPath)
        if (
          latestTab === requestedTab
          && latestTab.savingRevision === null
          && latestTab.revision === requestedRevision
          && latestTab.savedRevision === requestedSavedRevision
          && latestTab.originalRaw === requestedOriginalRaw
          && latestTab.serverMtime === requestedServerMtime
        ) {
          // State confirmed that the path exists. A failed body read is not
          // evidence of deletion and must not route keep-local through recover.
          latestTab.externalKind = 'unreadable'
          latestTab.saveStatus = 'external'
          latestTab.error = '暂时无法读取磁盘文件，将在下次检查时重试'
        }
      }
    }
  }

  function handleOnline() {
    for (const tab of options.tabs.value) {
      if (tab.saveStatus === 'offline') void options.doSave(tab.path)
    }
  }

  async function resolveExternal(path: string, strategy: 'disk' | 'local') {
    const tab = options.tabs.value.find((item) => item.path === path)
    if (!tab || tab.saveStatus !== 'external') return
    if (tab.externalKind === 'deleted' && strategy === 'disk') return
    if (tab.externalKind === 'unreadable') {
      try {
        const post = await getPost(path)
        tab.externalRaw = post.raw
        tab.externalKind = 'modified'
        tab.serverMtime = post.mtime
      } catch {
        tab.error = '暂时无法读取磁盘文件，将在下次检查时重试'
        return
      }
    }
    if (strategy === 'disk') {
      const diskRaw = tab.externalRaw
      const post = diskRaw === null ? await getPost(path) : null
      const resolvedRaw = diskRaw ?? post!.raw
      tab.raw = resolvedRaw
      tab.originalRaw = resolvedRaw
      tab.revision += 1
      tab.savedRevision = tab.revision
      if (post) tab.serverMtime = post.mtime
      tab.savingRevision = null
      tab.saveStatus = 'idle'
    } else if (tab.externalKind === 'deleted') {
      const recovered = await recoverPost(path, tab.raw)
      tab.originalRaw = recovered.raw
      tab.savedRevision = tab.revision
      tab.serverMtime = recovered.mtime
      tab.saveStatus = 'saved'
      options.applyPostSummary(recovered.post)
    } else {
      const diskRaw = tab.externalRaw
      if (diskRaw == null) return
      tab.originalRaw = diskRaw
      tab.externalRaw = null
      tab.externalKind = null
      if (tab.raw === diskRaw) {
        tab.savedRevision = tab.revision
        tab.saveStatus = 'idle'
      } else {
        tab.saveStatus = 'dirty'
        options.scheduleSave(path, 0)
      }
    }
    tab.externalRaw = null
    tab.externalKind = null
    tab.error = null
  }

  function startExternalPolling() {
    externalPollTimer = setInterval(() => { void pollExternalChanges() }, 5_000)
  }

  function stopExternalPolling() {
    if (externalPollTimer) clearInterval(externalPollTimer)
    externalPollTimer = null
  }

  return {
    handleOnline,
    pollExternalChanges,
    resolveExternal,
    startExternalPolling,
    stopExternalPolling,
  }
}
