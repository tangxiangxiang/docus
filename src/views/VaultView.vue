<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
import FileTree from '../components/vault/FileTree.vue'
import TagPanel from '../components/vault/TagPanel.vue'
import EditorPane from '../components/vault/EditorPane.vue'
import PreviewPane from '../components/vault/PreviewPane.vue'
import ActivityBar from '../components/vault/ActivityBar.vue'
import type { SidePanel } from '../components/vault/ActivityBar.vue'
import EditorTabs from '../components/vault/EditorTabs.vue'
import Breadcrumb from '../components/vault/Breadcrumb.vue'
import StatusBar from '../components/vault/StatusBar.vue'
import type { Tab } from '../components/vault/tabs'

const route = useRoute()
const router = useRouter()

/* ---------- Layout state ---------- */
const STORAGE_KEY = 'docus.vault.layout'
type ActivePanel = SidePanel | null
const activePanel = ref<ActivePanel>('files')
const sidePanelWidth = ref(260)
const editorRatio = ref(1)
let saveTimer: number | null = null

const vaultStyle = computed(() => {
  /* 4 children: ActivityBar | side-panel (FileTree or TagPanel) | splitter | editor-area.
   * When no side panel is open we collapse to 2 columns. */
  if (activePanel.value) {
    return {
      gridTemplateColumns: `48px ${sidePanelWidth.value}px 6px 1fr`,
    }
  }
  return {
    gridTemplateColumns: '48px 1fr',
  }
})
const contentStyle = computed(() => ({
  /* editor/preview split inside .content — middle splitter writes to editorRatio */
  '--editor-flex': String(editorRatio.value),
  '--preview-flex': '1',
}))
const vaultRef = ref<HTMLElement | null>(null)

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function loadLayout() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const d = JSON.parse(raw) as {
      activePanel?: ActivePanel | boolean
      fileTreeOpen?: boolean
      sidePanelWidth?: number
      fileTreeWidth?: number
      editorRatio?: number
    }
    /* Backwards compat: older layouts only had a boolean for the file tree. */
    if (d.activePanel === 'files' || d.activePanel === 'tags' || d.activePanel === null) {
      activePanel.value = d.activePanel
    } else if (typeof d.fileTreeOpen === 'boolean') {
      activePanel.value = d.fileTreeOpen ? 'files' : null
    }
    const w = typeof d.sidePanelWidth === 'number'
      ? d.sidePanelWidth
      : typeof d.fileTreeWidth === 'number' ? d.fileTreeWidth : null
    if (w !== null && w >= 150 && w <= 600) sidePanelWidth.value = w
    if (typeof d.editorRatio === 'number' && d.editorRatio >= 0.3 && d.editorRatio <= 3) {
      editorRatio.value = d.editorRatio
    }
  } catch {
    /* ignore */
  }
}

function saveLayout() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activePanel: activePanel.value,
        sidePanelWidth: sidePanelWidth.value,
        editorRatio: editorRatio.value,
      }),
    )
  } catch {
    /* ignore */
  }
}

function selectPanel(panel: SidePanel) {
  /* Click the active button to close, otherwise switch. */
  activePanel.value = activePanel.value === panel ? null : panel
  saveLayout()
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
      /* Middle splitter resizes editor vs preview INSIDE .content.
       * Measure .content directly so we don't have to redo the outer-grid math. */
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
    saveLayout()
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
    if (!confirm('Unsaved changes will be lost. Continue?')) return
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
    if (!confirm(`Discard unsaved changes to "${tab.slug}"?`)) return
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
  }
}

function onEditorChange(slug: string, val: string) {
  const tab = tabs.value.find((t) => t.slug === slug)
  if (!tab) return
  tab.raw = val
  tab.saveStatus = tab.raw === tab.originalRaw ? 'idle' : 'dirty'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    void doSave(slug)
  }, 800)
}

async function doSaveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (activeSlug.value) await doSave(activeSlug.value)
}

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    void doSaveNow()
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'w' && activeSlug.value) {
    e.preventDefault()
    void closeTab(activeSlug.value)
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
    e.preventDefault()
    selectPanel('files')
  }
}

async function onNew() {
  const title = prompt('New post title?')?.trim()
  if (!title) return
  const slug = slugify(title)
  const today = new Date().toISOString().slice(0, 10)
  const raw = stringifyDoc(
    { title, date: today, tags: [], summary: '' },
    `# ${title}\n\nStart writing...\n`,
  )
  try {
    await createPost(slug, raw)
    await refresh()
    await openPost(slug)
  } catch (e) {
    alert(`Create failed: ${(e as Error).message}`)
  }
}

async function onRename(newSlug: string) {
  if (!activeSlug.value) return
  if (newSlug === activeSlug.value) return
  const oldSlug = activeSlug.value
  if (isDirty.value) {
    if (!confirm('Unsaved changes will be lost. Rename anyway?')) return
  }
  try {
    await renamePost(oldSlug, newSlug)
    // Update tab slug
    const tab = tabs.value.find((t) => t.slug === oldSlug)
    if (tab) tab.slug = newSlug
    activeSlug.value = newSlug
    router.replace(`/vault/${newSlug}`)
    await refresh()
  } catch (e) {
    alert(`Rename failed: ${(e as Error).message}`)
  }
}

async function onDelete(slug: string) {
  if (!confirm(`Delete "${slug}"? This cannot be undone.`)) return
  try {
    await deletePost(slug)
    void closeTab(slug)
    await refresh()
  } catch (e) {
    alert(`Delete failed: ${(e as Error).message}`)
  }
}

onMounted(async () => {
  loadLayout()
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

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
})
</script>

<template>
  <div ref="vaultRef" class="vault" tabindex="0" :style="vaultStyle" @keydown="onKeydown">
    <ActivityBar
      :active-panel="activePanel"
      @select-panel="selectPanel"
    />

    <FileTree
      v-if="activePanel === 'files'"
      :posts="posts"
      :current-slug="activeSlug"
      @select="openPost"
      @new="onNew"
      @rename="onRename"
      @delete="onDelete"
    />
    <TagPanel v-else-if="activePanel === 'tags'" :posts="posts" />

    <div
      v-show="activePanel"
      class="splitter"
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize side panel"
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
          <div v-if="t.loading" class="empty">Loading {{ t.slug }}…</div>
          <div v-else-if="t.loadError" class="empty error">{{ t.loadError }}</div>
          <EditorPane
            v-else
            :model-value="t.raw"
            @update:model-value="(val: string) => onEditorChange(t.slug, val)"
          />
        </div>
        <div v-if="!tabs.length" class="content-empty">No file open. Pick a file or create a new one.</div>

        <div
          v-if="tabs.length"
          class="splitter splitter-mid"
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize editor / preview"
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
  </div>
</template>
