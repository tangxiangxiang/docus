<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useStorage, useDebounceFn } from '@vueuse/core'
import {
  listPosts,
  getPost,
  createPost,
  savePost,
  deletePost,
  renamePost,
  type PostSummary,
} from '../lib/api'
import { stringifyDoc, slugify } from '../lib/frontmatter'
import { useToast } from '../composables/useToast'
import { useConfirm } from '../composables/useConfirm'
import FileTree from '../components/vault/FileTree.vue'
import TagPanel from '../components/vault/TagPanel.vue'
import EditorPane from '../components/vault/EditorPane.vue'
import PreviewPane from '../components/vault/PreviewPane.vue'
import ActivityBar from '../components/vault/ActivityBar.vue'
import type { SidePanel } from '../components/vault/ActivityBar.vue'
import EditorTabs from '../components/vault/EditorTabs.vue'
import Breadcrumb from '../components/vault/Breadcrumb.vue'
import StatusBar from '../components/vault/StatusBar.vue'
import CommandPalette from '../components/vault/CommandPalette.vue'
import type { Tab } from '../components/vault/tabs'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { confirm } = useConfirm()

/* ---------- Layout state (useStorage 自动序列化到 localStorage) ---------- */
type ActivePanel = SidePanel | null
const activePanel = ref<ActivePanel>('files')
const sidePanelWidth = ref(260)
const editorRatio = ref(1)

// 旧版只用 fileTreeOpen 布尔,这里做向后兼容:读旧值转成新 schema
const layout = useStorage('docus.vault.layout', {
  activePanel: 'files' as ActivePanel,
  sidePanelWidth: 260,
  editorRatio: 1,
}, undefined, {
  serializer: {
    read: (raw) => {
      try {
        const d = JSON.parse(raw) as Record<string, unknown>
        const ap = d.activePanel
        let active: ActivePanel = null
        if (ap === 'files' || ap === 'tags' || ap === null) active = ap as ActivePanel
        else if (typeof d.fileTreeOpen === 'boolean') active = d.fileTreeOpen ? 'files' : null
        const w = typeof d.sidePanelWidth === 'number'
          ? d.sidePanelWidth
          : typeof d.fileTreeWidth === 'number' ? d.fileTreeWidth : 260
        const r = typeof d.editorRatio === 'number' ? d.editorRatio : 1
        return { activePanel: active, sidePanelWidth: w, editorRatio: r }
      } catch {
        return { activePanel: 'files' as ActivePanel, sidePanelWidth: 260, editorRatio: 1 }
      }
    },
    write: (v) => JSON.stringify(v),
  },
})

watch(layout, (v) => {
  activePanel.value = v.activePanel
  sidePanelWidth.value = v.sidePanelWidth
  editorRatio.value = v.editorRatio
}, { immediate: true, deep: true })

watch([activePanel, sidePanelWidth, editorRatio], ([ap, w, r]) => {
  layout.value = { activePanel: ap, sidePanelWidth: w, editorRatio: r }
})

const vaultStyle = computed(() => {
  if (activePanel.value) {
    return { gridTemplateColumns: `48px ${sidePanelWidth.value}px 6px 1fr` }
  }
  return { gridTemplateColumns: '48px 1fr' }
})
const contentStyle = computed(() => ({
  '--editor-flex': String(editorRatio.value),
  '--preview-flex': '1',
}))
const vaultRef = ref<HTMLElement | null>(null)
const paletteRef = ref<InstanceType<typeof CommandPalette> | null>(null)

function openSearch() {
  paletteRef.value?.show()
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function selectPanel(panel: SidePanel) {
  activePanel.value = activePanel.value === panel ? null : panel
}

function startDrag(which: 'tree' | 'middle', e: PointerEvent) {
  e.preventDefault()
  const vault = vaultRef.value
  if (!vault) return
  const rect = vault.getBoundingClientRect()
  const startX = e.clientX
  const startTree = sidePanelWidth.value
  const startRatio = editorRatio.value
  const SPLITTER_PX = 6

  const onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - startX
    if (which === 'tree') {
      const max = Math.min(600, rect.width - 480)
      sidePanelWidth.value = clamp(startTree + dx, 150, max)
    } else {
      const content = vault.querySelector<HTMLElement>('.content')
      const total = content ? content.clientWidth - SPLITTER_PX : 0
      if (total <= 0) return
      const startEditor = (total * startRatio) / (1 + startRatio)
      const editorWidth = clamp(startEditor + dx, total * 0.2, total * 0.8)
      editorRatio.value = editorWidth / (total - editorWidth)
    }
  }
  const onUp = () => {
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', onUp)
}

/* ---------- Tabs state ---------- */
const posts = ref<PostSummary[]>([])
const tabs = ref<Tab[]>([])
const activeSlug = ref<string | null>(null)
const activeTab = computed<Tab | null>(
  () => tabs.value.find((t) => t.slug === activeSlug.value) ?? null,
)
const isDirty = computed(() =>
  activeTab.value ? activeTab.value.raw !== activeTab.value.originalRaw : false,
)
const activeSize = computed(() => {
  const slug = activeSlug.value
  if (!slug) return 0
  return posts.value.find((p) => p.slug === slug)?.size ?? activeTab.value?.raw.length ?? 0
})

/* ---------- Tag filter (view-state, in-memory) ---------- */
const activeTagFilter = ref<string | null>(null)
const filteredPosts = computed(() => {
  const t = activeTagFilter.value
  return t ? posts.value.filter((p) => p.tags.includes(t)) : posts.value
})
function onTagSelect(tag: string) {
  if (activeTagFilter.value === tag) {
    activeTagFilter.value = null          // toggle off
  } else {
    activeTagFilter.value = tag
    activePanel.value = 'files'           // ensure file tree is visible
  }
}

async function refresh() {
  posts.value = await listPosts()
}

function makeEmptyTab(slug: string, title = ''): Tab {
  return {
    slug,
    title: title || slug,
    raw: '',
    originalRaw: '',
    saveStatus: 'idle',
    error: null,
    loadError: null,
    loading: true,
  }
}

async function openPost(slug: string) {
  const existing = tabs.value.find((t) => t.slug === slug)
  if (existing) {
    activeSlug.value = slug
    router.replace(`/vault/${slug}`)
    return
  }
  if (isDirty.value && activeSlug.value) {
    const ok = await confirm('有未保存的修改,确定要切换吗?')
    if (!ok) return
  }
  const tab = makeEmptyTab(slug)
  tabs.value.push(tab)
  activeSlug.value = slug
  router.replace(`/vault/${slug}`)
  try {
    const post = await getPost(slug)
    tab.raw = post.raw
    tab.originalRaw = post.raw
    tab.title = (post.frontmatter.title as string) || slug
    tab.loading = false
  } catch (e) {
    tab.loadError = (e as Error).message
    tab.loading = false
  }
  await refresh()
}

async function closeTab(slug: string) {
  const idx = tabs.value.findIndex((t) => t.slug === slug)
  if (idx === -1) return
  const tab = tabs.value[idx]
  if (tab.raw !== tab.originalRaw) {
    const ok = await confirm(`放弃对 "${tab.slug}" 的未保存修改?`)
    if (!ok) return
  }
  tabs.value.splice(idx, 1)
  if (activeSlug.value === slug) {
    const next = tabs.value[idx] ?? tabs.value[idx - 1] ?? null
    activeSlug.value = next ? next.slug : null
    if (activeSlug.value) {
      router.replace(`/vault/${activeSlug.value}`)
    } else {
      router.replace('/vault')
    }
  }
}

function selectTab(slug: string) {
  if (slug === activeSlug.value) return
  const tab = tabs.value.find((t) => t.slug === slug)
  if (!tab) return
  activeSlug.value = slug
  router.replace(`/vault/${slug}`)
}

async function doSave(slug: string): Promise<void> {
  const tab = tabs.value.find((t) => t.slug === slug)
  if (!tab) return
  if (tab.raw === tab.originalRaw) {
    tab.saveStatus = 'idle'
    return
  }
  tab.saveStatus = 'saving'
  tab.error = null
  try {
    await savePost(slug, tab.raw)
    tab.originalRaw = tab.raw
    tab.saveStatus = 'saved'
    await refresh()
  } catch (e) {
    tab.saveStatus = 'error'
    tab.error = (e as Error).message
    toast.error(`保存失败: ${tab.error}`)
  }
}

const debouncedSave = useDebounceFn((slug: string) => {
  void doSave(slug)
}, 800)

function onEditorChange(slug: string, val: string) {
  const tab = tabs.value.find((t) => t.slug === slug)
  if (!tab) return
  tab.raw = val
  tab.saveStatus = tab.raw === tab.originalRaw ? 'idle' : 'dirty'
  debouncedSave(slug)
}

async function doSaveNow() {
  if (activeSlug.value) await doSave(activeSlug.value)
}

function onKeydown(e: KeyboardEvent) {
  const meta = e.metaKey || e.ctrlKey
  if (meta && e.key === 's') {
    e.preventDefault()
    void doSaveNow()
  }
  if (meta && e.key === 'w' && activeSlug.value) {
    e.preventDefault()
    void closeTab(activeSlug.value)
  }
  if (meta && e.key === 'b') {
    e.preventDefault()
    selectPanel('files')
  }
}

async function onNewFromTree() {
  const title = window.prompt('新文章标题?') ?? ''
  if (!title.trim()) return
  await onNew(title)
}

async function onNew(title: string) {
  const trimmed = (title ?? '').trim()
  if (!trimmed) return
  const slug = slugify(trimmed)
  const today = new Date().toISOString().slice(0, 10)
  const raw = stringifyDoc(
    { title: trimmed, date: today, tags: [], summary: '' },
    `# ${trimmed}\n\n开始写吧…\n`,
  )
  try {
    await createPost(slug, raw)
    await refresh()
    await openPost(slug)
    toast.success(`已创建: ${slug}`)
  } catch (e) {
    toast.error(`创建失败: ${(e as Error).message}`)
  }
}

async function onRename(newSlug: string) {
  if (!activeSlug.value) return
  if (newSlug === activeSlug.value) return
  const oldSlug = activeSlug.value
  if (isDirty.value) {
    const ok = await confirm('有未保存的修改,仍要重命名吗?')
    if (!ok) return
  }
  try {
    await renamePost(oldSlug, newSlug)
    const tab = tabs.value.find((t) => t.slug === oldSlug)
    if (tab) tab.slug = newSlug
    activeSlug.value = newSlug
    router.replace(`/vault/${newSlug}`)
    await refresh()
    toast.success(`已重命名为: ${newSlug}`)
  } catch (e) {
    toast.error(`重命名失败: ${(e as Error).message}`)
  }
}

async function onDelete(slug: string) {
  const ok = await confirm(`删除 "${slug}"? 此操作不可恢复。`)
  if (!ok) return
  try {
    await deletePost(slug)
    void closeTab(slug)
    await refresh()
    toast.success(`已删除: ${slug}`)
  } catch (e) {
    toast.error(`删除失败: ${(e as Error).message}`)
  }
}

onMounted(async () => {
  await refresh()
  const slugFromRoute = route.params.slug
  if (typeof slugFromRoute === 'string' && slugFromRoute) {
    await openPost(slugFromRoute)
  }
})

watch(
  () => route.params.slug,
  (slug) => {
    if (typeof slug === 'string' && slug && slug !== activeSlug.value) {
      void openPost(slug)
    }
  },
)
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
      :posts="filteredPosts"
      :current-slug="activeSlug"
      @select="openPost"
      @new="onNewFromTree"
      @rename="onRename"
      @delete="onDelete"
    />
    <TagPanel
      v-else-if="activePanel === 'tags'"
      :posts="posts"
      :active-tag="activeTagFilter"
      @select="onTagSelect"
    />

    <div
      v-show="activePanel"
      class="splitter"
      role="separator"
      aria-orientation="vertical"
      title="拖动调整侧栏宽度"
      @pointerdown="startDrag('tree', $event)"
    />

    <section class="editor-area">
      <Breadcrumb :slug="activeSlug" />
      <EditorTabs :tabs="tabs" :active-slug="activeSlug" @select="selectTab" @close="closeTab" />

      <div class="content" :style="contentStyle">
        <div
          v-for="t in tabs"
          v-show="t.slug === activeSlug"
          :key="t.slug"
          class="editor-pane"
        >
          <div v-if="t.loading" class="empty">正在加载 {{ t.slug }}…</div>
          <div v-else-if="t.loadError" class="empty error">{{ t.loadError }}</div>
          <EditorPane
            v-else
            :model-value="t.raw"
            @update:model-value="(val: string) => onEditorChange(t.slug, val)"
          />
        </div>
        <div v-if="!tabs.length" class="content-empty">未打开文件。在侧栏选一个或按 <kbd>⌘P</kbd> 新建。</div>

        <div
          v-if="tabs.length"
          class="splitter splitter-mid"
          role="separator"
          aria-orientation="vertical"
          title="拖动调整编辑器 / 预览"
          @pointerdown="startDrag('middle', $event)"
        />

        <div
          v-for="t in tabs"
          v-show="t.slug === activeSlug"
          :key="`p-${t.slug}`"
          class="preview-pane"
        >
          <PreviewPane v-if="!t.loading && !t.loadError" :raw="t.raw" />
        </div>
      </div>

      <StatusBar
        :slug="activeSlug"
        :save-status="activeTab?.saveStatus ?? 'idle'"
        :error="activeTab?.error ?? null"
        :size="activeSize"
        :dirty="isDirty"
      />
    </section>

    <CommandPalette
      ref="paletteRef"
      :posts="posts"
      :active-slug="activeSlug"
      @select="openPost"
      @new="onNew"
    />
  </div>
</template>
