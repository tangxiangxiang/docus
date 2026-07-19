<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '../../composables/useI18n'
import type { WorkspaceTab } from './tabs'
import {
  deriveTabUiPresentation,
  type TabUiPresentation,
} from '../../composables/vault/editor-tabs/tabPresentation'
import { useWorkspaceTabTooltip } from '../../composables/vault/workspace-tabs/useWorkspaceTabTooltip'
import {
  useWorkspaceTabMenu,
  type WorkspaceTabMenuAction,
  type WorkspaceTabMenuIntent,
} from '../../composables/vault/workspace-tabs/useWorkspaceTabMenu'
import {
  useWorkspaceTabReorder,
  type WorkspaceTabReorderRequest,
} from '../../composables/vault/workspace-tabs/useWorkspaceTabReorder'

export type { WorkspaceTabReorderRequest }

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
const tabIds = computed(() => props.tabs.map((t) => t.id))

const {
  draggedId,
  dropTargetId,
  dropPosition,
  liveAnnouncement,
  blockCloseButtonDrag,
  clearBlockedDrag,
  consumeSuppressedClick,
  start: startReorder,
  over: updateDropTarget,
  overStrip: updateStripAutoScroll,
  leaveStrip: stopAutoScrollOutsideStrip,
  drop: dropReorder,
  end: endReorder,
  cancel: cancelReorder,
  moveByKeyboard,
} = useWorkspaceTabReorder({
  tabIds,
  container: tabsRef,
  displayTitle: (id) => {
    const index = tabIds.value.indexOf(id)
    return tabPresentations.value[index]?.displayTitle
      ?? props.tabs[index]?.title
      ?? id
  },
  announce: (title, position, count) => translate(
    'workspace_tab.moved_announcement',
    { title, position, count },
  ),
  onReorder: (request) => emit('reorder', request),
})

function focusTab(id: string): void {
  const target = [...(tabsRef.value?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])]
    .find((tab) => tab.dataset.tabId === id)
  target?.focus()
}

defineExpose({ focusTab })

// --- custom tooltip --------------------------------------------------------
const activePathRef = computed(() => props.activePath)
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
    hideTooltip()
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
function onClosePointerDown(tabId: string, event: PointerEvent): void {
  blockCloseButtonDrag(tabId, event)
}

function onDragStart(event: DragEvent, tab: WorkspaceTab): void {
  if (!startReorder(event, tab.id)) return
  closeMenu(false)
  hideTooltip()
}

function onDragOver(event: DragEvent, targetId: string): void {
  updateDropTarget(event, targetId)
}

function onTabsDragOver(event: DragEvent): void {
  updateStripAutoScroll(event)
}

function onTabsDragLeave(event: DragEvent): void {
  stopAutoScrollOutsideStrip(event)
}

function onDrop(event: DragEvent, targetId: string): void {
  dropReorder(event, targetId)
}

function onDragEnd(): void {
  endReorder()
}

function onTabClick(tab: WorkspaceTab): void {
  hideTooltip()
  if (consumeSuppressedClick()) return
  emit('select', tab.id)
}

function moveTabByKeyboard(tab: WorkspaceTab, direction: -1 | 1): void {
  hideTooltip()
  moveByKeyboard(tab.id, direction)
}

// --- right-click / keyboard context menu ---
const tabsInput = computed<readonly WorkspaceTab[]>(() => props.tabs)
const menuLabelKeys: Record<WorkspaceTabMenuAction, string> = {
  close: 'workspace_tab.close',
  'close-others': 'workspace_tab.close_others',
  'close-left': 'workspace_tab.close_left',
  'close-right': 'workspace_tab.close_right',
  'close-all': 'workspace_tab.close_all',
  'copy-path': 'workspace_tab.copy_path',
  'reveal-in-tree': 'workspace_tab.reveal_in_tree',
}

function emitMenuIntent(intent: WorkspaceTabMenuIntent): void {
  if (intent.type === 'close') emit('close', intent.id)
  else if (intent.type === 'close-many') emit('close-many', intent.ids)
  else if (intent.type === 'copy-path') emit('copy-path', intent.path)
  else emit('reveal-in-tree', intent.path)
}

const {
  visible: menuVisible,
  x: menuX,
  y: menuY,
  targetId: menuTabPath,
  activeItem: activeMenuItem,
  items: menuItems,
  open: openMenu,
  close: closeMenu,
  activate: activateMenuAction,
  setMenuElement,
  setItemElement: setMenuItemRef,
  setActiveItem: setActiveMenuItem,
} = useWorkspaceTabMenu({
  tabs: tabsInput,
  activeId: activePathRef,
  onIntent: emitMenuIntent,
})

function onContextMenu(e: MouseEvent, path: string) {
  e.preventDefault()
  e.stopPropagation()
  hideTooltip()
  openMenu(path, e.clientX, e.clientY, e.currentTarget as HTMLElement)
}

</script>

<template>
  <div
    ref="tabsRef"
    class="tabs"
    role="tablist"
    @dragover="onTabsDragOver"
    @dragleave="onTabsDragLeave"
    @drop.self="cancelReorder(true)"
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
        :ref="setMenuElement"
        class="tab-context-menu"
        :style="{ left: menuX + 'px', top: menuY + 'px' }"
        role="menu"
        @click.stop
      >
        <template v-for="(item, index) in menuItems" :key="item.action">
          <div v-if="index === 5" role="separator" />
          <button
            :ref="(el) => setMenuItemRef(el, index)"
            role="menuitem"
            :tabindex="activeMenuItem === index ? 0 : -1"
            :disabled="item.disabled"
            @mouseenter="setActiveMenuItem(index)"
            @click="activateMenuAction(item.action)"
          >{{ translate(menuLabelKeys[item.action]) }}</button>
        </template>
      </div>
    </Teleport>
  </div>
</template>
