import type { Ref } from 'vue'
import type { Tab } from '../../../components/vault/tabs'
import { getFileStates, getPost, recoverPost } from '../../../lib/api'

export function useDiskFileChanges(options: {
  tabs: Ref<Tab[]>
  doSave: (path: string) => Promise<void>
  scheduleSave: (path: string, delay?: number) => void
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
        continue
      }
      if (tab.revision !== tab.savedRevision) {
        try {
          const post = await getPost(tab.path)
          tab.externalRaw = post.raw
          tab.serverMtime = post.mtime
        } catch { tab.externalRaw = null }
        tab.saveStatus = 'external'
        tab.error = '磁盘文件已变化，本地修改尚未保存'
        continue
      }
      try {
        const post = await getPost(tab.path)
        tab.raw = post.raw
        tab.originalRaw = post.raw
        tab.revision += 1
        tab.savedRevision = tab.revision
        tab.serverMtime = post.mtime
        tab.saveStatus = 'idle'
        tab.error = null
      } catch { /* next poll retries */ }
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
    } else {
      if (tab.externalRaw == null) {
        const recovered = await recoverPost(path, tab.raw)
        tab.originalRaw = recovered.raw
        tab.savedRevision = tab.revision
        tab.serverMtime = recovered.mtime
        tab.saveStatus = 'saved'
      } else {
        const diskRaw = tab.externalRaw
        tab.originalRaw = diskRaw
        tab.externalRaw = null
        if (tab.raw === diskRaw) {
          tab.savedRevision = tab.revision
          tab.saveStatus = 'idle'
        } else {
          tab.saveStatus = 'dirty'
          options.scheduleSave(path, 0)
        }
      }
    }
    tab.externalRaw = null
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
