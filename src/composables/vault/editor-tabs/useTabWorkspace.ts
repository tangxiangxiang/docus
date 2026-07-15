import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getPost, getTree, listPosts, type PostSummary, type TreeNode } from '../../../lib/api'
import { disposeMarkdownModel } from '../../../components/vault/monacoModels'
import type { Tab } from '../../../components/vault/tabs'
import { makeEmptyTab, pathToUrl, TAB_HARD_LIMIT, TAB_SOFT_LIMIT } from './tabState'

export function useTabWorkspace(options: {
  confirm: (message: string) => Promise<boolean>
  toastError: (message: string) => void
  toastInfo: (message: string) => void
}) {
  const router = useRouter()
  const tree = ref<TreeNode[]>([])
  const posts = ref<PostSummary[]>([])
  const tabs = ref<Tab[]>([])
  const activePath = ref<string | null>(null)

  const activeTab = computed<Tab | null>(
    () => tabs.value.find((tab) => tab.path === activePath.value) ?? null,
  )
  const isDirty = computed(() =>
    activeTab.value ? activeTab.value.raw !== activeTab.value.originalRaw : false,
  )
  const activeSize = computed(() => {
    const path = activePath.value
    if (!path) return 0
    return posts.value.find((post) => post.path === path)?.size ?? activeTab.value?.raw.length ?? 0
  })

  function navigateTo(path: string | null) {
    void router.replace(path ? pathToUrl(path) : '/vault')
  }

  async function refresh() {
    const [nextTree, nextPosts] = await Promise.all([getTree(), listPosts()])
    tree.value = nextTree
    posts.value = nextPosts
  }

  async function openPost(path: string) {
    const existing = tabs.value.find((tab) => tab.path === path)
    if (existing) {
      activePath.value = path
      navigateTo(path)
      return
    }
    if (tabs.value.length >= TAB_HARD_LIMIT) {
      options.toastError(`标签页已达上限 (${TAB_HARD_LIMIT}),请先关闭一些`)
      return
    }
    if (tabs.value.length >= TAB_SOFT_LIMIT) {
      options.toastInfo('标签页较多,建议关闭不常用的 (按 ⌘P 用命令面板更快)')
    }
    const tab = makeEmptyTab(path)
    tabs.value.push(tab)
    activePath.value = path
    navigateTo(path)
    try {
      const post = await getPost(path)
      tab.raw = post.raw
      tab.originalRaw = post.raw
      tab.title = post.metadata?.title || (post.frontmatter.title as string) || path
      tab.serverMtime = post.mtime
      tab.loading = false
    } catch (error) {
      tab.loadError = (error as Error).message
      tab.loading = false
    }
    await refresh()
  }

  async function restoreOneTab(path: string): Promise<boolean> {
    if (tabs.value.find((tab) => tab.path === path)) return true
    const tab = makeEmptyTab(path)
    tabs.value.push(tab)
    try {
      const post = await getPost(path)
      tab.raw = post.raw
      tab.originalRaw = post.raw
      tab.title = post.metadata?.title || (post.frontmatter.title as string) || path
      tab.serverMtime = post.mtime
      tab.loading = false
      return true
    } catch {
      const index = tabs.value.findIndex((candidate) => candidate.path === path)
      if (index !== -1) tabs.value.splice(index, 1)
      return false
    }
  }

  async function closeTab(path: string, closeOptions?: { skipDirtyCheck?: boolean }): Promise<boolean> {
    const index = tabs.value.findIndex((tab) => tab.path === path)
    if (index === -1) return true
    const tab = tabs.value[index]
    if (!closeOptions?.skipDirtyCheck && tab.raw !== tab.originalRaw) {
      const ok = await options.confirm(`放弃对 "${tab.path}" 的未保存修改?`)
      if (!ok) return false
    }
    tabs.value.splice(index, 1)
    disposeMarkdownModel(path)
    if (activePath.value === path) {
      const next = tabs.value[index] ?? tabs.value[index - 1] ?? null
      activePath.value = next ? next.path : null
      navigateTo(activePath.value)
    }
    return true
  }

  function validClosePaths(paths: string[]): string[] {
    return paths.filter((path) => tabs.value.some((tab) => tab.path === path))
  }

  async function confirmCloseMany(paths: string[]): Promise<boolean> {
    if (paths.length === 0) return true
    const valid = validClosePaths(paths)
    if (valid.length === 0) return true
    const dirty = valid.filter((path) => {
      const tab = tabs.value.find((candidate) => candidate.path === path)
      return tab && tab.raw !== tab.originalRaw
    })
    if (dirty.length === 0) return true
    return options.confirm(
      dirty.length === 1
        ? `放弃对 "${dirty[0]}" 的未保存修改?`
        : `${dirty.length} 个 tab 有未保存修改,确定要全部关闭吗?`,
    )
  }

  function closeManyConfirmed(paths: string[]): void {
    const valid = paths.filter((path) => tabs.value.some((tab) => tab.path === path))
    if (valid.length === 0) return
    const activeIndex = tabs.value.findIndex((tab) => tab.path === activePath.value)
    const closesActive = activePath.value !== null && valid.includes(activePath.value)
    const sorted = [...valid].sort((a, b) => {
      const aIndex = tabs.value.findIndex((tab) => tab.path === a)
      const bIndex = tabs.value.findIndex((tab) => tab.path === b)
      return bIndex - aIndex
    })
    for (const path of sorted) {
      const index = tabs.value.findIndex((tab) => tab.path === path)
      if (index !== -1) tabs.value.splice(index, 1)
      disposeMarkdownModel(path)
    }
    if (closesActive) {
      const next = tabs.value[activeIndex] ?? tabs.value[activeIndex - 1] ?? null
      activePath.value = next?.path ?? null
      navigateTo(activePath.value)
    }
  }

  async function closeMany(paths: string[]): Promise<boolean> {
    const confirmed = await confirmCloseMany(paths)
    if (!confirmed) return false
    closeManyConfirmed(paths)
    return true
  }

  function selectTab(path: string) {
    if (path === activePath.value) return
    const tab = tabs.value.find((candidate) => candidate.path === path)
    if (!tab) return
    activePath.value = path
    navigateTo(path)
  }

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
    restoreOneTab,
    closeTab,
    closeMany,
    confirmCloseMany,
    closeManyConfirmed,
    selectTab,
    navigateTo,
  }
}
