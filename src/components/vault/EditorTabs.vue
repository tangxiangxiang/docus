<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { Tab } from './tabs'

const props = defineProps<{ tabs: Tab[]; activePath: string | null }>()
const emit = defineEmits<{
  select: [path: string]
  close: [path: string]
  'close-many': [paths: string[]]
}>()

/* The tab label is just the file's basename, not the full path —
   the status bar footer now carries the full path (formerly a
   breadcrumb row above the editor). The tooltip on the tab keeps
   the path available on hover for power users. */
function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}
function stripMd(name: string): string {
  return name.endsWith('.md') ? name.slice(0, -3) : name
}

// --- right-click context menu ---
// Same lifecycle as TreeRow's context menu: capture coords, render via
// Teleport to <body> so it escapes the tab strip's overflow, dismiss
// on outside click / Escape, leave the tab strip's own key handling
// alone. The path of the right-clicked tab is held in `menuTabPath`;
// the four actions are computed off it + `props.tabs` so each menu
// open sees a fresh snapshot.
const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuTabPath = ref<string | null>(null)

const menuTabIndex = computed<number>(() =>
  menuTabPath.value ? props.tabs.findIndex((t) => t.path === menuTabPath.value) : -1,
)

const othersPaths = computed<string[]>(() => {
  if (!menuTabPath.value) return []
  return props.tabs.filter((t) => t.path !== menuTabPath.value).map((t) => t.path)
})
const rightPaths = computed<string[]>(() => {
  const i = menuTabIndex.value
  if (i < 0) return []
  return props.tabs.slice(i + 1).map((t) => t.path)
})
const allPaths = computed<string[]>(() => props.tabs.map((t) => t.path))

// Item enable rules: a single tab can't close others / right / all in
// any meaningful sense, so disable those three. "Close to the Right"
// is also disabled when the right-clicked tab is the rightmost.
const canCloseOthers = computed(() => props.tabs.length > 1)
const canCloseRight = computed(() => rightPaths.value.length > 0)
const canCloseAll = computed(() => props.tabs.length > 1)

function openMenu(e: MouseEvent, path: string) {
  e.preventDefault()
  e.stopPropagation()
  menuTabPath.value = path
  menuX.value = e.clientX
  menuY.value = e.clientY
  menuVisible.value = true
  nextTick(() => {
    document.addEventListener('click', closeMenu, { once: true })
    document.addEventListener('keydown', onMenuEscape)
  })
}
function closeMenu() {
  menuVisible.value = false
  document.removeEventListener('keydown', onMenuEscape)
}
function onMenuEscape(e: KeyboardEvent) {
  if (e.key === 'Escape') closeMenu()
}

function actionClose() {
  if (!menuTabPath.value) return
  emit('close', menuTabPath.value)
  closeMenu()
}
function actionCloseMany(paths: string[]) {
  if (paths.length === 0) return
  emit('close-many', paths)
  closeMenu()
}
</script>

<template>
  <div class="tabs" role="tablist">
    <div
      v-for="t in tabs"
      :key="t.path"
      role="tab"
      :aria-selected="t.path === activePath"
      :title="`${t.title || t.path}\n${t.path}\n中键 / 右键 关闭\n右键菜单 · 多关`"
      class="tab"
      :class="{ active: t.path === activePath }"
      @click="emit('select', t.path)"
      @auxclick.middle="emit('close', t.path)"
      @contextmenu="openMenu($event, t.path)"
    >
      <span class="tab-dot" :class="{ dirty: t.saveStatus === 'dirty' }" />
      <!-- Tab label is the filename (no .md), period. The frontmatter
           title still lives on Tab.title and surfaces in the hover
           tooltip (line above), but tabs are a navigation surface —
           they should anchor on the stable identifier (filename),
           not the variable display field (title), or some notes
           show one and some show the other. -->
      <span class="tab-title">{{ stripMd(basename(t.path)) }}</span>
      <button
        class="tab-close"
        title="关闭"
        @click.stop="emit('close', t.path)"
      >×</button>
    </div>
    <Teleport to="body">
      <div
        v-if="menuVisible"
        class="tab-context-menu"
        :style="{ left: menuX + 'px', top: menuY + 'px' }"
        @click.stop
      >
        <button @click="actionClose">关闭</button>
        <button :disabled="!canCloseOthers" @click="actionCloseMany(othersPaths)">关闭其它</button>
        <button :disabled="!canCloseRight" @click="actionCloseMany(rightPaths)">关闭右侧</button>
        <button :disabled="!canCloseAll" @click="actionCloseMany(allPaths)">关闭所有</button>
      </div>
    </Teleport>
  </div>
</template>
