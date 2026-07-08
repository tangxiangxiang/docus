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
// Cmd-\ (\) toggles the edit-mode preview pane (see
// useVaultLayout.togglePreview). In read mode the preview pane isn't
// rendered, so the shortcut becomes a no-op for the user — the
// preference is persisted and re-applied when they switch back.
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
import { isSlugSegment, toLocalSlug } from '../../lib/slug'

/* Tab-count limits. vault is a personal Zettelkasten — heavy
   multi-tab editing (20+ tabs) signals the user should be using
   command palette / search, not cycling through tabs. Two thresholds:
   - TAB_SOFT_LIMIT (6): past this, each new open emits a soft
     reminder toast. Opening still succeeds — the user might have a
     legitimate reason to hold many tabs open briefly.
   - TAB_HARD_LIMIT (9): opening refuses. The user must close a tab
     first. Picked to leave ~3 tabs of headroom between the soft
     nudge and the hard wall, so the nudge has time to land before
     the wall arrives.
   The 9 hard cap also matches the visual budget: tabs are 100px wide
   (see .tab in style.css), so 9 × 100 = 900px fits inside the
   typical editor column on 1280px+ viewports without horizontal
   scrolling. */
const TAB_SOFT_LIMIT = 6
const TAB_HARD_LIMIT = 9

// ---- tab persistence ----
//
// On refresh, restore the user's previous tab set + active tab from
// localStorage. This matches the VSCode / IDEA mental model: refresh ≠
// lose workspace. We persist the bare path list + active — content is
// already covered by the auto-save debounce, and scroll position is out
// of scope for v1.
//
// Stale paths (file deleted/renamed while the app was closed) are
// filtered out at load time via a per-path getPost probe. Missing
// paths surface as one aggregate toast (listing up to 3 + overflow
// count) so the user knows the workspace shifted, instead of silent
// drops.
//
// The key is versioned (`:v1`) so future schema changes can detect old
// data and ignore it cleanly without crashing the load. We degrade
// silently on localStorage errors (private mode, quota) — persistence
// is a nice-to-have, not load-bearing.

const TAB_PERSIST_KEY = 'docus:tabs:v1'
const TAB_PERSIST_MAX = 20
const TAB_PERSIST_DEBOUNCE_MS = 100

interface PersistedTabs {
  v: number
  paths: string[]
  active: string | null
}

function readPersistedTabs(): PersistedTabs | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(TAB_PERSIST_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (
      typeof parsed === 'object' && parsed !== null
      && (parsed as { v?: unknown }).v === 1
      && Array.isArray((parsed as { paths?: unknown }).paths)
    ) {
      const paths = ((parsed as { paths: unknown[] }).paths)
        .filter((p): p is string => typeof p === 'string')
        .slice(0, TAB_PERSIST_MAX)
      const rawActive = (parsed as { active?: unknown }).active
      return {
        v: 1,
        paths,
        active: typeof rawActive === 'string' ? rawActive : null,
      }
    }
  } catch {
    // Corrupt JSON — treat as empty.
  }
  return null
}

function writePersistedTabs(tabs: Tab[], active: string | null) {
  try {
    const data: PersistedTabs = {
      v: 1,
      paths: tabs.map((t) => t.path).slice(0, TAB_PERSIST_MAX),
      active,
    }
    localStorage.setItem(TAB_PERSIST_KEY, JSON.stringify(data))
  } catch {
    // localStorage may throw (private mode, quota). Persistence is a
    // nice-to-have, not load-bearing — silently degrade.
  }
}

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

/** Test-only: replace the click-time openPost handler (passing
 *  null clears it). Mirrors `__setLiveTabsForTesting`. */
export function __resetOpenPostForClicks(fn: ((path: string) => void) | null): void {
  setOpenPostForClicks(fn)
}

export function useEditorTabs(opts: {
  selectPanel: (panel: SidePanel) => void
  /* Wired into the Cmd-\ shortcut to flip the preview pane open/closed
     in edit mode. Accepted as a callback (not looked up globally) for
     the same reason selectPanel is — keeps the layout dependency
     explicit. */
  togglePreview: () => void
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
    // Hard cap: refuse the open entirely. We don't try LRU eviction
    // because (a) the user's mental model of "I'm opening X" is more
    // important than the auto-close of some other Y, and (b) we'd
    // risk evicting a tab the user is mid-edit on.
    if (tabs.value.length >= TAB_HARD_LIMIT) {
      toast.error(`标签页已达上限 (${TAB_HARD_LIMIT}),请先关闭一些`)
      return
    }
    // Soft cap: still open, but nudge. We don't deduplicate the
    // toast per-call — a fresh open really is a fresh decision
    // point, and spamming would be worse than a missed nudge.
    if (tabs.value.length >= TAB_SOFT_LIMIT) {
      toast.info('标签页较多,建议关闭不常用的 (按 ⌘P 用命令面板更快)')
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

  // Restore a single tab during startup without going through
  // openPost. The differences are intentional:
  //   - No hard-cap check (we slice to the cap before calling, so
  //     we can never exceed it).
  //   - No soft-limit toast (we're restoring, not opening — the
  //     user already accepted this count by setting it last session).
  //   - No dirty-confirm (fresh mount, nothing is dirty yet).
  //   - No router.replace (we sync the URL once at the end of the
  //     restore loop, not per tab).
  //   - On getPost failure we silently drop the tab (and report the
  //     missing paths in one toast). openPost instead surfaces a
  //     visible loadError card, which would be noisy on startup.
  async function restoreOneTab(path: string): Promise<boolean> {
    if (tabs.value.find((t) => t.path === path)) return true
    const tab = makeEmptyTab(path)
    tabs.value.push(tab)
    try {
      const post = await getPost(path)
      tab.raw = post.raw
      tab.originalRaw = post.raw
      tab.title = (post.frontmatter.title as string) || path
      tab.serverMtime = post.mtime
      tab.loading = false
      return true
    } catch {
      const idx = tabs.value.findIndex((t) => t.path === path)
      if (idx !== -1) tabs.value.splice(idx, 1)
      return false
    }
  }

  // Debounced write of the persisted tab set. Watched (below) — no
  // need to call from each mutation site.
  const debouncedPersist = useDebounceFn(
    () => writePersistedTabs(tabs.value, activePath.value),
    TAB_PERSIST_DEBOUNCE_MS,
  )

  async function closeTab(path: string, opts?: { skipDirtyCheck?: boolean }): Promise<void> {
    const idx = tabs.value.findIndex((t) => t.path === path)
    if (idx === -1) return
    const tab = tabs.value[idx]
    // The dirty check is the only prompt-driven path in closeTab. The
    // batched closeMany() shows ONE prompt covering all dirty tabs in
    // the batch up front, then calls back into closeTab with
    // skipDirtyCheck: true so we don't N-prompt the user.
    if (!opts?.skipDirtyCheck && tab.raw !== tab.originalRaw) {
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

  // Batched close used by the right-click "Close Others / Close to the
  // Right / Close All" menu. Shows ONE prompt if any tab in the batch
  // is dirty (listing the count), then closes everything in descending
  // tab-index order so the active-tab-jumps-left logic in closeTab
  // produces the expected "we moved left" navigation for every removal
  // (and the indices we sorted on stay stable until the actual splice).
  async function closeMany(paths: string[]): Promise<void> {
    if (paths.length === 0) return
    const valid = paths.filter((p) => tabs.value.some((t) => t.path === p))
    if (valid.length === 0) return
    const dirty = valid.filter((p) => {
      const t = tabs.value.find((tab) => tab.path === p)
      return t && t.raw !== t.originalRaw
    })
    if (dirty.length > 0) {
      const ok = await confirm(
        dirty.length === 1
          ? `放弃对 "${dirty[0]}" 的未保存修改?`
          : `${dirty.length} 个 tab 有未保存修改,确定要全部关闭吗?`,
      )
      if (!ok) return
    }
    // Snapshot indices in the comparator (sort runs BEFORE any splice),
    // then close from highest index down so each removal leaves the
    // remaining indices consistent with what the next iteration reads.
    const sorted = [...valid].sort((a, b) => {
      const ia = tabs.value.findIndex((t) => t.path === a)
      const ib = tabs.value.findIndex((t) => t.path === b)
      return ib - ia
    })
    for (const p of sorted) {
      await closeTab(p, { skipDirtyCheck: true })
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
    // Capture the version we sent so we can tell on response whether
    // the user kept typing during the PUT round-trip. If so, their
    // latest keystrokes win and we DON'T overwrite with the server's
    // bumped raw (which would lose those keystrokes).
    const sentVersion = tab.raw
    try {
      const r = await fetch('/api/posts/' + encodeURI(path), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ raw: tab.raw }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = (await r.json()) as { ok: true; raw: string }
      if (tab.raw === sentVersion) {
        // No keystrokes landed during the round-trip — adopt the
        // server's bumped version (which now has the new `updated:`
        // line) so the editor's frontmatter matches the on-disk file.
        tab.raw = data.raw
        tab.originalRaw = data.raw
      } else {
        // The user kept typing. Their buffer is the source of truth;
        // just mark it as the new saved baseline. The next debounced
        // save will pick up the bumped `updated:` on disk.
        tab.originalRaw = tab.raw
      }
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
    // Cmd-\ (or Ctrl-\) toggles the edit-mode preview pane. The
    // shortcut mirrors the "Edit + Preview" option in the ViewModeMenu
    // picker in NavBar — see useVaultLayout.togglePreview and the
    // NavBar's <ViewModeMenu> for the matching user-visible affordance.
    // The keyboard variant stays in sync whether or not the user has
    // focus inside the editor: the listener is bound to the outer
    // .vault root, so any keystroke while the vault has focus works
    // (useEditorTabs.onKeydown is gated on `isReadMode` indirectly via
    // VaultView's edit-mode template branch — read mode has its own
    // tab navigation, but Cmd-\ falls through to the no-op condition
    // we don't add because the preview pane is simply not rendered in
    // read mode, so toggling the bit has no visible effect there).
    if (meta && e.key === '\\') {
      e.preventDefault()
      opts.togglePreview()
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
    await refresh()

    const saved = readPersistedTabs()
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
        router.replace(pathToUrl(target))
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

  // Persist on every (debounced) tab/active change. Watching the
  // public state covers openPost, closeTab, closeMany, selectTab,
  // and applyExternalChange without each call site needing its own
  // wiring. `deep: false` is enough because the mutations we care
  // about are array-level (push/splice) and `activePath = ...`,
  // both of which swap the ref's value.
  watch(
    [tabs, activePath],
    () => { debouncedPersist() },
    { deep: false },
  )

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
    closeMany,
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
