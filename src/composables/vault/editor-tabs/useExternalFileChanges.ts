import { watch, type Ref } from 'vue'
import type { Tab } from '../../../components/vault/tabs'
import { getFileChangeBus, type InternalFileChangeEvent } from '../useFileChangeBus.js'
import { makeEmptyTab } from './tabState'

export function useExternalFileChanges(options: {
  tabs: Ref<Tab[]>
  activePath: Ref<string | null>
  closeTab: (path: string) => Promise<void>
  openPost: (path: string) => Promise<void>
  navigateTo: (path: string) => void
  confirm: (message: string) => Promise<boolean>
  toastInfo: (message: string) => void
}) {
  async function applyExternalChange(event: InternalFileChangeEvent): Promise<void> {
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
      options.toastInfo(`AI renamed ${event.oldPath} → ${event.path}`)
      return
    }

    const tab = options.tabs.value.find((candidate) => candidate.path === event.path)
    if (!tab) return
    if (tab.saveStatus === 'saving') return

    if (event.kind === 'delete') {
      tab.loadError = '该文件已被 AI 删除'
      return
    }

    const isDirty = tab.raw !== tab.originalRaw
    if (isDirty) {
      const ok = await options.confirm(
        `AI 修改了 ${event.path}。是否用新版本覆盖你的未保存内容？`,
      )
      if (!ok) {
        tab.serverMtime = event.newMtime ?? tab.serverMtime
        return
      }
    }
    if (event.newRaw != null) {
      tab.raw = event.newRaw
      tab.originalRaw = event.newRaw
    }
    tab.serverMtime = event.newMtime ?? tab.serverMtime
    tab.saveStatus = 'idle'
    tab.error = null
  }

  function subscribeToFileChanges() {
    const fileBus = getFileChangeBus()
    let lastSeenSeq = 0
    watch(
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

  return { applyExternalChange, subscribeToFileChanges }
}
