// Editor-tab state for the vault: the open tabs, the active path, the
// file/post data, the save/load logic, and the keyboard shortcuts that
// operate on tabs (Cmd-S = save, Cmd-W = close tab, Cmd-B = toggle
// Files panel).
//
// The composable owns the full save state machine (idle / dirty / saving
// / saved / error) per tab, plus the 800ms debounce on editor edits and
// the route sync that turns deep-links (`/vault/notes/draft`) into
// `openPost` calls. It also owns the data fetch (refresh, getPost) and
// the command-palette "new" flow (slugify + createPost + openPost).
//
// `onKeydown` is bound to the outer .vault div in VaultView's template;
// we keep it here so the shortcut definitions live next to the actions
// they trigger. Cmd-B needs to flip the layout's activePanel to
// 'files', so the composable accepts the layout's selectPanel via the
// constructor — the dependency is explicit, not a global lookup.

import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDebounceFn } from '@vueuse/core'
import {
  listPosts,
  getPost,
  getTree,
  createPost,
  type PostSummary,
  type TreeNode,
} from '../../lib/api'
import { useToast } from '../useToast'
import { useConfirm } from '../useConfirm'
import type { Tab } from '../../components/vault/tabs'
import type { SidePanel } from '../../components/vault/ActivityBar.vue'

export function useEditorTabs(opts: {
  selectPanel: (panel: SidePanel) => void
}) {
  const route = useRoute()
  const router = useRouter()
  const toast = useToast()
  const { confirm } = useConfirm()

  const tree = ref<TreeNode[]>([])
  const posts = ref<PostSummary[]>([])
  const tabs = ref<Tab[]>([])
  const activePath = ref<string | null>(null)

  // The deep-link target: the route's `pathMatch` is an array of path
  // segments (vue-router splat param). Empty array means no path, which
  // is the /vault landing page.
  const routePath = computed<string | null>(() => {
    const m = (route.params.pathMatch as string[] | undefined) ?? []
    return m.length ? m.join('/') : null
  })

  const activeTab = computed<Tab | null>(
    () => tabs.value.find((t) => t.path === activePath.value) ?? null,
  )
  const isDirty = computed(() =>
    activeTab.value ? activeTab.value.raw !== activeTab.value.originalRaw : false,
  )
  const activeSize = computed(() => {
    const p = activePath.value
    if (!p) return 0
    return posts.value.find((post) => post.path === p)?.size ?? activeTab.value?.raw.length ?? 0
  })

  async function refresh() {
    const [t, p] = await Promise.all([getTree(), listPosts()])
    tree.value = t
    posts.value = p
  }

  function makeEmptyTab(path: string, title = ''): Tab {
    return {
      path,
      title: title || path,
      raw: '',
      originalRaw: '',
      saveStatus: 'idle',
      error: null,
      loadError: null,
      loading: true,
    }
  }

  async function openPost(path: string) {
    const existing = tabs.value.find((t) => t.path === path)
    if (existing) {
      activePath.value = path
      router.replace(pathToUrl(path))
      return
    }
    // The confirm() must run *before* any tab mutation, so an in-flight
    // click can't interleave with another openPost and leave the tabs
    // list in an unexpected state.
    if (isDirty.value && activePath.value) {
      const ok = await confirm('有未保存的修改,确定要切换吗?')
      if (!ok) return
    }
    const tab = makeEmptyTab(path)
    tabs.value.push(tab)
    activePath.value = path
    router.replace(pathToUrl(path))
    try {
      const post = await getPost(path)
      tab.raw = post.raw
      tab.originalRaw = post.raw
      tab.title = (post.frontmatter.title as string) || path
      tab.loading = false
    } catch (e) {
      tab.loadError = (e as Error).message
      tab.loading = false
    }
    await refresh()
  }

  async function closeTab(path: string) {
    const idx = tabs.value.findIndex((t) => t.path === path)
    if (idx === -1) return
    const tab = tabs.value[idx]
    if (tab.raw !== tab.originalRaw) {
      const ok = await confirm(`放弃对 "${tab.path}" 的未保存修改?`)
      if (!ok) return
    }
    tabs.value.splice(idx, 1)
    if (activePath.value === path) {
      const next = tabs.value[idx] ?? tabs.value[idx - 1] ?? null
      activePath.value = next ? next.path : null
      if (activePath.value) {
        router.replace(pathToUrl(activePath.value))
      } else {
        router.replace('/vault')
      }
    }
  }

  function selectTab(path: string) {
    if (path === activePath.value) return
    const tab = tabs.value.find((t) => t.path === path)
    if (!tab) return
    activePath.value = path
    router.replace(pathToUrl(path))
  }

  async function doSave(path: string): Promise<void> {
    const tab = tabs.value.find((t) => t.path === path)
    if (!tab) return
    if (tab.raw === tab.originalRaw) {
      tab.saveStatus = 'idle'
      return
    }
    tab.saveStatus = 'saving'
    tab.error = null
    try {
      const r = await fetch('/api/posts/' + encodeURI(path), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ raw: tab.raw }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      tab.originalRaw = tab.raw
      tab.saveStatus = 'saved'
      await refresh()
    } catch (e) {
      tab.saveStatus = 'error'
      tab.error = (e as Error).message
      toast.error(`保存失败: ${tab.error}`)
    }
  }

  const debouncedSave = useDebounceFn((path: string) => {
    void doSave(path)
  }, 800)

  function onEditorChange(path: string, val: string) {
    const tab = tabs.value.find((t) => t.path === path)
    if (!tab) return
    tab.raw = val
    tab.saveStatus = tab.raw === tab.originalRaw ? 'idle' : 'dirty'
    debouncedSave(path)
  }

  async function doSaveNow() {
    if (activePath.value) await doSave(activePath.value)
  }

  function onKeydown(e: KeyboardEvent) {
    const meta = e.metaKey || e.ctrlKey
    if (meta && e.key === 's') {
      e.preventDefault()
      void doSaveNow()
    }
    if (meta && e.key === 'w' && activePath.value) {
      e.preventDefault()
      void closeTab(activePath.value)
    }
    if (meta && e.key === 'b') {
      e.preventDefault()
      opts.selectPanel('files')
    }
    // Ctrl+Tab / Ctrl+Shift+Tab — cycle through open tabs. Matches the
    // browser convention: Tab goes forward, Shift+Tab goes backward.
    // Falls back to first/last if nothing is open or the active tab is
    // missing (e.g. closed externally).
    if (meta && e.key === 'Tab' && tabs.value.length > 0) {
      e.preventDefault()
      const cur = tabs.value.findIndex((t) => t.path === activePath.value)
      const dir = e.shiftKey ? -1 : 1
      const nextIdx = cur === -1
        ? (dir > 0 ? 0 : tabs.value.length - 1)
        : (cur + dir + tabs.value.length) % tabs.value.length
      selectTab(tabs.value[nextIdx].path)
    }
  }

  async function onCommandPaletteNew(title: string) {
    const trimmed = (title ?? '').trim()
    if (!trimmed) return
    const parent = activePath.value ? activePath.value.replace(/\/[^/]+$/, '') : ''
    const filename = trimmed.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    if (!filename) { toast.error('名称无效'); return }
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

  // Initial load: refresh the tree + posts, then if the URL already has a
  // path, open that file. The watch below (no `immediate: true`) handles
  // subsequent URL changes; we don't want the watch to also fire on
  // mount or we'd double-open.
  onMounted(async () => {
    await refresh()
    if (routePath.value) {
      await openPost(routePath.value)
    }
  })
  watch(routePath, (p) => {
    if (p && p !== activePath.value) {
      void openPost(p)
    }
  })

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
    selectTab,
    onEditorChange,
    doSaveNow,
    onKeydown,
    onCommandPaletteNew,
  }
}

// Tiny URL helper, hoisted out as a function rather than a const so it
// reads as "transform path -> URL" at the call sites.
function pathToUrl(p: string): string {
  return '/vault/' + p
}
