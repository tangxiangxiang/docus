<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'
import type { WorkspaceTab } from './tabs'
import {
  deriveTabUiPresentation,
  type TabUiPresentation,
} from '../../composables/vault/editor-tabs/tabPresentation'
import { useWorkspaceTabTooltip } from '../../composables/vault/workspace-tabs/useWorkspaceTabTooltip'
import {
  moveWorkspaceTab,
  type WorkspaceTabDropPosition,
} from './workspaceTabOrder'

export interface WorkspaceTabReorderRequest {
  orderedIds: string[]
  movedId: string
  input: 'pointer' | 'keyboard'
}

const props = defineProps<{ tabs: WorkspaceTab[]; activePath: string | null }>()
const emit = defineEmits<{
  select: [path: string]
  close: [path: string]
  'close-many': [paths: string[]]
  'copy-path': [path: string]
  'reveal-in-tree': [path: string]
  reorder: [request: WorkspaceTabReorderRequest]
}>()
const { t: translate } = useI18n()

// One presentation per tab — the source of truth for title, status
// text, status kind, and aria-label. The same object feeds the tab
// row, the custom tooltip, and aria-label, so they cannot drift.
const tabPresentations = computed<TabUiPresentation[]>(() =>
  props.tabs.map((tab) => deriveTabUiPresentation(tab, translate)),
)

const tabsRef = ref<HTMLElement | null>(null)

function focusTab(id: string): void {
  const target = [...(tabsRef.value?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])]
    .find((tab) => tab.dataset.tabId === id)
  target?.focus()
}

defineExpose({ focusTab })

// --- custom tooltip --------------------------------------------------------
const activePathRef = computed(() => props.activePath)
const tabIds = computed(() => props.tabs.map((t) => t.id))
const {
  tooltipTabId,
  tooltipStyle,
  tooltipId,
  show: showTooltipFor,
  hide: hideTooltip,
  handleEscape: handleTooltipEscape,
} = useWorkspaceTabTooltip({
  activeId: activePathRef,
  tabIds,
  isSuppressed: () => draggedId.value !== null,
})

// Active tooltip presentation — single computed so the template
// doesn't have to re-find the tab row every render.
const tooltipPresentation = computed<TabUiPresentation | null>(() => {
  if (tooltipTabId.value === null) return null
  const idx = props.tabs.findIndex((t) => t.id === tooltipTabId.value)
  if (idx < 0) return null
  return tabPresentations.value[idx] ?? null
})

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
  handleTooltipEscape(event)
  if (
    event.altKey
    && event.shiftKey
    && !event.ctrlKey
    && !event.metaKey
    && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
  ) {
    event.preventDefault()
    event.stopPropagation()
    if (menuVisible.value) return
    moveTabByKeyboard(tab, event.key === 'ArrowLeft' ? -1 : 1)
    return
  }
  if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
    event.preventDefault()
    event.stopPropagation()
    const anchor = event.currentTarget as HTMLElement
    const rect = anchor.getBoundingClientRect()
    openMenu(tab.id, rect.left, rect.bottom, anchor)
  }
}

// --- tab close button click → hide tooltip before emission ---
function onCloseClick(tab: WorkspaceTab) {
  clearBlockedDrag()
  hideTooltip()
  emit('close', tab.id)
}

// --- workspace tab reordering ---------------------------------------------
const WORKSPACE_TAB_MIME = 'application/x-docus-workspace-tab'
const draggedId = ref<string | null>(null)
const dropTargetId = ref<string | null>(null)
const dropPosition = ref<WorkspaceTabDropPosition | null>(null)
const liveAnnouncement = ref('')
let dragSignature = ''
let suppressClick = false
let suppressClickTimer: ReturnType<typeof setTimeout> | null = null
let autoScrollFrame: number | null = null
let autoScrollDirection: -1 | 0 | 1 = 0
let blockedDragTabId: string | null = null

function clearBlockedDrag(): void {
  blockedDragTabId = null
  window.removeEventListener('pointerup', clearBlockedDrag)
  window.removeEventListener('pointercancel', clearBlockedDrag)
}

function onClosePointerDown(tabId: string, event: PointerEvent): void {
  event.stopPropagation()
  clearBlockedDrag()
  blockedDragTabId = tabId
  window.addEventListener('pointerup', clearBlockedDrag)
  window.addEventListener('pointercancel', clearBlockedDrag)
}

function idsSignature(): string {
  return tabIds.value.join('\u0000')
}

function hasWorkspacePayload(
  dataTransfer: DataTransfer | null,
  validateValue = false,
): boolean {
  if (!dataTransfer || !draggedId.value) return false
  if (!Array.from(dataTransfer.types).includes(WORKSPACE_TAB_MIME)) return false
  return !validateValue || dataTransfer.getData(WORKSPACE_TAB_MIME) === draggedId.value
}

function clearSuppressClickSoon(): void {
  if (suppressClickTimer) clearTimeout(suppressClickTimer)
  suppressClick = true
  suppressClickTimer = setTimeout(() => {
    suppressClick = false
    suppressClickTimer = null
  }, 0)
}

function stopAutoScroll(): void {
  autoScrollDirection = 0
  if (autoScrollFrame !== null) cancelAnimationFrame(autoScrollFrame)
  autoScrollFrame = null
}

function autoScrollStep(): void {
  autoScrollFrame = null
  const container = tabsRef.value
  if (!container || autoScrollDirection === 0 || !draggedId.value) return
  const previous = container.scrollLeft
  container.scrollLeft += autoScrollDirection * 8
  if (container.scrollLeft === previous) {
    autoScrollDirection = 0
    return
  }
  autoScrollFrame = requestAnimationFrame(autoScrollStep)
}

function updateAutoScroll(event: DragEvent): void {
  const container = tabsRef.value
  if (!container || !hasWorkspacePayload(event.dataTransfer)) {
    stopAutoScroll()
    return
  }
  const rect = container.getBoundingClientRect()
  const edge = Math.min(32, rect.width / 3)
  const direction = event.clientX <= rect.left + edge
    ? -1
    : event.clientX >= rect.right - edge ? 1 : 0
  if (direction === autoScrollDirection) return
  stopAutoScroll()
  autoScrollDirection = direction
  if (direction !== 0) autoScrollFrame = requestAnimationFrame(autoScrollStep)
}

function clearDragState(suppressSyntheticClick = false): void {
  if (suppressSyntheticClick && draggedId.value) clearSuppressClickSoon()
  draggedId.value = null
  dragSignature = ''
  dropTargetId.value = null
  dropPosition.value = null
  stopAutoScroll()
}

function onDragStart(event: DragEvent, tab: WorkspaceTab): void {
  if (
    !event.dataTransfer
    || blockedDragTabId === tab.id
    || (event.target instanceof Element && event.target.closest('.tab-close'))
  ) {
    event.preventDefault()
    clearBlockedDrag()
    return
  }
  clearBlockedDrag()
  closeMenu(false)
  hideTooltip()
  draggedId.value = tab.id
  dragSignature = idsSignature()
  dropTargetId.value = null
  dropPosition.value = null
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(WORKSPACE_TAB_MIME, tab.id)
}

function onDragOver(event: DragEvent, targetId: string): void {
  if (
    !hasWorkspacePayload(event.dataTransfer)
    || dragSignature !== idsSignature()
    || !tabIds.value.includes(targetId)
  ) {
    clearDragState()
    return
  }
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  dropTargetId.value = targetId
  dropPosition.value = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
  updateAutoScroll(event)
}

function onTabsDragOver(event: DragEvent): void {
  if (event.target === tabsRef.value) updateAutoScroll(event)
}

function onTabsDragLeave(event: DragEvent): void {
  const next = event.relatedTarget
  if (!(next instanceof Node) || !tabsRef.value?.contains(next)) stopAutoScroll()
}

function onDrop(event: DragEvent, targetId: string): void {
  const sourceId = draggedId.value
  const position = dropPosition.value
  const valid = Boolean(
    sourceId
    && position
    && dropTargetId.value === targetId
    && dragSignature === idsSignature()
    && hasWorkspacePayload(event.dataTransfer, true)
    && tabIds.value.includes(sourceId)
    && tabIds.value.includes(targetId),
  )
  if (valid) {
    event.preventDefault()
    const orderedIds = moveWorkspaceTab(tabIds.value, sourceId!, targetId, position!)
    if (orderedIds.some((id, index) => id !== tabIds.value[index])) {
      emit('reorder', { orderedIds, movedId: sourceId!, input: 'pointer' })
    }
  }
  clearDragState(true)
}

function onDragEnd(): void {
  clearBlockedDrag()
  clearDragState(true)
}

function onTabClick(tab: WorkspaceTab): void {
  hideTooltip()
  if (suppressClick) return
  emit('select', tab.id)
}

function moveTabByKeyboard(tab: WorkspaceTab, direction: -1 | 1): void {
  hideTooltip()
  const index = tabIds.value.indexOf(tab.id)
  const targetIndex = index + direction
  const target = props.tabs[targetIndex]
  if (index < 0 || !target) return
  const displayTitle = tabPresentations.value[index]?.displayTitle ?? tab.title
  const orderedIds = moveWorkspaceTab(
    tabIds.value,
    tab.id,
    target.id,
    direction < 0 ? 'before' : 'after',
  )
  emit('reorder', { orderedIds, movedId: tab.id, input: 'keyboard' })
  liveAnnouncement.value = ''
  void nextTick(() => {
    liveAnnouncement.value = translate('workspace_tab.moved_announcement', {
      title: displayTitle,
      position: targetIndex + 1,
      count: props.tabs.length,
    })
  })
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
let menuGeneration = 0

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
  const generation = ++menuGeneration
  removeMenuListeners()
  hideTooltip()
  menuTabPath.value = path
  menuSource = source
  menuOpeningSignature = tabIds.value.join('\u0000')
  menuX.value = x
  menuY.value = y
  menuVisible.value = true
  void nextTick(() => {
    if (
      generation !== menuGeneration
      || !menuVisible.value
      || !menuRef.value
    ) return
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
  window.addEventListener('scroll', onMenuScroll, true)
}
function removeMenuListeners() {
  document.removeEventListener('pointerdown', onOutsidePointerDown, true)
  document.removeEventListener('keydown', onMenuKeydown)
  window.removeEventListener('resize', closeMenuWithoutFocus)
  window.removeEventListener('scroll', onMenuScroll, true)
}
function closeMenu(restoreFocus = false) {
  menuGeneration++
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
function onMenuScroll(event: Event) {
  const target = event.target
  if (
    menuRef.value
    && target instanceof Node
    && (target === menuRef.value || menuRef.value.contains(target))
  ) return
  closeMenuWithoutFocus()
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

async function prepareMenuAction(): Promise<void> {
  const source = menuSource
  closeMenu(false)
  await nextTick()
  if (source?.isConnected) source.focus()
}

async function actionClose() {
  if (!menuTabPath.value) return
  const path = menuTabPath.value
  await prepareMenuAction()
  emit('close', path)
}
async function actionCloseMany(paths: string[]) {
  if (paths.length === 0) return
  const targets = [...paths]
  await prepareMenuAction()
  emit('close-many', targets)
}
async function actionCopyPath() {
  const path = menuDocumentPath.value
  if (!path) return
  await prepareMenuAction()
  emit('copy-path', path)
}
async function actionRevealInTree() {
  const path = menuDocumentPath.value
  if (!path) return
  await prepareMenuAction()
  emit('reveal-in-tree', path)
}

onBeforeUnmount(() => {
  closeMenu(false)
  clearDragState()
  clearBlockedDrag()
  suppressClick = false
  if (suppressClickTimer) clearTimeout(suppressClickTimer)
  suppressClickTimer = null
})

watch(activePathRef, () => {
  if (menuVisible.value) closeMenu(false)
})
watch(tabIds, (next) => {
  if (menuVisible.value && next.join('\u0000') !== menuOpeningSignature) closeMenu(false)
  if (draggedId.value && next.join('\u0000') !== dragSignature) clearDragState()
})
</script>

<template>
  <div
    ref="tabsRef"
    class="tabs"
    role="tablist"
    @dragover="onTabsDragOver"
    @dragleave="onTabsDragLeave"
    @drop.self="clearDragState(true)"
  >
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
      :aria-roledescription="translate('workspace_tab.draggable')"
      draggable="true"
      class="tab"
      :class="{
        active: t.id === activePath,
        history: t.kind === 'history',
        diff: t.kind === 'diff',
        'save-in-flight': t.kind === 'document' && t.save.inFlight,
        'save-attention': t.kind === 'document' && t.save.attention,
        dragging: draggedId === t.id,
        'drop-before': dropTargetId === t.id && dropPosition === 'before',
        'drop-after': dropTargetId === t.id && dropPosition === 'after',
      }"
      @click="onTabClick(t)"
      @auxclick.middle="() => { hideTooltip(); emit('close', t.id) }"
      @contextmenu="onContextMenu($event, t.id)"
      @mouseenter="onTooltipAnchorEnter(t, $event)"
      @mouseleave="onTooltipAnchorLeave(t, $event)"
      @focusin="onTooltipAnchorFocus(t, $event)"
      @focusout="onTooltipAnchorBlur($event)"
      @keydown="onTabKeydown($event, t)"
      @dragstart="onDragStart($event, t)"
      @dragover="onDragOver($event, t.id)"
      @drop.stop="onDrop($event, t.id)"
      @dragend="onDragEnd"
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
        draggable="false"
        :aria-label="translate('workspace_tab.close_named', { name: tabPresentations[i].displayTitle })"
        @pointerdown="onClosePointerDown(t.id, $event)"
        @dragstart.prevent.stop
        @click.stop="onCloseClick(t)"
      >×</button>
    </div>
    <span class="sr-only" aria-live="polite" aria-atomic="true">{{ liveAnnouncement }}</span>
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
