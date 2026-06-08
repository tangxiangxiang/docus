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
//
// The composable also subscribes to the file-change bus so an AI write
// to a file the user has open is reflected in the tab (with a confirm
// prompt if the tab has unsaved local edits). The bus is a module-level
// shallowRef published by `useFileChangeBus`; the subscription is set
// up once in onMounted, alongside the existing data fetch.

import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, type ShallowRef } from 'vue'
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
import {
  getFileChangeBus,
  type InternalFileChangeEvent,
} from './useFileChangeBus.js'
import type { Tab } from '../../components/vault/tabs'
import type { SidePanel } from '../../components/vault/ActivityBar.vue'

// ---- live tabs publish ----
//
// useEditorTabs is a per-mount composable (it takes `selectPanel` as a
// constructor arg, so the AI panel can't call it from useCurrentNote).
// We side-step that by exposing a module-level ref that
// useEditorTabs publishes to once on mount. useCurrentNote reads it via
// getLiveTabs() and prefers tab.raw over its getPost fallback. This
// keeps the editor buffer live without coupling the two composables'
// function signatures.
//
// The mirror watch is `flush: 'post'` so consumers see the same value
// useEditorTabs saw, not a pre-flush snapshot — that way the AI panel's
// content never lags the editor by a tick.
//
// Test-only escape hatches at the bottom of the block match the
// __resetForTesting pattern used elsewhere.

let _liveTabs: ShallowRef<Tab[]> | null = null
let _mirrorStop: (() => void) | null = null

function _teardownMirror() {
  _mirrorStop?.()
  _mirrorStop = null
}

export function getLiveTabs(): ShallowRef<Tab[]> | null {
  return _liveTabs
}

export function __setLiveTabsForTesting(ref: ShallowRef<Tab[]> | null): void {
  _teardownMirror()
  _liveTabs = ref
}

export function __resetLiveTabsForTesting(): void {
  _teardownMirror()
  _liveTabs = null
}

// openPost singleton: the preview/reading panes intercept
// `a.wiki-link` clicks and need to navigate to the target. They
// can't import `useEditorTabs` directly (it's a per-mount
// composable) so we publish the function here and call it from
// the panes' click handlers. Mirrors the `getLiveTabs` pattern.
let _openPost: ((path: string) => void) | null = null

export function setOpenPostForClicks(fn: ((path: string) => void) | null): void {
  _openPost = fn
}

export function getOpenPostForClicks(): ((path: string) => void) | null {
  return _openPost
}

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
      serverMtime: 0,
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
      tab.serverMtime = post.mtime
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
      // refresh() repopulates `posts` with current mtimes; pick up
      // the new serverMtime so a later external-change compare (or
      // just the uniform data flow) sees the post-save value.
      const post = posts.value.find((p) => p.path === path)
      if (post) tab.serverMtime = post.mtime
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
    // Subscribe to the file-change bus so AI tool writes/deletes/
    // renames get reflected in any open tab. The bus ref is stable
    // from module load (so a watcher set up before any publish can
    // still track it correctly).
    const fileBus = getFileChangeBus()
    let lastSeenSeq = 0
    watch(
      () => fileBus.value,
      (events) => {
        for (const e of events) {
          if (e.seq <= lastSeenSeq) continue
          void applyExternalChange(e)
        }
        lastSeenSeq = events.at(-1)?.seq ?? lastSeenSeq
      },
      { flush: 'post' },
    )
  })

  // Apply one external file-change event. Mutates the tabs list in
  // place (the refs are already reactive). Awaits the confirm
  // prompt for dirty tabs; for renames, closes the old tab (with
  // its own dirty-confirm) and opens a new one.
  async function applyExternalChange(e: InternalFileChangeEvent): Promise<void> {
    if (e.kind === 'rename') {
      const oldTab = tabs.value.find((t) => t.path === e.oldPath)
      if (!oldTab) return
      // closeTab handles its own dirty-confirm. await it so the
      // open of the new tab happens after the old one is gone.
      await closeTab(e.oldPath!)
      if (e.newRaw != null) {
        // Open the new path directly from the bus payload, no
        // extra getPost round-trip.
        const existing = tabs.value.find((t) => t.path === e.path)
        if (existing) {
          existing.raw = e.newRaw
          existing.originalRaw = e.newRaw
          existing.serverMtime = e.newMtime ?? existing.serverMtime
        } else {
          const newTab = makeEmptyTab(e.path)
          newTab.raw = e.newRaw
          newTab.originalRaw = e.newRaw
          newTab.serverMtime = e.newMtime ?? 0
          newTab.loading = false
          tabs.value.push(newTab)
          activePath.value = e.path
          router.replace(pathToUrl(e.path))
        }
      } else {
        // No payload — fall back to a regular open (will fetch).
        await openPost(e.path)
      }
      toast.info(`AI renamed ${e.oldPath} → ${e.path}`)
      return
    }

    // write / delete
    const tab = tabs.value.find((t) => t.path === e.path)
    if (!tab) return
    // A save in flight owns the file until it returns. Drop the
    // external change on the floor; the user's next edit / save
    // will pick up the server state.
    if (tab.saveStatus === 'saving') return

    if (e.kind === 'delete') {
      // Mark the tab stale: clear the content and let the user
      // decide. Closing the tab would lose the user's unsaved
      // edits without consent.
      tab.loadError = '该文件已被 AI 删除'
      return
    }

    // write: tab.dirty tells us whether the user has unsaved
    // keystrokes. If clean, refresh in place. If dirty, ask.
    const isDirty = tab.raw !== tab.originalRaw
    if (isDirty) {
      const ok = await confirm(
        `AI 修改了 ${e.path}。是否用新版本覆盖你的未保存内容？`,
      )
      if (!ok) {
        // 保留本地: keep the user's edits, just update mtime so a
        // later save sees the right baseline.
        tab.serverMtime = e.newMtime ?? tab.serverMtime
        return
      }
    }
    if (e.newRaw != null) {
      tab.raw = e.newRaw
      tab.originalRaw = e.newRaw
    }
    tab.serverMtime = e.newMtime ?? tab.serverMtime
    tab.saveStatus = 'idle'
    tab.error = null
  }
  watch(routePath, (p) => {
    if (p && p !== activePath.value) {
      void openPost(p)
    }
  })

  // Publish our tabs ref to the module-level mirror so other
  // composables (e.g. useCurrentNote) can read it. The watch keeps
  // _liveTabs.value in lockstep with our local `tabs` ref.
  //
  // `deep: true` is load-bearing: typing into the editor mutates a tab
  // property (`tab.raw = val` in onEditorChange), not the array itself.
  // Without deep, the watch would only fire on array reference changes
  // (push/splice/whole replacement) and useCurrentNote would keep
  // returning the stale content from when the tab was opened.
  _teardownMirror()
  if (!_liveTabs) _liveTabs = shallowRef<Tab[]>(tabs.value)
  _mirrorStop = watch(
    tabs,
    (v) => { if (_liveTabs) _liveTabs.value = v },
    { flush: 'post', deep: true },
  )

  // Publish `openPost` so the article surfaces (PreviewPane /
  // ReadingPane) can navigate wiki-link clicks without prop-drilling.
  setOpenPostForClicks(openPost)
  onBeforeUnmount(() => {
    if (_openPost === openPost) setOpenPostForClicks(null)
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
