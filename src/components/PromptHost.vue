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
          >{{ busy ? '...' : (active.actionLabel ?? '✧') }}</button>
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
  position: relative;
  display: flex;
  width: 100%;
  min-width: 0;
}
.prompt-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 6px 32px 6px 10px;
  font-family: var(--sans);
  font-size: 0.85rem;
  line-height: 1.4;
  min-height: 34px;
  background: color-mix(in srgb, var(--bg) 94%, white);
  color: var(--vs-text-1);
  border: 1px solid color-mix(in srgb, var(--border) 82%, var(--text));
  border-radius: 6px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
}
.prompt-input-wrap:not(.has-action) .prompt-input {
  padding-right: 10px;
}
.prompt-input:focus {
  border-color: color-mix(in srgb, var(--vs-accent) 62%, var(--vs-border));
  background: color-mix(in srgb, var(--bg) 96%, white);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--vs-accent) 16%, transparent);
}
.prompt-input::placeholder {
  color: color-mix(in srgb, var(--vs-text-2) 78%, var(--vs-text-3));
  font-weight: 500;
}
.prompt-input-action {
  position: absolute;
  right: 4px;
  top: 4px;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: color-mix(in srgb, var(--vs-text-2) 86%, var(--vs-text-1));
  font: inherit;
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s, opacity 0.12s;
}
.prompt-input-action:hover:not(:disabled) {
  color: var(--vs-accent);
  background: color-mix(in srgb, var(--vs-accent) 10%, transparent);
}
.prompt-input-action:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}
</style>
