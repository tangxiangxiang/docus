<script setup lang="ts">
// AI panel — UI only. The close button emits `close` so the parent can
// decide what to do (typically toggleAi in VaultView).
//
// Visual layout is inspired by Claude Code in VS Code: a 36px header
// with icon + label, a flowing message stream (assistant messages
// show a small avatar + plain text, user messages are right-aligned
// with a subtle bubble), and a single rounded composer that holds the
// textarea + send button as one focusable surface.
//
// The composer is intentionally inert: pressing Enter logs to the
// console and clears the textarea. Wiring this to a real LLM is a
// future project (see the design spec §6 Out of scope).

import { ref } from 'vue'
import { ICON_AI } from './icons'

const emit = defineEmits<{
  close: []
}>()

const draft = ref('')

function onSend() {
  const text = draft.value.trim()
  if (!text) return
  // UI-only: log and clear. Replace with a real client when ready.
  // eslint-disable-next-line no-console
  console.debug('[ai] would send', text)
  draft.value = ''
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    onSend()
  }
}
</script>

<template>
  <aside class="ai-panel" aria-label="AI assistant">
    <header class="ai-header">
      <div class="ai-title">
        <span class="ai-title-icon" v-html="ICON_AI" aria-hidden="true" />
        <span class="ai-title-text">Claude</span>
      </div>
      <button
        class="ai-close"
        type="button"
        title="Close panel"
        aria-label="Close panel"
        @click="emit('close')"
      >×</button>
    </header>

    <div class="ai-messages" role="log" aria-live="polite">
      <div class="ai-message assistant">
        <div class="ai-avatar" v-html="ICON_AI" aria-hidden="true" />
        <div class="ai-bubble">
          Hi, I'm your AI assistant. Ask me anything about this vault.
        </div>
      </div>
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
  </aside>
</template>
