import type { Ref } from 'vue'
import type { Tab } from '../../../components/vault/tabs'
import { getFileStates, getPost, recoverPost, type PostSummary } from '../../../lib/api'
import type { VaultFileChanges } from '../context/fileChanges'

export function useDiskFileChanges(options: {
  tabs: Ref<Tab[]>
  doSave: (path: string) => Promise<void>
  scheduleSave: (path: string, delay?: number) => void
  applyPostSummary: (post: PostSummary) => void
  fileChanges: VaultFileChanges
}) {
  let externalPollTimer: ReturnType<typeof setInterval> | null = null
  const externalResolutionIds = new Map<string, number>()

  function beginExternalResolution(path: string): number {
    const id = (externalResolutionIds.get(path) ?? 0) + 1
    externalResolutionIds.set(path, id)
    return id
  }

  function isCurrentExternalResolution(
    path: string,
    id: number,
    tab: Tab,
    externalKind: Tab['externalKind'],
  ): boolean {
    const latestTab = options.tabs.value.find((item) => item.path === path)
    return externalResolutionIds.get(path) === id
      && latestTab === tab
      && latestTab.path === path
      && latestTab.saveStatus === 'external'
      && latestTab.externalKind === externalKind
  }

  async function pollExternalChanges() {
    const loaded = options.tabs.value.filter((tab) =>
      !tab.loading && (!tab.loadError || tab.externalKind === 'deleted'),
    )
    if (!loaded.length) return
    let states: Awaited<ReturnType<typeof getFileStates>>
    try { states = await getFileStates(loaded.map((tab) => tab.path)) } catch { return }
    for (const state of states) {
      const tab = options.tabs.value.find((item) => item.path === state.path)
      if (!tab || tab.savingRevision !== null) continue
      if (!state.exists) {
        tab.saveStatus = 'external'
        tab.error = '文件已从磁盘删除'
        tab.externalRaw = null
        tab.externalKind = 'deleted'
        continue
      }
      if (tab.externalKind !== 'deleted' && state.mtime === tab.serverMtime) continue

      const requestedPath = tab.path
      const requestedRevision = tab.revision
      const requestedSavedRevision = tab.savedRevision
      const requestedOriginalRaw = tab.originalRaw
      const requestedServerMtime = tab.serverMtime
      const requestedExternalKind = tab.externalKind
      const requestedTab = tab
      try {
        const post = await getPost(requestedPath)
        const latestTab = options.tabs.value.find((item) => item.path === requestedPath)
        if (
          latestTab !== requestedTab
          || latestTab.path !== requestedPath
          || latestTab.savingRevision !== null
          || (
            requestedExternalKind !== 'deleted'
            && state.mtime === latestTab.serverMtime
          )
          || latestTab.revision !== requestedRevision
          || latestTab.savedRevision !== requestedSavedRevision
          || latestTab.originalRaw !== requestedOriginalRaw
          || latestTab.serverMtime !== requestedServerMtime
        ) continue

        if (requestedExternalKind === 'deleted') {
          latestTab.externalRaw = post.raw
          latestTab.externalKind = 'modified'
          latestTab.serverMtime = post.mtime
          latestTab.saveStatus = 'external'
          latestTab.error = '磁盘文件已重新出现，请选择使用磁盘或保留本地版本'
          latestTab.loadError = null
          continue
        }

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
    const requestedExternalKind = tab.externalKind
    const resolutionId = beginExternalResolution(path)
    if (tab.externalKind === 'unreadable') {
      const requestedTab = tab
      const requestedPath = tab.path
      const requestedRevision = tab.revision
      try {
        const post = await getPost(requestedPath)
        if (!isCurrentExternalResolution(
          requestedPath,
          resolutionId,
          requestedTab,
          requestedExternalKind,
        )) return
        const latestTab = options.tabs.value.find((item) => item.path === requestedPath)
        if (latestTab !== requestedTab || latestTab.path !== requestedPath) return

        latestTab.externalRaw = post.raw
        latestTab.externalKind = 'modified'
        latestTab.serverMtime = post.mtime
        latestTab.loadError = null
        if (latestTab.revision !== requestedRevision) {
          if (strategy === 'local') {
            latestTab.originalRaw = post.raw
            latestTab.externalRaw = null
            latestTab.externalKind = null
            latestTab.saveStatus = latestTab.raw === post.raw ? 'idle' : 'dirty'
            if (latestTab.saveStatus === 'idle') {
              latestTab.savedRevision = latestTab.revision
            } else {
              options.scheduleSave(path, 0)
            }
            latestTab.error = null
          } else {
            latestTab.error = null
          }
          return
        }
      } catch {
        if (!isCurrentExternalResolution(
          requestedPath,
          resolutionId,
          requestedTab,
          requestedExternalKind,
        )) return
        const latestTab = options.tabs.value.find((item) => item.path === requestedPath)
        if (latestTab === requestedTab) {
          latestTab.error = '暂时无法读取磁盘文件，将在下次检查时重试'
        }
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
      const sentRaw = tab.raw
      const sentRevision = tab.revision
      let recovered: Awaited<ReturnType<typeof recoverPost>>
      try {
        recovered = await recoverPost(path, sentRaw)
        // Concurrent deleted keep-local requests express the same intent. If an
        // older request is the one that recreates the file, applying that
        // successful transaction also settles any newer duplicate request.
        const latestTab = options.tabs.value.find((item) => item.path === path)
        if (
          latestTab !== tab
          || latestTab.saveStatus !== 'external'
          || latestTab.externalKind !== requestedExternalKind
        ) return
      } catch (recoverError) {
        if (!isCurrentExternalResolution(
          path,
          resolutionId,
          tab,
          requestedExternalKind,
        )) return
        try {
          const post = await getPost(path)
          if (!isCurrentExternalResolution(
            path,
            resolutionId,
            tab,
            requestedExternalKind,
          )) return
          const latestTab = options.tabs.value.find((item) => item.path === path)
          if (latestTab !== tab || latestTab.path !== path) return
          if (post.raw === latestTab.raw) {
            latestTab.originalRaw = post.raw
            latestTab.savedRevision = latestTab.revision
            latestTab.serverMtime = post.mtime
            latestTab.savingRevision = null
            latestTab.saveStatus = 'saved'
            latestTab.externalRaw = null
            latestTab.externalKind = null
            latestTab.loadError = null
            latestTab.error = null
            return
          }
          latestTab.externalRaw = post.raw
          latestTab.externalKind = 'modified'
          latestTab.serverMtime = post.mtime
          latestTab.saveStatus = 'external'
          latestTab.loadError = null
          latestTab.error = '磁盘文件已重新出现，请重新选择使用磁盘或保留本地版本'
          return
        } catch {
          throw recoverError
        }
      }
      tab.originalRaw = recovered.raw
      tab.savedRevision = sentRevision
      tab.serverMtime = recovered.mtime
      options.applyPostSummary(recovered.post)
      options.fileChanges.publish({
        path,
        kind: 'write',
        source: 'editor-lifecycle',
        newMtime: recovered.mtime,
      })
      if (tab.revision === sentRevision) {
        tab.saveStatus = 'saved'
      } else {
        tab.saveStatus = 'dirty'
        options.scheduleSave(path, 0)
      }
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
    tab.loadError = null
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
