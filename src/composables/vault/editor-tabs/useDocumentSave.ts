import type { Ref } from 'vue'
import type { Tab } from '../../../components/vault/tabs'
import type { PostSummary } from '../../../lib/api'

export function useDocumentSave(options: {
  tabs: Ref<Tab[]>
  posts: Ref<PostSummary[]>
  activePath: Ref<string | null>
  refresh: () => Promise<void>
  toastError: (message: string) => void
}) {
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const savePromises = new Map<string, Promise<void>>()

  function scheduleSave(path: string, delay = 800) {
    const current = saveTimers.get(path)
    if (current) clearTimeout(current)
    saveTimers.set(path, setTimeout(() => {
      saveTimers.delete(path)
      void doSave(path)
    }, delay))
  }

  async function saveLatest(path: string): Promise<void> {
    const tab = options.tabs.value.find((candidate) => candidate.path === path)
    if (!tab) return
    if (tab.revision === tab.savedRevision) {
      tab.saveStatus = 'idle'
      return
    }
    const sentRevision = tab.revision
    const sentVersion = tab.raw
    tab.savingRevision = sentRevision
    tab.saveStatus = 'saving'
    tab.error = null
    try {
      const response = await fetch('/api/posts/' + encodeURI(path), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ raw: sentVersion }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = (await response.json()) as { ok: true; raw: string }
      if (tab.raw === sentVersion) {
        tab.raw = data.raw
        tab.originalRaw = data.raw
      } else {
        tab.originalRaw = sentVersion
      }
      tab.savedRevision = sentRevision
      tab.saveStatus = tab.revision === sentRevision ? 'saved' : 'dirty'
      await options.refresh()
      const post = options.posts.value.find((candidate) => candidate.path === path)
      if (post) tab.serverMtime = post.mtime
    } catch (error) {
      tab.saveStatus = typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error'
      tab.error = (error as Error).message
      options.toastError(`保存失败: ${tab.error}`)
    } finally {
      tab.savingRevision = null
    }
  }

  async function doSave(path: string): Promise<void> {
    const active = savePromises.get(path)
    if (active) return active
    const promise = (async () => {
      do {
        await saveLatest(path)
        const tab = options.tabs.value.find((candidate) => candidate.path === path)
        if (!tab || ['error', 'offline', 'external'].includes(tab.saveStatus)
            || tab.revision === tab.savedRevision) break
      } while (true)
    })().finally(() => savePromises.delete(path))
    savePromises.set(path, promise)
    return promise
  }

  function onEditorChange(path: string, value: string) {
    const tab = options.tabs.value.find((candidate) => candidate.path === path)
    if (!tab) return
    tab.raw = value
    tab.revision += 1
    if (tab.raw === tab.originalRaw) tab.savedRevision = tab.revision
    tab.saveStatus = tab.revision === tab.savedRevision ? 'idle' : 'dirty'
    scheduleSave(path)
  }

  function handleBeforeUnload(event: BeforeUnloadEvent) {
    const hasUnsaved = options.tabs.value.some((tab) =>
      tab.revision !== tab.savedRevision || ['error', 'offline', 'saving'].includes(tab.saveStatus),
    )
    if (!hasUnsaved) return
    event.preventDefault()
    event.returnValue = ''
  }

  async function doSaveNow() {
    if (options.activePath.value) await doSave(options.activePath.value)
  }

  function disposeDocumentSave() {
    for (const timer of saveTimers.values()) clearTimeout(timer)
    saveTimers.clear()
  }

  return {
    scheduleSave,
    doSave,
    onEditorChange,
    handleBeforeUnload,
    doSaveNow,
    disposeDocumentSave,
  }
}
