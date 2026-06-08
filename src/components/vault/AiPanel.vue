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
//
// Tool cards: when the assistant message carries tool calls
// (m.blocks?.toolCalls), each call is rendered as a card with the
// tool name, an icon, a status pill (ok / error / pending), and
// the result text. read_file / list_files cards are collapsed by
// default to keep the panel compact; the user can expand them.
import { onMounted, reactive, ref } from 'vue'
import { ICON_AI, ICON_HISTORY, ICON_NEW_CHAT } from './icons'
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

// Per-card expanded state for read_file / list_files (which tend
// to have long payloads). Other tools are always shown in full.
const expandedToolCards = reactive<Record<string, boolean>>({})

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

async function onNewSession() {
  if (history.busy.value) return
  pickerOpen.value = false
  await history.createSession()
}

const noteTitle = (path: string | null): string => {
  if (!path) return ''
  // Use the basename minus extension as a friendly title.
  const segs = path.split('/')
  const last = segs[segs.length - 1] ?? path
  return last.replace(/\.md$/i, '')
}

// Inline SVG glyphs for each tool. Kept small and monochrome so
// they pick up the surrounding text color via currentColor.
const TOOL_ICONS: Record<string, string> = {
  read_file: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h10l2 2v8H2z"/><path d="M2 3v10h12"/></svg>',
  list_files: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4h12M2 8h12M2 12h12"/></svg>',
  create_file: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2h7l3 3v9H3z"/><path d="M8 7v4M6 9h4"/></svg>',
  write_file: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-8 8H3v-3z"/></svg>',
  patch_file: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="6" r="2"/><circle cx="10" cy="10" r="2"/><path d="M7 8l2 0M7 8l-1 4M9 8l1-4"/></svg>',
  delete_file: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h10M5 4V2h6v2M5 4l1 10h4l1-10"/></svg>',
  rename_file: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 12V8l8-8 4 4-8 8z"/><path d="M6 6l4 4"/></svg>',
}
function iconForTool(name: string): string {
  return TOOL_ICONS[name] ?? TOOL_ICONS.read_file
}

const COLLAPSE_THRESHOLD = 200
function truncateForCard(s: string): string {
  if (s.length <= COLLAPSE_THRESHOLD) return s
  return s.slice(0, COLLAPSE_THRESHOLD) + '…'
}

function toggleToolCard(id: string) {
  expandedToolCards[id] = !expandedToolCards[id]
}
</script>

<template>
  <aside class="ai-panel" aria-label="AI assistant">
    <header class="ai-header">
      <div class="ai-title">
        <span class="ai-title-icon" v-html="ICON_AI" aria-hidden="true" />
        <span class="ai-title-text">AI</span>
        <template v-if="history.activeSession.value?.title">
          <span class="ai-title-sep" aria-hidden="true">·</span>
          <span
            class="ai-title-session"
            :title="history.activeSession.value.title"
          >{{ history.activeSession.value.title }}</span>
        </template>
      </div>
      <span
        v-if="currentNote.path.value"
        class="ai-note-chip"
        :title="currentNote.path.value"
      >📎 {{ noteTitle(currentNote.path.value) }}</span>
      <button
        class="ai-header-btn"
        type="button"
        :title="pickerOpen ? 'Close history' : 'Open history'"
        :aria-label="pickerOpen ? 'Close history' : 'Open history'"
        aria-haspopup="dialog"
        :aria-expanded="pickerOpen"
        @click="togglePicker"
      ><span v-html="ICON_HISTORY" aria-hidden="true" /></button>
      <button
        class="ai-header-btn"
        type="button"
        title="New conversation"
        aria-label="New conversation"
        :disabled="history.busy.value"
        @click="onNewSession"
      ><span v-html="ICON_NEW_CHAT" aria-hidden="true" /></button>
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
          <div class="ai-bubble">
            <div v-if="m.content" class="ai-text">{{ m.content }}</div>
            <div
              v-for="tc in m.blocks?.toolCalls ?? []"
              :key="tc.id"
              class="ai-tool-card"
              :class="{ 'ai-tool-error': tc.result.is_error }"
            >
              <div class="ai-tool-header">
                <span class="ai-tool-icon" v-html="iconForTool(tc.name)" aria-hidden="true" />
                <span class="ai-tool-name">{{ tc.name }}</span>
                <span v-if="tc.result.is_error" class="ai-tool-pill ai-tool-pill-error">error</span>
                <span v-else-if="tc.result.content" class="ai-tool-pill ai-tool-pill-ok">ok</span>
                <span v-else class="ai-tool-pill ai-tool-pill-pending">…</span>
              </div>
              <pre
                v-if="tc.result.content && (tc.name === 'read_file' || tc.name === 'list_files') && !expandedToolCards[tc.id]"
                class="ai-tool-result ai-tool-collapsed"
              ><code>{{ truncateForCard(tc.result.content) }}</code></pre>
              <pre
                v-else-if="tc.result.content"
                class="ai-tool-result"
              ><code>{{ tc.result.content }}</code></pre>
              <button
                v-if="tc.result.content && (tc.name === 'read_file' || tc.name === 'list_files')"
                type="button"
                class="ai-tool-toggle"
                @click="toggleToolCard(tc.id)"
              >{{ expandedToolCards[tc.id] ? '收起' : '展开' }}</button>
            </div>
          </div>
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

<style scoped>
/* Tool card styles. Kept scoped to AiPanel.vue so they don't leak.
   The base .ai-bubble styles handle alignment with the avatar. */
.ai-text {
  white-space: pre-wrap;
  word-break: break-word;
}
.ai-tool-card {
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid var(--ai-border, #3a3f4b);
  border-radius: 6px;
  background: var(--ai-tool-bg, rgba(255, 255, 255, 0.03));
  font-size: 0.85em;
}
.ai-tool-card.ai-tool-error {
  border-color: var(--ai-error, #c14545);
  background: var(--ai-tool-error-bg, rgba(193, 69, 69, 0.08));
}
.ai-tool-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.ai-tool-icon {
  display: inline-flex;
  align-items: center;
  color: var(--ai-muted, #8a93a6);
}
.ai-tool-name {
  font-family: var(--ai-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-weight: 500;
}
.ai-tool-pill {
  margin-left: auto;
  padding: 0 6px;
  border-radius: 9999px;
  font-size: 0.75em;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ai-tool-pill-ok {
  background: var(--ai-ok-bg, rgba(80, 170, 110, 0.18));
  color: var(--ai-ok, #6ec486);
}
.ai-tool-pill-error {
  background: var(--ai-error-bg, rgba(193, 69, 69, 0.18));
  color: var(--ai-error, #c14545);
}
.ai-tool-pill-pending {
  background: var(--ai-pending-bg, rgba(120, 130, 150, 0.18));
  color: var(--ai-pending, #8a93a6);
}
.ai-tool-result {
  margin: 0;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.18);
  border-radius: 4px;
  font-family: var(--ai-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 0.85em;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.ai-tool-result.ai-tool-collapsed {
  max-height: 64px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ai-tool-result code {
  font-family: inherit;
}
.ai-tool-toggle {
  margin-top: 4px;
  padding: 2px 6px;
  border: none;
  background: transparent;
  color: var(--ai-accent, #7aa2f7);
  cursor: pointer;
  font-size: 0.85em;
}
.ai-tool-toggle:hover {
  text-decoration: underline;
}
</style>
