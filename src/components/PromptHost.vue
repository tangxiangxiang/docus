<script setup lang="ts">
import { ref, watch, nextTick, computed, onBeforeUnmount } from 'vue'
import { usePrompt } from '../composables/usePrompt'
import { useFocusTrap } from '../composables/useFocusTrap'

const { queue, answer } = usePrompt()
const active = computed(() => queue.value[0] ?? null)
const input = ref('')
const busy = ref(false)
const cardRef = ref<HTMLElement | null>(null)
const trap = useFocusTrap()

// Focus management: when a prompt opens, remember the trigger and
// focus the input. When it closes, send focus back so the keyboard
// user doesn't drop into <body>. The Tab trap keeps focus cycling
// between the input, the cancel button, and the OK button.
watch(active, async (a) => {
  if (a) {
    trap.activate()
    input.value = a.initial ?? ''
    busy.value = false
    await nextTick()
    const el = document.getElementById('docus-prompt-input') as HTMLInputElement | null
    el?.focus()
    el?.select()
  } else {
    void trap.deactivate()
  }
}, { immediate: true })

function submit() {
  if (!active.value) return
  answer(active.value.id, input.value.trim() || null)
}
function cancel() {
  if (!active.value) return
  answer(active.value.id, null)
}
async function runAction() {
  const req = active.value
  if (!req?.transform || busy.value) return
  busy.value = true
  try {
    const next = await req.transform(input.value)
    input.value = next
    await nextTick()
    const el = document.getElementById('docus-prompt-input') as HTMLInputElement | null
    el?.focus()
    el?.select()
  } finally {
    busy.value = false
  }
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); cancel(); return }
  if (e.key === 'Enter')  { e.preventDefault(); submit(); return }
  if (e.key === 'Tab' && cardRef.value) {
    trap.onTab(() => cardRef.value, e)
  }
}

onBeforeUnmount(() => {
  if (active.value) void trap.deactivate()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="active"
      class="prompt-backdrop"
      @click.self="cancel"
      @keydown="onKeydown"
      tabindex="-1"
    >
      <div
        ref="cardRef"
        class="prompt-card"
        role="dialog"
        aria-modal="true"
        :aria-label="active.title"
      >
        <h3 class="prompt-title">{{ active.title }}</h3>
        <div class="prompt-input-wrap" :class="{ 'has-action': Boolean(active.transform) }">
          <input
            id="docus-prompt-input"
            v-model="input"
            class="prompt-input"
            :placeholder="active.placeholder"
            @keydown.enter.prevent="submit"
            @keydown.escape.prevent="cancel"
          />
          <button
            v-if="active.transform"
            type="button"
            class="prompt-input-action"
            :title="active.actionTitle ?? '生成英文路径名'"
            :disabled="busy"
            @click="runAction"
          >{{ busy ? '...' : (active.actionLabel ?? 'AI') }}</button>
        </div>
        <div class="prompt-actions">
          <button type="button" class="btn" @click="cancel">取消</button>
          <button type="button" class="btn btn-primary" @click="submit">确定</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.prompt-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9998;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
}
.prompt-card {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px 22px;
  min-width: 320px;
  max-width: 480px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
}
.prompt-title {
  margin: 0 0 12px;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-h);
}
.prompt-input-wrap {
  display: flex;
  align-items: stretch;
  width: 100%;
}
.prompt-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  font: inherit;
  font-size: 0.9rem;
  background: var(--bg-soft);
  color: var(--text-h);
  border: 1px solid var(--border);
  border-radius: 4px;
  outline: none;
}
.prompt-input-wrap.has-action .prompt-input {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
.prompt-input:focus {
  border-color: var(--accent);
}
.prompt-input-action {
  min-width: 42px;
  padding: 0 10px;
  font: inherit;
  font-size: 0.82rem;
  color: var(--text-h);
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-left: 0;
  border-radius: 0 4px 4px 0;
  cursor: pointer;
}
.prompt-input-action:hover:not(:disabled) {
  color: var(--accent);
}
.prompt-input-action:disabled {
  opacity: 0.6;
  cursor: default;
}
.prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}
</style>
