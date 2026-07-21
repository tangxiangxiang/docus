<script setup lang="ts">
// AI panel — chat UI + session persistence + LLM streaming. The
// close button emits `close` so the parent (VaultView) can decide
// what to do (typically toggleAi). The composer sends a user
// message to the active session via useAiHistory.sendAndStream;
// the server streams back tokens that fill the assistant bubble
// in real time.
//
// The `configured` flag (from /api/ai/active) determines whether
// the send button is enabled. When false, a persistent banner
// explains the missing env var.
//
// The send button is a single toggle: when idle, it sends (type=
// submit so Enter still triggers it); when busy, it stops the
// in-flight stream (type=button, distinct color/icon so the
// destructive nature reads visually). See useAiHistory.stop() for
// the AbortController plumbing.
//
// Tool cards: when the assistant message carries tool calls
// (m.blocks?.toolCalls), each call is rendered as a card with the
// tool name, an icon, a status pill (ok / error / pending), and
// the result text. read_file / list_files cards are collapsed by
// default to keep the panel compact; the user can expand them.
//
// Live context (Edit-10.2): onSend captures the active workspace tab
// synchronously BEFORE any async work, so tab switches, renames or
// continued typing after the click can never splice this turn's
// identity and content. The route is no longer the AI authority —
// useAiLiveContext reads the workspace. This stage still talks to the
// path-only server: only a live Document context claims a legacy path
// (legacyTransportPathForCapture); History/Diff/Recovery fail closed
// with no path. Full snapshot transport is Edit-10.3.
import { onMounted, ref, computed, nextTick } from 'vue'
import { ICON_HISTORY, ICON_NEW_CHAT } from './icons'
import { useAiHistory } from '../../composables/vault/useAiHistory'
import { useAiLiveContext } from '../../composables/vault/useAiLiveContext'
import { useI18n } from '../../composables/useI18n'
import {
  displayPathForCapture,
  legacyTransportPathForCapture,
} from './aiContextPaths'
import AiSessionPicker from './AiSessionPicker.vue'
import AiChatMessages from './AiChatMessages.vue'
import AiComposer from './AiComposer.vue'

const draft = ref('')
const pickerOpen = ref(false)
const history = useAiHistory()
const liveContext = useAiLiveContext()
const { t } = useI18n()
const composer = ref<InstanceType<typeof AiComposer> | null>(null)

// The path chip + quick-prompt scope follow the same capture the send
// uses. The computed re-runs capture() on every workspace change —
// there is no cache, and the send path never reads this value.
const displayPath = computed(() => displayPathForCapture(liveContext.capture()))

onMounted(async () => {
  await history.loadActive()
})

async function onSend() {
  const text = draft.value.trim()
  if (!text) return
  if (history.busy.value) return
  if (!history.configured.value) return

  // Capture BEFORE any await: one immutable send-time snapshot.
  const capture = liveContext.capture()

  draft.value = '' // clear immediately for snappy UX

  await history.sendAndStream(text, {
    path: legacyTransportPathForCapture(capture),
  })
}

function togglePicker() {
  pickerOpen.value = !pickerOpen.value
}

async function onNewSession() {
  if (history.busy.value) return
  pickerOpen.value = false
  await history.createSession()
}

const quickPrompts = computed(() => {
  const hasNote = displayPath.value !== null
  return hasNote
    ? [
        { label: t('quick_prompts.with_note.summarize.label'), text: t('quick_prompts.with_note.summarize.text') },
        { label: t('quick_prompts.with_note.find_related.label'), text: t('quick_prompts.with_note.find_related.text') },
        { label: t('quick_prompts.with_note.suggest_tidy.label'), text: t('quick_prompts.with_note.suggest_tidy.text') },
      ]
    : [
        { label: t('quick_prompts.no_note.browse.label'), text: t('quick_prompts.no_note.browse.text') },
        { label: t('quick_prompts.no_note.find_unprocessed.label'), text: t('quick_prompts.no_note.find_unprocessed.text') },
        { label: t('quick_prompts.no_note.suggest_tidy.label'), text: t('quick_prompts.no_note.suggest_tidy.text') },
      ]
})

async function useQuickPrompt(text: string) {
  draft.value = text
  await nextTick()
  await composer.value?.focus()
}
</script>

<template>
  <aside class="ai-panel" :aria-label="t('ai.assistant')">
    <header class="ai-header">
      <span
        class="ai-title-session"
        :title="history.activeSession.value?.title || t('ai.new_conversation')"
      >{{ history.activeSession.value?.title || t('ai.new_conversation') }}</span>
      <div class="ai-header-actions">
      <button
        class="ai-header-btn"
        type="button"
        :title="t(pickerOpen ? 'ai.close_history' : 'ai.open_history')"
        :aria-label="t(pickerOpen ? 'ai.close_history' : 'ai.open_history')"
        aria-haspopup="dialog"
        :aria-expanded="pickerOpen"
        @click="togglePicker"
      ><span v-html="ICON_HISTORY" aria-hidden="true" /></button>
      <button
        class="ai-header-btn"
        type="button"
        :title="t('ai.new_conversation')"
        :aria-label="t('ai.new_conversation')"
        :disabled="history.busy.value"
        @click="onNewSession"
      ><span v-html="ICON_NEW_CHAT" aria-hidden="true" /></button>
      </div>
    </header>

    <div
      v-if="!history.configured.value"
      class="ai-no-key-banner"
      role="status"
    >{{ t('ai.not_configured') }}</div>

    <AiChatMessages
      :messages="history.messages.value"
      :current-path="displayPath"
      :quick-prompts="quickPrompts"
      @prompt="useQuickPrompt"
    />

    <AiComposer
      ref="composer"
      v-model="draft"
      :busy="history.busy.value"
      :configured="history.configured.value"
      :current-path="displayPath"
      @send="onSend"
      @stop="history.stop"
    />

    <AiSessionPicker v-if="pickerOpen" @close="pickerOpen = false" />
  </aside>
</template>
