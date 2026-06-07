<script setup lang="ts">
// AI panel — UI + persistence. The close button emits `close` so
// the parent can decide what to do (typically toggleAi in
// VaultView). The composer appends user messages to the active
// session via the useAiHistory composable; assistant responses are
// still a future project (see the design spec §7 Out of scope).
import { onMounted, ref } from 'vue'
import { ICON_AI } from './icons'
import { useAiHistory } from '../../composables/vault/useAiHistory'
import AiSessionPicker from './AiSessionPicker.vue'

const emit = defineEmits<{
  close: []
}>()

const draft = ref('')
const pickerOpen = ref(false)
const history = useAiHistory()

onMounted(async () => {
  await history.loadActive()
})

function onSend() {
  const text = draft.value.trim()
  if (!text) return
  draft.value = '' // clear immediately for snappy UX
  // eslint-disable-next-line no-console
  console.debug('[ai] would send', text)
  void history.sendMessage(text)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    onSend()
  }
}

function togglePicker() {
  pickerOpen.value = !pickerOpen.value
}
</script>

<template>
  <aside class="ai-panel" aria-label="AI assistant">
    <header class="ai-header">
      <button
        class="ai-title"
        type="button"
        :title="pickerOpen ? '' : 'Switch session'"
        @click="togglePicker"
      >
        <span class="ai-title-icon" v-html="ICON_AI" aria-hidden="true" />
        <span class="ai-title-text">Claude</span>
        <template v-if="history.activeSession.value?.title">
          <span class="ai-title-sep" aria-hidden="true">·</span>
          <span class="ai-title-session">{{ history.activeSession.value.title }}</span>
        </template>
      </button>
      <button
        class="ai-close"
        type="button"
        title="Close panel"
        aria-label="Close panel"
        @click="emit('close')"
      >×</button>
    </header>

    <div class="ai-messages" role="log" aria-live="polite">
      <template v-if="history.messages.value.length === 0">
        <div class="ai-message assistant">
          <div class="ai-avatar" v-html="ICON_AI" aria-hidden="true" />
          <div class="ai-bubble">
            Hi, I'm your AI assistant. Ask me anything about this vault.
          </div>
        </div>
      </template>
      <template v-else>
        <div
          v-for="m in history.messages.value"
          :key="m.id || `${m.sessionId}-${m.createdAt}`"
          class="ai-message"
          :class="m.role"
        >
          <div
            v-if="m.role === 'assistant'"
            class="ai-avatar"
            v-html="ICON_AI"
            aria-hidden="true"
          />
          <div class="ai-bubble">{{ m.content }}</div>
        </div>
      </template>
    </div>

    <form class="ai-composer" @submit.prevent="onSend">
      <div class="ai-composer-inner">
        <textarea
          v-model="draft"
          class="ai-input"
          rows="1"
          placeholder="Ask Claude…"
          aria-label="Ask Claude"
          @keydown="onKeydown"
        />
        <button
          class="ai-send"
          type="submit"
          title="Send (Enter)"
          aria-label="Send"
          :disabled="!draft.trim()"
        >↑</button>
      </div>
    </form>

    <AiSessionPicker v-if="pickerOpen" @close="pickerOpen = false" />
  </aside>
</template>
