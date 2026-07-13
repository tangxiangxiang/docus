<script setup lang="ts">
// Combined "view mode" picker for the vault.
//
// Replaces the previous pair of toggle buttons in NavBar
// (.mode-toggle for edit↔read and .preview-toggle for the preview
// pane). The two toggles were conceptually a 2×2 matrix but only
// three of the four cells were valid (read mode hides the preview
// pane by definition — showing the toggle there would imply a
// separate preview surface that doesn't exist), so we render the
// three valid states as a radio list instead of two booleans.
//
// State model:
//   - edit + preview off  → "Edit"
//   - edit + preview on   → "Edit + Preview"
//   - read                → "Read"  (preview bit is ignored)
//
// The parent owns the truth (mode + previewOpen refs in
// useVaultLayout / App.vue). This component only emits the user's
// selection; it does not call any state setters itself. That keeps
// it trivially testable (assert on emit) and avoids re-entrancy if
// the source of truth is also driven by keyboard shortcuts
// (Cmd-\, Cmd-Shift-R) elsewhere.

import { computed, nextTick, ref, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { ICON_EYE, ICON_READ, ICON_RENAME } from './vault/icons'

type VaultViewMode = 'edit' | 'read'

const props = defineProps<{
  /** Current view mode (provided by App.vue via VaultViewModeKey). */
  mode: VaultViewMode
  /** Whether the preview pane is open in edit mode. Ignored when
   *  mode === 'read' since read mode renders the reading surface
   *  full-bleed and has no separate preview. */
  previewOpen: boolean
}>()

const emit = defineEmits<{
  /** Fired when the user picks one of the three options. Payload is
   *  the new `(mode, previewOpen)` pair — the parent applies both.
   *  Centralizing the state mutation in the parent keeps the
   *  existing keyboard shortcuts (Cmd-\, Cmd-Shift-R) as alternative
   *  paths to the same state without duplicating logic. */
  select: [{ mode: VaultViewMode; previewOpen: boolean }]
}>()

/* ----- The three options -----
   Label + icon + the (mode, previewOpen) tuple to emit on pick.
   Order matters: it's the order they appear in the popover and the
   order keyboard navigation traverses (ArrowUp wraps to bottom,
   ArrowDown wraps to top). */
const OPTIONS = [
  { key: 'edit',        label: 'Edit',           icon: 'pencil',    mode: 'edit' as const, previewOpen: false },
  { key: 'edit+preview', label: 'Edit + Preview', icon: 'eye-pencil', mode: 'edit' as const, previewOpen: true  },
  { key: 'read',         label: 'Read',           icon: 'book-open', mode: 'read' as const, previewOpen: false },
] as const

type OptionKey = typeof OPTIONS[number]['key']

/* Which option matches the current props. In read mode the preview
   bit is irrelevant so we always land on 'read'. */
const activeKey = computed<OptionKey>(() => {
  if (props.mode === 'read') return 'read'
  return props.previewOpen ? 'edit+preview' : 'edit'
})

/* The trigger button shows the active option's label and icon. */
const activeOption = computed(() => OPTIONS.find((o) => o.key === activeKey.value)!)

const isOpen = ref(false)
const rootEl = ref<HTMLElement | null>(null)

/* Focus index for keyboard nav. Defaults to the active option so
   pressing ArrowDown immediately advances (and wraps from bottom to
   top). */
const focusIndex = ref(0)
watch(isOpen, async (open) => {
  if (!open) return
  await nextTick()
  const i = OPTIONS.findIndex((o) => o.key === activeKey.value)
  focusIndex.value = i >= 0 ? i : 0
  /* Focus the active option so screen readers announce it. The
     items are real <button>s so we can call .focus() directly. */
  const btn = rootEl.value?.querySelectorAll<HTMLButtonElement>('.view-mode-menu-item')[focusIndex.value]
  btn?.focus()
})

/* Close when clicking outside the menu root. ignore attribute lets
   the trigger itself (which lives inside rootEl) keep its toggle
   behavior — but we also handle the trigger click via @click on the
   button, so this is just a safety net for any clicks that bubble
   up from somewhere else on the page. */
onClickOutside(rootEl, () => { isOpen.value = false })

function toggleOpen() {
  isOpen.value = !isOpen.value
}

function close() {
  isOpen.value = false
}

function pick(key: OptionKey) {
  const opt = OPTIONS.find((o) => o.key === key)
  if (!opt) return
  emit('select', { mode: opt.mode, previewOpen: opt.previewOpen })
  /* Close after the parent applies the change; the trigger label
     updates from the props-driven `activeOption` computed. */
  close()
}

function onTriggerKeydown(e: KeyboardEvent) {
  /* ArrowDown on the closed trigger should open the menu AND move
     into the list — feels natural for keyboard users discovering
     the widget. */
  if (!isOpen.value && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault()
    isOpen.value = true
    return
  }
  if (e.key === 'Escape' && isOpen.value) {
    e.preventDefault()
    close()
  }
}

function onItemKeydown(e: KeyboardEvent, idx: number) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    const next = (idx + 1) % OPTIONS.length
    focusIndex.value = next
    rootEl.value?.querySelectorAll<HTMLButtonElement>('.view-mode-menu-item')[next]?.focus()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    const next = (idx - 1 + OPTIONS.length) % OPTIONS.length
    focusIndex.value = next
    rootEl.value?.querySelectorAll<HTMLButtonElement>('.view-mode-menu-item')[next]?.focus()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    close()
    /* Return focus to the trigger so keyboard users can keep
       tabbing from where they were. */
    rootEl.value?.querySelector<HTMLButtonElement>('.view-mode-menu-trigger')?.focus()
  } else if (e.key === 'Home') {
    e.preventDefault()
    focusIndex.value = 0
    rootEl.value?.querySelectorAll<HTMLButtonElement>('.view-mode-menu-item')[0]?.focus()
  } else if (e.key === 'End') {
    e.preventDefault()
    const last = OPTIONS.length - 1
    focusIndex.value = last
    rootEl.value?.querySelectorAll<HTMLButtonElement>('.view-mode-menu-item')[last]?.focus()
  }
}

/* Trigger shows the active icon (the one that represents the
   current state — pencil for edit, eye-pencil for edit+preview,
   book-open for read). The popover rows use a smaller version of
   the same icon for visual continuity. */
function iconFor(key: OptionKey): string {
  if (key === 'read') return ICON_READ
  if (key === 'edit+preview') return ICON_EYE
  return ICON_RENAME
}
</script>

<template>
  <div ref="rootEl" class="view-mode-menu" :class="{ 'is-open': isOpen }">
    <button
      type="button"
      class="view-mode-menu-trigger"
      :aria-haspopup="'menu'"
      :aria-expanded="isOpen"
      :aria-label="`View mode: ${activeOption.label}`"
      :title="`View mode: ${activeOption.label}`"
      @click="toggleOpen"
      @keydown="onTriggerKeydown"
    >
      <span class="view-mode-menu-trigger-icon" v-html="iconFor(activeKey)" aria-hidden="true" />
      <span class="view-mode-menu-trigger-label">{{ activeOption.label }}</span>
      <span class="view-mode-menu-trigger-caret" aria-hidden="true">▾</span>
    </button>

    <div
      v-if="isOpen"
      class="view-mode-menu-popover"
      role="menu"
      :aria-label="'View mode'"
    >
      <button
        v-for="(opt, idx) in OPTIONS"
        :key="opt.key"
        type="button"
        role="menuitemradio"
        class="view-mode-menu-item"
        :class="{ 'is-active': opt.key === activeKey }"
        :aria-checked="opt.key === activeKey"
        :tabindex="idx === focusIndex ? 0 : -1"
        @click="pick(opt.key)"
        @keydown="onItemKeydown($event, idx)"
      >
        <span class="view-mode-menu-item-icon" v-html="iconFor(opt.key)" aria-hidden="true" />
        <span class="view-mode-menu-item-label">{{ opt.label }}</span>
        <span v-if="opt.key === activeKey" class="view-mode-menu-item-check" aria-hidden="true">✓</span>
      </button>
    </div>
  </div>
</template>
