<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { WorkspaceTab } from './tabs'

const props = defineProps<{ tabs: WorkspaceTab[]; activePath: string | null }>()
const emit = defineEmits<{
  select: [path: string]
  close: [path: string]
  'close-many': [paths: string[]]
}>()

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
  menuTabPath.value ? props.tabs.findIndex((t) => t.id === menuTabPath.value) : -1,
)

const othersPaths = computed<string[]>(() => {
  if (!menuTabPath.value) return []
  return props.tabs.filter((t) => t.id !== menuTabPath.value).map((t) => t.id)
})
const rightPaths = computed<string[]>(() => {
  const i = menuTabIndex.value
  if (i < 0) return []
  return props.tabs.slice(i + 1).map((t) => t.id)
})
const allPaths = computed<string[]>(() => props.tabs.map((t) => t.id))

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
      :key="t.id"
      role="tab"
      :aria-selected="t.id === activePath"
      :title="`${t.title}\n中键 / 右键 关闭\n右键菜单 · 多关`"
      class="tab"
      :class="{ active: t.id === activePath, history: t.kind === 'history' }"
      @click="emit('select', t.id)"
      @auxclick.middle="emit('close', t.id)"
      @contextmenu="openMenu($event, t.id)"
    >
      <span class="tab-dot" :class="{ dirty: t.dirty }" />
      <span class="tab-title">{{ t.label }}</span>
      <button
        class="tab-close"
        title="关闭"
        @click.stop="emit('close', t.id)"
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
