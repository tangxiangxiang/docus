<script setup lang="ts">
import type { Message } from '../../lib/ai-api'
import { ICON_AI } from './icons'
import AiToolCallCard from './AiToolCallCard.vue'
import { useI18n } from '../../composables/useI18n'

defineProps<{
  messages: Message[]
  currentPath: string | null
  quickPrompts: Array<{ label: string; text: string }>
}>()

const emit = defineEmits<{
  prompt: [text: string]
}>()
const { t } = useI18n()
</script>

<template>
  <div class="ai-messages" role="log" aria-live="polite">
    <div v-if="messages.length === 0" class="ai-empty-chat">
      <div class="ai-empty-head">
        <span class="ai-empty-icon" v-html="ICON_AI" aria-hidden="true" />
        <div>
          <div class="ai-empty-title">
            {{ t(currentPath ? 'ai.ask_note' : 'ai.ask_vault') }}
          </div>
          <div class="ai-empty-subtitle">
            {{ currentPath || t('ai.no_document') }}
          </div>
        </div>
      </div>
      <div class="ai-quick-prompts" :aria-label="t('ai.quick_prompts')">
        <button
          v-for="prompt in quickPrompts"
          :key="prompt.label"
          type="button"
          class="ai-quick-prompt"
          @click="emit('prompt', prompt.text)"
        >{{ prompt.label }}</button>
      </div>
    </div>

    <div
      v-for="message in messages"
      v-else
      :key="message.id || `${message.sessionId}-${message.createdAt}`"
      class="ai-message"
      :class="[message.role, { 'ai-streaming': message.id === 0 || message.id === -1 }]"
    >
      <div
        v-if="message.role === 'assistant'"
        class="ai-avatar"
        v-html="ICON_AI"
        aria-hidden="true"
      />
      <div class="ai-bubble">
        <div v-if="message.content" class="ai-text">{{ message.content }}</div>
        <AiToolCallCard
          v-for="call in message.blocks?.toolCalls ?? []"
          :key="call.id"
          :call="call"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.ai-text {
  white-space: pre-wrap;
  word-break: break-word;
}
.ai-empty-chat {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0;
  color: var(--vs-text-2, #858585);
}
.ai-empty-head {
  display: flex;
  align-items: center;
  gap: 9px;
}
.ai-empty-icon {
  display: inline-flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  color: color-mix(in srgb, var(--vs-accent, #007acc) 82%, var(--vs-text-1, #d4d4d4));
  background: color-mix(in srgb, var(--vs-accent, #007acc) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--vs-accent, #007acc) 22%, transparent);
  border-radius: 7px;
}
.ai-empty-icon :deep(svg) { width: 15px; height: 15px; display: block; }
.ai-empty-title { color: var(--vs-text-1, #d4d4d4); font-size: 0.86rem; font-weight: 600; line-height: 1.25; }
.ai-empty-subtitle {
  margin-top: 2px;
  max-width: 230px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--vs-text-3, #6a6a6a);
  font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 0.72rem;
}
.ai-quick-prompts { display: flex; flex-wrap: wrap; gap: 6px; }
.ai-quick-prompt {
  padding: 4px 7px;
  border: 1px solid color-mix(in srgb, var(--vs-border, #3c3c3c) 74%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--vs-bg-2, #252526) 72%, transparent);
  color: var(--vs-text-2, #858585);
  font: inherit;
  font-size: 0.75rem;
  line-height: 1.2;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.ai-quick-prompt:hover {
  color: var(--vs-text-1, #d4d4d4);
  background: color-mix(in srgb, var(--vs-accent, #007acc) 10%, var(--vs-bg-2, #252526));
  border-color: color-mix(in srgb, var(--vs-accent, #007acc) 36%, var(--vs-border, #3c3c3c));
}
</style>
