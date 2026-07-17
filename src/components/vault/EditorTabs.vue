<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'
import type { WorkspaceTab } from './tabs'
import {
  deriveTabUiPresentation,
  type TabUiPresentation,
} from '../../composables/vault/editor-tabs/tabPresentation'

const props = defineProps<{ tabs: WorkspaceTab[]; activePath: string | null }>()
const emit = defineEmits<{
  select: [path: string]
  close: [path: string]
  'close-many': [paths: string[]]
}>()
const { t: translate } = useI18n()

// One presentation per tab — the source of truth for title, status
// text, status kind, and aria-label. The same object feeds the tab
// row, the custom tooltip, and aria-label, so they cannot drift.
const tabPresentations = computed<TabUiPresentation[]>(() =>
  props.tabs.map((tab) => deriveTabUiPresentation(tab, translate)),
)

// Active tooltip presentation — single computed so the template
// doesn't have to re-find the tab row every render.
const tooltipPresentation = computed<TabUiPresentation | null>(() => {
  if (tooltipTabId.value === null) return null
  const idx = props.tabs.findIndex((t) => t.id === tooltipTabId.value)
  if (idx < 0) return null
  return tabPresentations.value[idx] ?? null
})

const tabsRef = ref<HTMLElement | null>(null)

// Stable id base for tooltips — appended with the active path so
// aria-describedby stays unique even when multiple tabs are mounted.
const tooltipId = (path: string): string => `tab-tooltip-${path.replace(/[^a-zA-Z0-9_-]/g, '_')}`

function focusTab(id: string): void {
  const target = [...(tabsRef.value?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])]
    .find((tab) => tab.dataset.tabId === id)
  target?.focus()
}

defineExpose({ focusTab })

// --- custom tooltip --------------------------------------------------------
//
// One tooltip shown at a time across the whole tab strip. Lifecycle:
//   hover/focus IN  → show
//   mouseleave/blur → hide
//   contextmenu     → hide + open menu
//   click / middle-click on tab → hide
//   switching tabs  → hide
//   closing tab     → hide (parent removes the tab row entirely)
//   Escape          → hide
//   unmount         → hide
// Only the row the tooltip is for sets aria-describedby so screen
// readers don't keep an invisible "describedby" pointer after the
// tooltip is gone.
const tooltipTabId = ref<string | null>(null)
const tooltipStyle = ref<Record<string, string>>({})

function hideTooltip() {
  tooltipTabId.value = null
}

function showTooltipFor(tabId: string, anchor: HTMLElement) {
  tooltipTabId.value = tabId
  positionTooltip(anchor)
}

function positionTooltip(anchor: HTMLElement) {
  const rect = anchor.getBoundingClientRect()
  const margin = 8
  const preferredTop = rect.bottom + margin
  const tooltipMaxWidth = 360
  const tooltipWidth = Math.min(tooltipMaxWidth, window.innerWidth - 16)
  let left = rect.left
  // Keep the tooltip within the viewport horizontally.
  if (left + tooltipWidth > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - 8 - tooltipWidth)
  }
  const style: Record<string, string> = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(preferredTop)}px`,
    maxWidth: `${tooltipMaxWidth}px`,
  }
  tooltipStyle.value = style
}

function onTooltipAnchorEnter(tab: WorkspaceTab, event: MouseEvent | FocusEvent) {
  const target = event.currentTarget as HTMLElement | null
  if (target) showTooltipFor(tab.id, target)
}

function onTooltipAnchorLeave(_tab: WorkspaceTab, event: MouseEvent | FocusEvent) {
  // Only hide on real mouseleave; on focus we rely on the explicit
  // blur handler so keyboard users don't see the tooltip flicker.
  if (event.type === 'mouseleave') hideTooltip()
}

function onTooltipAnchorFocus(tab: WorkspaceTab, event: FocusEvent) {
  const target = event.currentTarget as HTMLElement | null
  if (target) showTooltipFor(tab.id, target)
}

function onTooltipAnchorBlur(_event: FocusEvent) {
  // relatedTarget === null on programmatic blur and when focus moves
  // outside the document — either way the tooltip should hide.
  hideTooltip()
}

function onTooltipKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') hideTooltip()
}

// Hide the tooltip when the active tab switches — the new active tab
// takes the focus anyway and the old tooltip is no longer relevant.
const activePathRef = computed(() => props.activePath)

// --- tab close button click → hide tooltip before emission ---
function onCloseClick(tab: WorkspaceTab) {
  hideTooltip()
  emit('close', tab.id)
}

// --- right-click context menu (unchanged behavior, now also hides tooltip) ---
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

const canCloseOthers = computed(() => props.tabs.length > 1)
const canCloseRight = computed(() => rightPaths.value.length > 0)
const canCloseAll = computed(() => props.tabs.length > 1)

function openMenu(e: MouseEvent, path: string) {
  e.preventDefault()
  e.stopPropagation()
  // The context menu is the canonical interaction — close any open
  // tooltip so the user doesn't see two overlapping affordances.
  hideTooltip()
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

onBeforeUnmount(hideTooltip)

// `activePath` is part of the reactive system; we read it through a
// computed and re-run hideTooltip whenever it changes. Implementing
// the watcher here keeps the tooltip-lifecycle logic colocated with
// the tooltip state itself.
watch(activePathRef, () => { hideTooltip() })
</script>

<template>
  <div ref="tabsRef" class="tabs" role="tablist">
    <div
      v-for="(t, i) in tabs"
      :key="t.id"
      role="tab"
      :data-tab-id="t.id"
      :data-save-status="t.kind === 'document' ? t.save.status : undefined"
      :data-status-kind="tabPresentations[i].statusKind"
      :tabindex="t.id === activePath ? 0 : -1"
      :aria-selected="t.id === activePath"
      :aria-label="tabPresentations[i].ariaLabel"
      :aria-describedby="tooltipTabId === t.id ? tooltipId(t.id) : undefined"
      class="tab"
      :class="{
        active: t.id === activePath,
        history: t.kind === 'history',
        diff: t.kind === 'diff',
        'save-in-flight': t.kind === 'document' && t.save.inFlight,
        'save-attention': t.kind === 'document' && t.save.attention,
      }"
      @click="() => { hideTooltip(); emit('select', t.id) }"
      @auxclick.middle="() => { hideTooltip(); emit('close', t.id) }"
      @contextmenu="openMenu($event, t.id)"
      @mouseenter="onTooltipAnchorEnter(t, $event)"
      @mouseleave="onTooltipAnchorLeave(t, $event)"
      @focusin="onTooltipAnchorFocus(t, $event)"
      @focusout="onTooltipAnchorBlur($event)"
      @keydown="onTooltipKeydown"
    >
      <span
        class="tab-dot"
        :class="{
          dirty: t.kind === 'document' && t.save.dirty,
          'in-flight': t.kind === 'document' && t.save.inFlight,
          'newer-changes': t.kind === 'document' && t.save.hasNewerChanges,
          error: tabPresentations[i].statusKind === 'error',
          offline: tabPresentations[i].statusKind === 'offline',
          external: tabPresentations[i].statusKind === 'external',
        }"
        aria-hidden="true"
      />
      <span class="tab-title">{{ tabPresentations[i].displayTitle }}</span>
      <button
        class="tab-close"
        :title="translate('workspace_tab.close')"
        :aria-label="translate('workspace_tab.close_named', { name: tabPresentations[i].displayTitle })"
        @click.stop="onCloseClick(t)"
      >×</button>
    </div>
    <Teleport to="body">
      <div
        v-if="tooltipPresentation"
        :id="tooltipTabId ? tooltipId(tooltipTabId) : undefined"
        class="tab-tooltip"
        role="tooltip"
        :style="tooltipStyle"
      >
        <span class="tab-tooltip-title">{{ tooltipPresentation.displayTitle }}</span>
        <span
          v-if="tooltipPresentation.fullPath && tooltipPresentation.fullPath !== tooltipPresentation.displayTitle"
          class="tab-tooltip-path"
        >{{ tooltipPresentation.fullPath }}</span>
        <span
          v-if="tooltipPresentation.statusText"
          class="tab-tooltip-status"
          :data-status-kind="tooltipPresentation.statusKind"
        >{{ tooltipPresentation.statusText }}</span>
        <span class="tab-tooltip-hint">{{ translate('workspace_tab.close_hint') }}</span>
      </div>
    </Teleport>
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