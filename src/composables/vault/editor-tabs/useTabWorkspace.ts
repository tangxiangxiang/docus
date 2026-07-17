import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getPost, getTree, listPosts, type PostSummary, type TreeNode } from '../../../lib/api'
import { disposeMarkdownModel, renameMarkdownModel } from '../../../components/vault/monacoModelRegistry'
import type { Tab } from '../../../components/vault/tabs'
import { makeEmptyTab, pathToUrl, TAB_HARD_LIMIT, TAB_SOFT_LIMIT } from './tabState'
import { useI18n } from '../../useI18n'
import {
  applyPostSummaryToWorkspace,
  createLocalPostPatchTracker,
} from './workspacePostSummary'

export function requiresCloseConfirmation(tab: Tab): boolean {
  return tab.raw !== tab.originalRaw
    || tab.revision !== tab.savedRevision
    || tab.savingRevision !== null
    || tab.saveStatus === 'external'
    || tab.externalRaw != null
    || ['error', 'offline'].includes(tab.saveStatus)
}

export function useTabWorkspace(options: {
  confirm: (message: string) => Promise<boolean>
  toastError: (message: string) => void
  toastInfo: (message: string) => void
  /**
   * Synchronous session persist. Called after every close / rename /
   * restore-failure that mutates `tabs.value`, so a refresh before
   * the debounce flushes the watcher cannot resurrect a closed tab.
   * Optional — callers can bind it later via the `setPersist`
   * returned in the API.
   */
  persist?: () => void
}) {
  const { t } = useI18n()
  const router = useRouter()
  const tree = ref<TreeNode[]>([])
  const posts = ref<PostSummary[]>([])
  const tabs = ref<Tab[]>([])
  const activePath = ref<string | null>(null)
  let refreshRequestId = 0
  const localPostPatches = createLocalPostPatchTracker()
  // The workspace holds an internal mutable slot for the persister.
  // Callers can swap it later (see `setPersist` in the API) — needed
  // because `useTabPersistence` reads `tabs` / `activePath` after the
  // workspace has constructed them, and the persister depends on
  // those refs.
  let persistRef: (() => void) | undefined = options.persist

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

  /** Persist immediately. Best-effort — if persist is not bound
   *  (e.g. unit tests that don't care), this is a no-op. */
  function flushPersist(): void {
    persistRef?.()
  }

  function setPersist(persist: () => void): void {
    persistRef = persist
  }

  async function refresh() {
    const requestId = ++refreshRequestId
    const startedAtPatchSeq = localPostPatches.currentSeq()
    const [nextTree, nextPosts] = await Promise.all([getTree(), listPosts()])
    if (requestId !== refreshRequestId) return
    let mergedTree = nextTree
    let mergedPosts = nextPosts
    for (const patch of localPostPatches.after(startedAtPatchSeq)) {
      const merged = applyPostSummaryToWorkspace(mergedTree, mergedPosts, patch.post)
      mergedTree = merged.tree
      mergedPosts = merged.posts
    }
    tree.value = mergedTree
    posts.value = mergedPosts
    localPostPatches.settleThrough(startedAtPatchSeq)
  }

  function applyPostSummary(post: PostSummary): void {
    const snapshot = localPostPatches.record(post).post
    const next = applyPostSummaryToWorkspace(tree.value, posts.value, snapshot)
    tree.value = next.tree
    posts.value = next.posts
    const tab = tabs.value.find((candidate) => candidate.path === post.path)
    if (tab) tab.title = post.title
  }

  async function openPost(path: string, openOptions: { refresh?: boolean } = {}) {
    const existing = tabs.value.find((tab) => tab.path === path)
    if (existing) {
      activePath.value = path
      navigateTo(path)
      return
    }
    if (tabs.value.length >= TAB_HARD_LIMIT) {
      options.toastError(t('editor.tab_limit', { count: TAB_HARD_LIMIT }))
      return
    }
    if (tabs.value.length >= TAB_SOFT_LIMIT) {
      options.toastInfo(t('editor.many_tabs'))
    }
    const tab = makeEmptyTab(path)
    tabs.value.push(tab)
    activePath.value = path
    navigateTo(path)
    try {
      const post = await getPost(path)
      // Race guard: the user may have closed this tab while getPost
      // was in flight. If so, drop the populated data and remove the
      // (now-orphan) placeholder. The watcher debounce will not have
      // caught this yet, so we also persist synchronously.
      const stillOpen = tabs.value.includes(tab)
      if (!stillOpen) return
      tab.raw = post.raw
      tab.originalRaw = post.raw
      tab.title = post.metadata?.title || (post.frontmatter.title as string) || path
      tab.serverMtime = post.mtime
      tab.loading = false
    } catch (error) {
      const stillOpen = tabs.value.includes(tab)
      if (!stillOpen) return
      tab.loadError = (error as Error).message
      tab.loading = false
    }
    flushPersist()
    if (openOptions.refresh !== false) await refresh()
  }

  async function restoreOneTab(path: string): Promise<boolean> {
    if (tabs.value.find((tab) => tab.path === path)) return true
    const tab = makeEmptyTab(path)
    tabs.value.push(tab)
    flushPersist()
    try {
      const post = await getPost(path)
      // Race guard: if the user closed this tab while the request was
      // pending, the tab object has already been spliced from the
      // array. Don't resurrect it, and make sure the persisted list
      // doesn't carry a stale entry either.
      if (!tabs.value.includes(tab)) {
        flushPersist()
        return false
      }
      tab.raw = post.raw
      tab.originalRaw = post.raw
      tab.title = post.metadata?.title || (post.frontmatter.title as string) || path
      tab.serverMtime = post.mtime
      tab.loading = false
      flushPersist()
      return true
    } catch {
      const index = tabs.value.findIndex((candidate) => candidate.path === path)
      if (index !== -1) tabs.value.splice(index, 1)
      flushPersist()
      return false
    }
  }

  async function closeTab(path: string, closeOptions?: { skipDirtyCheck?: boolean }): Promise<boolean> {
    const index = tabs.value.findIndex((tab) => tab.path === path)
    if (index === -1) return true
    const tab = tabs.value[index]
    if (!closeOptions?.skipDirtyCheck && requiresCloseConfirmation(tab)) {
      const ok = await options.confirm(t('editor.discard_one', { path: tab.path }))
      if (!ok) return false
    }
    tabs.value.splice(index, 1)
    disposeMarkdownModel(path)
    if (activePath.value === path) {
      const next = tabs.value[index] ?? tabs.value[index - 1] ?? null
      activePath.value = next ? next.path : null
      navigateTo(activePath.value)
    }
    flushPersist()
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
      return tab && requiresCloseConfirmation(tab)
    })
    if (dirty.length === 0) return true
    return options.confirm(
      dirty.length === 1
        ? t('editor.discard_one', { path: dirty[0] })
        : t('editor.discard_many', { count: dirty.length }),
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
    flushPersist()
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

  function renameOpenDocuments(mappings: ReadonlyArray<{ from: string; to: string }>): void {
    const bySource = new Map(
      mappings.filter(({ from, to }) => from && to && from !== to).map((item) => [item.from, item.to]),
    )
    if (bySource.size === 0) return
    for (const [fromPath, nextPath] of bySource) {
      const source = tabs.value.find((tab) => tab.path === fromPath)
      if (!source) continue
      const duplicateIndex = tabs.value.findIndex((tab) => tab !== source && tab.path === nextPath)
      if (duplicateIndex !== -1) tabs.value.splice(duplicateIndex, 1)
      renameMarkdownModel(fromPath, nextPath)
      source.path = nextPath
    }
    // Replace the array identity so shallow persistence/watch consumers record
    // non-active tab migrations too.
    tabs.value = [...tabs.value]
    const nextActive = activePath.value ? bySource.get(activePath.value) : null
    if (nextActive) {
      activePath.value = nextActive
      navigateTo(nextActive)
    }
    flushPersist()
  }

  function removeOpenDocuments(paths: readonly string[]): void {
    closeManyConfirmed([...new Set(paths)])
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
    applyPostSummary,
    openPost,
    restoreOneTab,
    closeTab,
    closeMany,
    confirmCloseMany,
    closeManyConfirmed,
    selectTab,
    renameOpenDocuments,
    removeOpenDocuments,
    navigateTo,
    setPersist,
  }
}