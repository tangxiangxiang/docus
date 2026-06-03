<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import { usePrompt } from '../composables/usePrompt'

const { queue, answer } = usePrompt()
const active = computed(() => queue.value[0] ?? null)
const input = ref('')

watch(active, async (a) => {
  if (a) {
    input.value = a.initial ?? ''
    await nextTick()
    const el = document.getElementById('docus-prompt-input') as HTMLInputElement | null
    el?.focus()
    el?.select()
  }
})

function submit() {
  if (!active.value) return
  answer(active.value.id, input.value.trim() || null)
}
function cancel() {
  if (!active.value) return
  answer(active.value.id, null)
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); cancel() }
  if (e.key === 'Enter')  { e.preventDefault(); submit() }
}
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
      <div class="prompt-card" role="dialog" aria-modal="true">
        <h3 class="prompt-title">{{ active.title }}</h3>
        <input
          id="docus-prompt-input"
          v-model="input"
          class="prompt-input"
          :placeholder="active.placeholder"
          @keydown.enter.prevent="submit"
          @keydown.escape.prevent="cancel"
        />
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
.prompt-input:focus {
  border-color: var(--accent);
}
.prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}
</style>
