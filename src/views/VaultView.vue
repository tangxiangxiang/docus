<script setup lang="ts">
import { ref, computed, onMounted, watch, inject, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDebounceFn } from '@vueuse/core'
import {
  listPosts,
  getPost,
  getTree,
  createPost,
  type PostSummary,
  type TreeNode,
} from '../lib/api'
import { useToast } from '../composables/useToast'
import { useConfirm } from '../composables/useConfirm'
import { useVaultLayout } from '../composables/vault/useVaultLayout'
import FileTree from '../components/vault/FileTree.vue'
import TagPanel from '../components/vault/TagPanel.vue'
import EditorPane from '../components/vault/EditorPane.vue'
import PreviewPane from '../components/vault/PreviewPane.vue'
import ActivityBar from '../components/vault/ActivityBar.vue'
import EditorTabs from '../components/vault/EditorTabs.vue'
import Breadcrumb from '../components/vault/Breadcrumb.vue'
import StatusBar from '../components/vault/StatusBar.vue'
import CommandPalette from '../components/vault/CommandPalette.vue'
import type { Tab } from '../components/vault/tabs'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { confirm } = useConfirm()

/* App.vue provides a global "open search" trigger so the NavBar button
   (which lives outside the router view) can ask the vault to open
   its CommandPalette. We watch the tick and call show() each time. */
const navSearch = inject<{ tick: ReturnType<typeof ref<number>>; trigger: () => void } | null>('openSearch', null)
watch(() => navSearch?.tick.value, () => openSearch())

/* ---------- Layout state ---------- */
const {
  activePanel,
  vaultStyle,
  contentStyle,
  selectPanel,
  startDrag,
} = useVaultLayout()

// Lives in VaultView (not the composable) so the string `ref="vaultRef"`
// template binding resolves cleanly. The composable's startDrag takes
// the host element as a parameter.
const vaultRef = shallowRef<HTMLElement | null>(null)
const paletteRef = ref<InstanceType<typeof CommandPalette> | null>(null)

function openSearch() {
  paletteRef.value?.show()
}

/** "notes/draft" -> "/vault/notes/draft" (path is already relative to src/content/). */
function pathToUrl(p: string): string {
  return '/vault/' + p
}

/* ---------- Tabs state ---------- */
const tree = ref<TreeNode[]>([])
const posts = ref<PostSummary[]>([])
const tabs = ref<Tab[]>([])
const activePath = ref<string | null>(null)
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

/* ---------- Tag filter (view-state, in-memory) ---------- */
const activeTagFilter = ref<string | null>(null)
function onTagSelect(tag: string) {
  if (activeTagFilter.value === tag) {
    activeTagFilter.value = null          // toggle off
  } else {
    activeTagFilter.value = tag
    activePanel.value = 'files'           // ensure file tree is visible
  }
}

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
    selectPanel('files')
  }
}

// FileTree now handles its own create/rename/delete via usePrompt and useConfirm.
// These hooks are kept here as no-ops for backwards compatibility with any external
// code that still emits @new/@rename/@delete; they can be removed in a follow-up.

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
</script>

<template>
  <div ref="vaultRef" class="vault" tabindex="0" :style="vaultStyle" @keydown="onKeydown">
    <ActivityBar
      :active-panel="activePanel"
      @select-panel="selectPanel"
      @open-search="openSearch"
    />

    <FileTree
      v-if="activePanel === 'files'"
      :tree="tree"
      :current-path="activePath"
      @select="openPost"
      @refresh="refresh"
    />
    <TagPanel
      v-else-if="activePanel === 'tags'"
      :posts="posts"
      :active-tag="activeTagFilter"
      :path="activePath"
      @select="onTagSelect"
      @open="openPost"
    />

    <div
      v-show="activePanel"
      class="splitter"
      role="separator"
      aria-orientation="vertical"
      title="拖动调整侧栏宽度"
      @pointerdown="startDrag(vaultRef!, 'tree', $event)"
    />

    <section class="editor-area">
      <EditorTabs :tabs="tabs" :active-path="activePath" @select="selectTab" @close="closeTab" @open-search="openSearch" />
      <Breadcrumb :current-path="activePath" />

      <div class="content" :style="contentStyle">
        <div
          v-for="t in tabs"
          v-show="t.path === activePath"
          :key="t.path"
          class="editor-pane"
        >
          <div v-if="t.loading" class="empty">正在加载 {{ t.path }}…</div>
          <div v-else-if="t.loadError" class="empty error">{{ t.loadError }}</div>
          <EditorPane
            v-else
            :model-value="t.raw"
            @update:model-value="(val: string) => onEditorChange(t.path, val)"
          />
        </div>
        <div v-if="!tabs.length" class="content-empty">未打开文件。在侧栏选一个或按 <kbd>⌘P</kbd> 新建。</div>

        <div
          v-if="tabs.length"
          class="splitter splitter-mid"
          role="separator"
          aria-orientation="vertical"
          title="拖动调整编辑器 / 预览"
          @pointerdown="startDrag(vaultRef!, 'middle', $event)"
        />

        <div
          v-for="t in tabs"
          v-show="t.path === activePath"
          :key="`p-${t.path}`"
          class="preview-pane"
        >
          <PreviewPane v-if="!t.loading && !t.loadError" :raw="t.raw" />
        </div>
      </div>
    </section>

    <StatusBar
      class="status-bar-row"
      :path="activePath"
      :save-status="activeTab?.saveStatus ?? 'idle'"
      :error="activeTab?.error ?? null"
      :size="activeSize"
      :dirty="isDirty"
    />

    <CommandPalette
      ref="paletteRef"
      :posts="posts"
      :active-path="activePath"
      @select="openPost"
      @new="onCommandPaletteNew"
    />
  </div>
</template>
