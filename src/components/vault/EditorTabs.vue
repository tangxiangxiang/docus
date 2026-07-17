<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from '../../composables/useI18n'
import type { WorkspaceTab } from './tabs'

const props = defineProps<{ tabs: WorkspaceTab[]; activePath: string | null }>()
const emit = defineEmits<{
  select: [path: string]
  close: [path: string]
  'close-many': [paths: string[]]
}>()
const { t: translate } = useI18n()
const tabsRef = ref<HTMLElement | null>(null)

function saveStatusLabel(tab: WorkspaceTab): string | null {
  if (tab.kind !== 'document') return null
  switch (tab.save.status) {
    case 'dirty': return translate('status.unsaved')
    case 'saving': return translate('status.saving')
    case 'saving-dirty': return translate('status.saving_dirty')
    case 'saved': return translate('status.saved')
    case 'error': return translate('status.error')
    case 'offline': return translate('status.offline')
    case 'external': return translate('status.external')
    default: return translate('status.idle')
  }
}

function tabAccessibleLabel(tab: WorkspaceTab): string {
  return [tab.title, saveStatusLabel(tab)].filter(Boolean).join('\n')
}

function focusTab(id: string): void {
  const target = [...(tabsRef.value?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])]
    .find((tab) => tab.dataset.tabId === id)
  target?.focus()
}

defineExpose({ focusTab })

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
onBeforeUnmount(closeMenu)
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
  <div ref="tabsRef" class="tabs" role="tablist">
    <div
      v-for="t in tabs"
      :key="t.id"
      role="tab"
      :data-tab-id="t.id"
      :data-save-status="t.kind === 'document' ? t.save.status : undefined"
      :tabindex="t.id === activePath ? 0 : -1"
      :aria-selected="t.id === activePath"
      :title="`${tabAccessibleLabel(t)}\n${translate('workspace_tab.close_hint')}`"
      :aria-label="tabAccessibleLabel(t)"
      class="tab"
      :class="{
        active: t.id === activePath,
        history: t.kind === 'history',
        diff: t.kind === 'diff',
        'save-in-flight': t.kind === 'document' && t.save.inFlight,
        'save-attention': t.kind === 'document' && t.save.attention,
      }"
      @click="emit('select', t.id)"
      @auxclick.middle="emit('close', t.id)"
      @contextmenu="openMenu($event, t.id)"
    >
      <span
        class="tab-dot"
        :class="{
          dirty: t.kind === 'document' && t.save.dirty,
          'in-flight': t.kind === 'document' && t.save.inFlight,
          'newer-changes': t.kind === 'document' && t.save.hasNewerChanges,
        }"
        aria-hidden="true"
      />
      <span class="tab-title">{{ t.label }}</span>
      <button
        class="tab-close"
        :title="translate('workspace_tab.close')"
        :aria-label="translate('workspace_tab.close_named', { name: t.label })"
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
        <button @click="actionClose">{{ translate('workspace_tab.close') }}</button>
        <button :disabled="!canCloseOthers" @click="actionCloseMany(othersPaths)">{{ translate('workspace_tab.close_others') }}</button>
        <button :disabled="!canCloseRight" @click="actionCloseMany(rightPaths)">{{ translate('workspace_tab.close_right') }}</button>
        <button :disabled="!canCloseAll" @click="actionCloseMany(allPaths)">{{ translate('workspace_tab.close_all') }}</button>
      </div>
    </Teleport>
  </div>
</template>
