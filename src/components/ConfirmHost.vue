<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { useConfirm } from '../composables/useConfirm'
import { useFocusTrap } from '../composables/useFocusTrap'

const { queue, answer } = useConfirm()
const dialogRef = ref<HTMLElement | HTMLElement[] | null>(null)
const trap = useFocusTrap()

function activeDialog(): HTMLElement | null {
  return Array.isArray(dialogRef.value) ? (dialogRef.value[0] ?? null) : dialogRef.value
}

// Capture / restore focus + run a Tab trap while a confirm dialog is
// shown. The dialog is a single alertdialog; the trap only matters
// when the dialog has more than one focusable button (it does —
// 取消 + 确定), so a keyboard user can move between them without
// escaping back to the trigger underneath the teleported backdrop.
watch(queue, async (q) => {
  if (q.length > 0) {
    trap.activate()
    await nextTick()
    // Default focus: the safe action (Cancel). Focusing the
    // destructive action (OK) by default would make Enter a
    // destructive shortcut for anyone whose keyboard layout routes
    // Enter straight to the focused element.
    const cancel = activeDialog()?.querySelector<HTMLButtonElement>('.confirm-actions .btn')
    cancel?.focus()
  } else {
    void trap.deactivate()
  }
}, { immediate: true })

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Tab' && activeDialog()) {
    trap.onTab(activeDialog, e)
  }
}
onBeforeUnmount(() => {
  // If the host is unmounted mid-dialog (rare, but possible during
  // HMR), make sure the trap doesn't leave focus dangling.
  if (queue.value.length) void trap.deactivate()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="queue.length" class="confirm-host" @keydown.esc="answer(queue[0].id, false)">
      <div
        v-for="r in queue"
        :key="r.id"
        class="confirm-backdrop"
        @click.self="answer(r.id, false)"
        @keydown="onKeydown"
      >
        <div
          ref="dialogRef"
          class="confirm-dialog"
          role="alertdialog"
          aria-modal="true"
          :aria-label="r.message"
          tabindex="-1"
        >
          <div class="confirm-message">{{ r.message }}</div>
          <div v-if="r.detail" class="confirm-detail">{{ r.detail }}</div>
          <div class="confirm-actions">
            <button type="button" class="btn" @click="answer(r.id, false)">
              {{ r.cancelLabel ?? '取消' }}
            </button>
            <button
              type="button"
              class="btn"
              :class="r.destructive ? 'btn-danger' : 'btn-primary'"
              @click="answer(r.id, true)"
            >
              {{ r.confirmLabel ?? '确定' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
