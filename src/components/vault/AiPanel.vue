<script setup lang="ts">
// AI panel — UI + persistence + LLM. The close button emits `close`
// so the parent can decide what to do (typically toggleAi in
// VaultView). The composer sends a user message to the active
// session via useAiHistory.sendAndStream; the server streams back
// tokens that fill the assistant bubble in real time.
//
// The `configured` flag (from /api/ai/active) determines whether
// the send button is enabled. When false, a persistent banner
// explains the missing env var. The `busy` flag disables the send
// button while a stream is in flight; there is no Stop button in
// v1.
import { onMounted, ref } from 'vue'
import { ICON_AI } from './icons'
import { useAiHistory } from '../../composables/vault/useAiHistory'
import { useCurrentNote } from '../../composables/vault/useCurrentNote'
import AiSessionPicker from './AiSessionPicker.vue'

const emit = defineEmits<{
  close: []
}>()

const draft = ref('')
const pickerOpen = ref(false)
const history = useAiHistory()
const currentNote = useCurrentNote()

onMounted(async () => {
  await history.loadActive()
})

async function onSend() {
  const text = draft.value.trim()
  if (!text) return
  if (history.busy.value) return
  if (!history.configured.value) return
  draft.value = '' // clear immediately for snappy UX
  await history.sendAndStream(text, {
    path: currentNote.path.value ?? '',
    content: currentNote.content.value,
  })
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

const noteTitle = (path: string | null): string => {
  if (!path) return ''
  // Use the basename minus extension as a friendly title.
  const segs = path.split('/')
  const last = segs[segs.length - 1] ?? path
  return last.replace(/\.md$/i, '')
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
      <span
        v-if="currentNote.path.value"
        class="ai-note-chip"
        :title="currentNote.path.value"
      >📎 {{ noteTitle(currentNote.path.value) }}</span>
      <button
        class="ai-close"
        type="button"
        title="Close panel"
        aria-label="Close panel"
        @click="emit('close')"
      >×</button>
    </header>

    <div
      v-if="!history.configured.value"
      class="ai-no-key-banner"
      role="status"
    >AI not configured — set <code>ANTHROPIC_API_KEY</code> in the server environment.</div>

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
          :class="[m.role, { 'ai-streaming': m.id === 0 || m.id === -1 }]"
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
          :disabled="!draft.trim() || history.busy.value || !history.configured.value"
        >↑</button>
      </div>
    </form>

    <AiSessionPicker v-if="pickerOpen" @close="pickerOpen = false" />
  </aside>
</template>
