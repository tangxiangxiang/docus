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
  'copy-path': [path: string]
  'reveal-in-tree': [path: string]
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
  // First-pass clamp using the planned width. This gets the tooltip
  // close enough that the post-render `getBoundingClientRect` check
  // below doesn't have to move it far.
  const plannedWidth = Math.min(tooltipMaxWidth, window.innerWidth - 16)
  let left = rect.left
  if (left + plannedWidth > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - 8 - plannedWidth)
  }
  tooltipStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(preferredTop)}px`,
    maxWidth: `${tooltipMaxWidth}px`,
  }
  // Second-pass clamp: after the tooltip has rendered, read its
  // actual outer width via getBoundingClientRect (which includes
  // padding + border) and re-clamp. Without this, a long path line
  // that wraps to multiple lines or a status row with extra glyphs
  // can overflow the right edge by up to (padding + border) px even
  // though the inline maxWidth looks fine.
  nextTick(() => {
    if (tooltipTabId.value === null) return
    const el = document.getElementById(tooltipId(tooltipTabId.value))
    if (!el) return
    const actual = el.getBoundingClientRect()
    const currentLeft = parseInt(tooltipStyle.value.left ?? '0', 10)
    if (currentLeft + actual.width > window.innerWidth - 8) {
      const nextLeft = Math.max(8, Math.round(window.innerWidth - 8 - actual.width))
      tooltipStyle.value = { ...tooltipStyle.value, left: `${nextLeft}px` }
    } else if (currentLeft < 8) {
      tooltipStyle.value = { ...tooltipStyle.value, left: '8px' }
    }
  })
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

function onTabKeydown(event: KeyboardEvent, tab: WorkspaceTab) {
  if (event.key === 'Escape') hideTooltip()
  if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
    event.preventDefault()
    event.stopPropagation()
    const anchor = event.currentTarget as HTMLElement
    const rect = anchor.getBoundingClientRect()
    openMenu(tab.id, rect.left, rect.bottom, anchor)
  }
}

// Hide the tooltip when the active tab switches — the new active tab
// takes the focus anyway and the old tooltip is no longer relevant.
const activePathRef = computed(() => props.activePath)

// Hide the tooltip when its owning tab disappears from the props.
// Without this watcher, tooltipTabId would still reference the
// removed tab; a later re-mount of the same id would find the tab
// in the (new) list and immediately re-show the tooltip without any
// user hover or focus.
const tabIds = computed(() => props.tabs.map((t) => t.id))
watch(tabIds, (next) => {
  if (tooltipTabId.value && !next.includes(tooltipTabId.value)) {
    hideTooltip()
  }
})

// --- tab close button click → hide tooltip before emission ---
function onCloseClick(tab: WorkspaceTab) {
  hideTooltip()
  emit('close', tab.id)
}

// --- right-click / keyboard context menu ---
const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuTabPath = ref<string | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const menuItemRefs = ref<HTMLElement[]>([])
const activeMenuItem = ref(0)
let menuSource: HTMLElement | null = null
let menuOpeningSignature = ''

const menuTabIndex = computed<number>(() =>
  menuTabPath.value ? props.tabs.findIndex((t) => t.id === menuTabPath.value) : -1,
)
const menuTab = computed(() => props.tabs[menuTabIndex.value] ?? null)

const othersPaths = computed<string[]>(() => {
  if (!menuTabPath.value) return []
  return props.tabs.filter((t) => t.id !== menuTabPath.value).map((t) => t.id)
})
const rightPaths = computed<string[]>(() => {
  const i = menuTabIndex.value
  if (i < 0) return []
  return props.tabs.slice(i + 1).map((t) => t.id)
})
const leftPaths = computed<string[]>(() => {
  const i = menuTabIndex.value
  if (i < 0) return []
  return props.tabs.slice(0, i).map((t) => t.id)
})
const allPaths = computed<string[]>(() => props.tabs.map((t) => t.id))
const menuDocumentPath = computed<string | null>(() => {
  const tab = menuTab.value
  if (!tab) return null
  return tab.documentPath ?? (tab.kind === 'document' ? tab.id : null)
})

const canCloseOthers = computed(() => props.tabs.length > 1)
const canCloseLeft = computed(() => leftPaths.value.length > 0)
const canCloseRight = computed(() => rightPaths.value.length > 0)
const menuItems = computed(() => [
  { action: actionClose, disabled: false },
  { action: () => actionCloseMany(othersPaths.value), disabled: !canCloseOthers.value },
  { action: () => actionCloseMany(leftPaths.value), disabled: !canCloseLeft.value },
  { action: () => actionCloseMany(rightPaths.value), disabled: !canCloseRight.value },
  { action: () => actionCloseMany(allPaths.value), disabled: false },
  { action: actionCopyPath, disabled: !menuDocumentPath.value },
  { action: actionRevealInTree, disabled: !menuDocumentPath.value },
])

function onContextMenu(e: MouseEvent, path: string) {
  e.preventDefault()
  e.stopPropagation()
  openMenu(path, e.clientX, e.clientY, e.currentTarget as HTMLElement)
}

function openMenu(path: string, x: number, y: number, source: HTMLElement) {
  removeMenuListeners()
  hideTooltip()
  menuTabPath.value = path
  menuSource = source
  menuOpeningSignature = tabIds.value.join('\u0000')
  menuX.value = x
  menuY.value = y
  menuVisible.value = true
  void nextTick(() => {
    positionMenu()
    activeMenuItem.value = firstEnabledItem()
    focusActiveMenuItem()
    addMenuListeners()
  })
}

function positionMenu() {
  const el = menuRef.value
  if (!el) return
  const margin = 8
  const rect = el.getBoundingClientRect()
  menuX.value = Math.max(margin, Math.min(menuX.value, window.innerWidth - margin - rect.width))
  menuY.value = Math.max(margin, Math.min(menuY.value, window.innerHeight - margin - rect.height))
}

function addMenuListeners() {
  document.addEventListener('pointerdown', onOutsidePointerDown, true)
  document.addEventListener('keydown', onMenuKeydown)
  window.addEventListener('resize', closeMenuWithoutFocus)
  window.addEventListener('scroll', closeMenuWithoutFocus, true)
}
function removeMenuListeners() {
  document.removeEventListener('pointerdown', onOutsidePointerDown, true)
  document.removeEventListener('keydown', onMenuKeydown)
  window.removeEventListener('resize', closeMenuWithoutFocus)
  window.removeEventListener('scroll', closeMenuWithoutFocus, true)
}
function closeMenu(restoreFocus = false) {
  const source = menuSource
  menuVisible.value = false
  menuTabPath.value = null
  menuItemRefs.value = []
  removeMenuListeners()
  if (restoreFocus) void nextTick(() => source?.isConnected && source.focus())
}
function closeMenuWithoutFocus() {
  closeMenu(false)
}
function onOutsidePointerDown(event: PointerEvent) {
  if (!menuRef.value?.contains(event.target as Node)) closeMenu(false)
}
function firstEnabledItem() {
  return menuItems.value.findIndex((item) => !item.disabled)
}
function lastEnabledItem() {
  for (let i = menuItems.value.length - 1; i >= 0; i--) {
    if (!menuItems.value[i].disabled) return i
  }
  return 0
}
function moveMenuFocus(direction: 1 | -1) {
  let next = activeMenuItem.value
  do next = (next + direction + menuItems.value.length) % menuItems.value.length
  while (menuItems.value[next].disabled)
  activeMenuItem.value = next
  focusActiveMenuItem()
}
function focusActiveMenuItem() {
  menuItemRefs.value[activeMenuItem.value]?.focus()
}
function setMenuItemRef(el: unknown, index: number) {
  if (el instanceof HTMLElement) menuItemRefs.value[index] = el
}
function onMenuKeydown(event: KeyboardEvent) {
  if (!menuVisible.value) return
  if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault()
    closeMenu(true)
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    moveMenuFocus(event.key === 'ArrowDown' ? 1 : -1)
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    activeMenuItem.value = event.key === 'Home' ? firstEnabledItem() : lastEnabledItem()
    focusActiveMenuItem()
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    const item = menuItems.value[activeMenuItem.value]
    if (item && !item.disabled) item.action()
  }
}

function actionClose() {
  if (!menuTabPath.value) return
  const path = menuTabPath.value
  closeMenu(true)
  emit('close', path)
}
function actionCloseMany(paths: string[]) {
  if (paths.length === 0) return
  const targets = [...paths]
  closeMenu(true)
  emit('close-many', targets)
}
function actionCopyPath() {
  const path = menuDocumentPath.value
  if (!path) return
  closeMenu(true)
  emit('copy-path', path)
}
function actionRevealInTree() {
  const path = menuDocumentPath.value
  if (!path) return
  closeMenu(true)
  emit('reveal-in-tree', path)
}

onBeforeUnmount(() => {
  closeMenu(false)
  hideTooltip()
})

// `activePath` is part of the reactive system; we read it through a
// computed and re-run hideTooltip whenever it changes. Implementing
// the watcher here keeps the tooltip-lifecycle logic colocated with
// the tooltip state itself.
watch(activePathRef, () => {
  hideTooltip()
  if (menuVisible.value) closeMenu(false)
})
watch(tabIds, (next) => {
  if (menuVisible.value && next.join('\u0000') !== menuOpeningSignature) closeMenu(false)
})
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
      aria-haspopup="menu"
      :aria-expanded="menuVisible && menuTabPath === t.id ? 'true' : 'false'"
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
      @contextmenu="onContextMenu($event, t.id)"
      @mouseenter="onTooltipAnchorEnter(t, $event)"
      @mouseleave="onTooltipAnchorLeave(t, $event)"
      @focusin="onTooltipAnchorFocus(t, $event)"
      @focusout="onTooltipAnchorBlur($event)"
      @keydown="onTabKeydown($event, t)"
    >
      <!-- Dirty marker: independent of the save-status indicator so a
           dirty buffer is still visible when error / offline / external
           colours are painted. Shape (filled dot) is constant; color
           comes from the .tab-dirty-indicator rule. -->
      <span
        v-if="t.kind === 'document' && t.save.dirty"
        class="tab-dirty-indicator"
        :data-newer-changes="t.save.hasNewerChanges ? 'true' : undefined"
        aria-hidden="true"
      />
      <!-- Save-status indicator: distinct per status kind so users
           can tell saving / error / offline / external apart by shape,
           not just by color. Skipped for 'none' and 'dirty' (dirty is
           already covered by the dirty marker above). -->
      <span
        v-if="tabPresentations[i].statusKind !== 'none' && tabPresentations[i].statusKind !== 'dirty'"
        class="tab-status-indicator"
        :data-kind="tabPresentations[i].statusKind"
        aria-hidden="true"
      />
      <span class="tab-title">{{ tabPresentations[i].displayTitle }}</span>
      <button
        class="tab-close"
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
          v-if="tooltipPresentation.filenameLabel"
          class="tab-tooltip-filename"
        ><span class="tab-tooltip-label">{{ translate('workspace_tab.tooltip_filename') }}</span>{{ tooltipPresentation.filenameLabel }}</span>
        <span
          v-if="tooltipPresentation.fullPath"
          class="tab-tooltip-path"
        ><span class="tab-tooltip-label">{{ translate('workspace_tab.tooltip_path') }}</span>{{ tooltipPresentation.fullPath }}</span>
        <span
          v-if="tooltipPresentation.statusText"
          class="tab-tooltip-status"
          :data-status-kind="tooltipPresentation.statusKind"
        ><span class="tab-tooltip-label">{{ translate('workspace_tab.tooltip_status') }}</span>{{ tooltipPresentation.statusText }}</span>
        <span class="tab-tooltip-hint">{{ translate('workspace_tab.close_hint') }}</span>
      </div>
    </Teleport>
    <Teleport to="body">
      <div
        v-if="menuVisible"
        ref="menuRef"
        class="tab-context-menu"
        :style="{ left: menuX + 'px', top: menuY + 'px' }"
        role="menu"
        @click.stop
      >
        <button :ref="(el) => setMenuItemRef(el, 0)" role="menuitem" :tabindex="activeMenuItem === 0 ? 0 : -1" @mouseenter="activeMenuItem = 0" @click="actionClose">{{ translate('workspace_tab.close') }}</button>
        <button :ref="(el) => setMenuItemRef(el, 1)" role="menuitem" :tabindex="activeMenuItem === 1 ? 0 : -1" :disabled="!canCloseOthers" @mouseenter="!canCloseOthers || (activeMenuItem = 1)" @click="actionCloseMany(othersPaths)">{{ translate('workspace_tab.close_others') }}</button>
        <button :ref="(el) => setMenuItemRef(el, 2)" role="menuitem" :tabindex="activeMenuItem === 2 ? 0 : -1" :disabled="!canCloseLeft" @mouseenter="!canCloseLeft || (activeMenuItem = 2)" @click="actionCloseMany(leftPaths)">{{ translate('workspace_tab.close_left') }}</button>
        <button :ref="(el) => setMenuItemRef(el, 3)" role="menuitem" :tabindex="activeMenuItem === 3 ? 0 : -1" :disabled="!canCloseRight" @mouseenter="!canCloseRight || (activeMenuItem = 3)" @click="actionCloseMany(rightPaths)">{{ translate('workspace_tab.close_right') }}</button>
        <button :ref="(el) => setMenuItemRef(el, 4)" role="menuitem" :tabindex="activeMenuItem === 4 ? 0 : -1" @mouseenter="activeMenuItem = 4" @click="actionCloseMany(allPaths)">{{ translate('workspace_tab.close_all') }}</button>
        <div role="separator" />
        <button :ref="(el) => setMenuItemRef(el, 5)" role="menuitem" :tabindex="activeMenuItem === 5 ? 0 : -1" :disabled="!menuDocumentPath" @mouseenter="!menuDocumentPath || (activeMenuItem = 5)" @click="actionCopyPath">{{ translate('workspace_tab.copy_path') }}</button>
        <button :ref="(el) => setMenuItemRef(el, 6)" role="menuitem" :tabindex="activeMenuItem === 6 ? 0 : -1" :disabled="!menuDocumentPath" @mouseenter="!menuDocumentPath || (activeMenuItem = 6)" @click="actionRevealInTree">{{ translate('workspace_tab.reveal_in_tree') }}</button>
      </div>
    </Teleport>
  </div>
</template>
