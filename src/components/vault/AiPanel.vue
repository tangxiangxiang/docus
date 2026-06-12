<script setup lang="ts">
// AI panel — UI + persistence + LLM. The close button emits `close`
// so the parent can decide what to do (typically toggleAi in
// VaultView). The composer sends a user message to the active
// session via useAiHistory.sendAndStream; the server streams back
// tokens that fill the assistant bubble in real time.
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
import { computed, onMounted, reactive, ref } from 'vue'
import { ICON_AI, ICON_HISTORY, ICON_NEW_CHAT } from './icons'
import { useAiHistory } from '../../composables/vault/useAiHistory'
import { useCurrentNote } from '../../composables/vault/useCurrentNote'
import { parseUserMessage } from '../../composables/vault/noteAttachment'
import AiSessionPicker from './AiSessionPicker.vue'

const emit = defineEmits<{
  close: []
}>()

const draft = ref('')
const pickerOpen = ref(false)
const history = useAiHistory()
const currentNote = useCurrentNote()

// 📎 toggle: when ON, the next send splices the current note's
// body into the user message as an <attached_note> block. Default
// OFF — the user opts in per-message rather than every send
// silently dumping the note. State persists across sends in the
// same session (so the user can keep attaching without re-toggling
// after each turn) but resets to OFF on a fresh page load.
const attachNote = ref(false)

// Per-card expanded state for read_file / list_files (which tend
// to have long payloads). Other tools are always shown in full.
const expandedToolCards = reactive<Record<string, boolean>>({})

// Per-message expanded state for the collapsible "📎 附件" card
// inside the user bubble. Keyed by the v-for index because
// optimistic messages share id=0 and would otherwise collide;
// the index only changes when messages are added/removed, which
// is rare during a session. Default: collapsed — the user only
// sees the metadata header (path, size, truncation pill) until
// they actively click 展开.
const expandedAttachCards = reactive<Record<number, boolean>>({})

function toggleAttachCard(idx: number) {
  expandedAttachCards[idx] = !expandedAttachCards[idx]
}

// True when the current session already has at least one user
// message with a note attached — i.e. the model already has the
// note in its conversation history. Used by the composer hint
// line to warn the user that keeping 📎 on for the next send
// will re-attach the note (duplicating tokens).
const hasAttachedPreviously = computed(() =>
  history.messages.value.some((m) => m.role === 'user' && m.noteAttachment)
)

// Code-point count of the current note. Used by the chip's size
// label and the hint's "会重复 ~N 字符" estimate. Counts code
// points (not UTF-16 units) so the value matches what the server
// will cap at.
const currentAttachChars = computed(() =>
  currentNote.content.value ? [...currentNote.content.value].length : 0
)

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
    attach: attachNote.value,
  })
}

function toggleAttach() {
  // Don't allow toggling on when there's no note open — the button
  // is disabled in that case, but a keyboard-only path could still
  // hit the handler. Guard defensively.
  if (!attachNote.value && !currentNote.path.value) return
  attachNote.value = !attachNote.value
}

function onStop() {
  // Triggers AbortController inside sendAndStream; the stream
  // ends, the for-await exits, busy flips to false, and the
  // assistant message gets an [aborted] tag.
  history.stop()
}

function onSendOrStop() {
  // Single button, two behaviors. The form's @submit still routes
  // Enter through onSend(), so this handler only governs clicks.
  if (history.busy.value) onStop()
  else onSend()
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

// Short, human-friendly count for the chip and the banner. We
// count Unicode code points (not UTF-16 code units) so a 20K-cap
// block of emoji doesn't show as 40K+ and confuse the user.
const formatK = (n: number): string => {
  if (n < 1000) return `${n}`
  if (n < 10_000) return `${(n / 1000).toFixed(1)}K`
  return `${Math.round(n / 1000)}K`
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
          v-for="(m, idx) in history.messages.value"
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
            <!-- User messages with an attached note: render the
                 typed text and a collapsible "📎 附件" card
                 separately. The full note body is hidden by
                 default so the bubble doesn't look like "the
                 model received all this on every send". The
                 attached-note metadata (path, size, truncation)
                 stays visible in the card header. -->
            <template v-if="m.role === 'user' && m.noteAttachment">
              <div
                v-if="parseUserMessage(m.content).typedText"
                class="ai-text"
              >{{ parseUserMessage(m.content).typedText }}</div>
              <div class="ai-attach-card">
                <button
                  type="button"
                  class="ai-attach-card-toggle"
                  :aria-expanded="!!expandedAttachCards[idx]"
                  @click="toggleAttachCard(idx)"
                >
                  <span class="ai-attach-icon" aria-hidden="true">📎</span>
                  <span
                    class="ai-attach-path"
                    :title="m.noteAttachment.path"
                  >{{ noteTitle(m.noteAttachment.path) }}</span>
                  <span class="ai-attach-sep" aria-hidden="true">·</span>
                  <span class="ai-attach-size">
                    {{ formatK(m.noteAttachment.attachedCodepoints) }} /
                    {{ formatK(m.noteAttachment.originalCodepoints) }} chars
                  </span>
                  <span
                    v-if="m.noteAttachment.truncated"
                    class="ai-attach-pill"
                  >已截断</span>
                  <span class="ai-attach-card-arrow" aria-hidden="true">
                    {{ expandedAttachCards[idx] ? '▾' : '▸' }}
                  </span>
                  <span class="ai-attach-card-label">
                    {{ expandedAttachCards[idx] ? '收起' : '展开' }}
                  </span>
                </button>
                <pre
                  v-if="expandedAttachCards[idx]"
                  class="ai-attach-card-body"
                ><code>{{ parseUserMessage(m.content).attachedNoteBody }}</code></pre>
              </div>
            </template>
            <!-- Plain user message (no attached note) and
                 assistant messages: render the content as one
                 text block, plus tool cards for assistant. -->
            <template v-else>
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
            </template>
          </div>
        </div>
      </template>
    </div>

    <form class="ai-composer" @submit.prevent="onSend">
      <div
        v-if="attachNote && currentNote.path.value"
        class="ai-attach-block"
      >
        <div class="ai-attach-chip">
          <span class="ai-attach-icon" aria-hidden="true">📎</span>
          <span class="ai-attach-path" :title="currentNote.path.value">
            {{ noteTitle(currentNote.path.value) }}
          </span>
          <span class="ai-attach-sep" aria-hidden="true">·</span>
          <span class="ai-attach-size">
            {{ formatK(currentAttachChars) }} chars
          </span>
          <button
            type="button"
            class="ai-attach-chip-close"
            title="不再附加"
            aria-label="不再附加"
            @click="toggleAttach"
          >×</button>
        </div>
        <div class="ai-attach-hint" role="note">
          <template v-if="hasAttachedPreviously">
            model 已经在 history 里有附过的笔记。继续发建议关掉 📎，否则会重复发送约
            <strong>{{ formatK(currentAttachChars) }} 字符</strong>
          </template>
          <template v-else>
            下次发送会把当前笔记拼到消息正文
            <span v-if="currentAttachChars > 0" class="ai-attach-hint-aside">
              （约 {{ formatK(currentAttachChars) }} 字符）
            </span>
          </template>
        </div>
      </div>
      <div class="ai-composer-inner">
        <button
          class="ai-attach-toggle"
          :class="{ 'ai-attach-toggle-on': attachNote }"
          type="button"
          :title="attachNote
            ? '关闭附加（AI 只能通过工具读这篇笔记）'
            : '把当前笔记附加到本条消息'"
          :aria-label="attachNote ? 'Stop attaching current note' : 'Attach current note'"
          :aria-pressed="attachNote"
          :disabled="!currentNote.path.value"
          @click="toggleAttach"
        >📎</button>
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
          :class="{ 'ai-send-busy': history.busy.value }"
          type="button"
          :title="history.busy.value ? 'Stop' : 'Send (Enter)'"
          :aria-label="history.busy.value ? 'Stop' : 'Send'"
          :disabled="!history.busy.value && (!draft.trim() || !history.configured.value)"
          @click="onSendOrStop"
        >{{ history.busy.value ? '■' : '↑' }}</button>
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

/* 📎 attach-note toggle + banner. The toggle lives in the composer
   (left of the textarea); the banner is a small status row above
   the user message bubble, visible during the in-flight turn and
   on history reload. Both share the same vocabulary (icon, path,
   size, truncation pill) so a user can spot the difference between
   "this turn has an attached note" and "this turn truncated". */
.ai-attach-toggle {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--ai-border, #3a3f4b);
  border-radius: 6px;
  background: transparent;
  color: var(--ai-muted, #8a93a6);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  transition: background 80ms ease, color 80ms ease, border-color 80ms ease;
}
.ai-attach-toggle:hover:not(:disabled) {
  color: var(--ai-accent, #7aa2f7);
  border-color: var(--ai-accent, #7aa2f7);
}
.ai-attach-toggle:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ai-attach-toggle-on {
  background: var(--ai-accent-bg, rgba(122, 162, 247, 0.16));
  border-color: var(--ai-accent, #7aa2f7);
  color: var(--ai-accent, #7aa2f7);
}

.ai-attach-block {
  /* Wrapper around the chip + hint, sits above the composer. */
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 6px;
}

.ai-attach-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid var(--ai-accent, #7aa2f7);
  border-radius: 6px;
  background: var(--ai-accent-bg, rgba(122, 162, 247, 0.10));
  font-size: 0.78em;
  color: var(--ai-accent, #7aa2f7);
}
.ai-attach-icon {
  flex: 0 0 auto;
}
.ai-attach-path {
  font-family: var(--ai-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-weight: 500;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-attach-sep {
  color: var(--ai-muted, #8a93a6);
}
.ai-attach-size {
  color: var(--ai-muted, #8a93a6);
  font-variant-numeric: tabular-nums;
}
.ai-attach-chip-close {
  margin-left: auto;
  padding: 0 6px;
  border: none;
  background: transparent;
  color: var(--ai-muted, #8a93a6);
  cursor: pointer;
  font-size: 1.1em;
  line-height: 1;
}
.ai-attach-chip-close:hover {
  color: var(--ai-accent, #7aa2f7);
}

.ai-attach-hint {
  font-size: 0.72em;
  color: var(--ai-muted, #8a93a6);
  padding: 0 2px;
  line-height: 1.4;
}
.ai-attach-hint strong {
  color: var(--ai-text, #d8dde6);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.ai-attach-hint-aside {
  color: var(--ai-muted, #8a93a6);
}

/* Collapsible "📎 附件" card inside the user bubble. The card
   header always shows the metadata (path, size, truncation pill)
   so the user knows what was attached, but the body — which is
   potentially 20K characters of note text — is hidden by default.
   Click 展开 / 收起 to verify the exact content the model saw. */
.ai-attach-card {
  margin-top: 8px;
  padding: 0;
  border: 1px solid var(--ai-border, #3a3f4b);
  border-radius: 6px;
  background: var(--ai-tool-bg, rgba(255, 255, 255, 0.03));
  font-size: 0.85em;
  overflow: hidden;
}
.ai-attach-card-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  font: inherit;
  font-size: 1em;
}
.ai-attach-card-toggle:hover {
  background: var(--ai-accent-bg, rgba(122, 162, 247, 0.08));
}
.ai-attach-card-toggle .ai-attach-icon {
  color: var(--ai-accent, #7aa2f7);
}
.ai-attach-card-toggle .ai-attach-path {
  color: var(--ai-text, #d8dde6);
  flex: 0 1 auto;
}
.ai-attach-card-toggle .ai-attach-sep {
  flex: 0 0 auto;
}
.ai-attach-card-toggle .ai-attach-size {
  flex: 0 0 auto;
}
.ai-attach-card .ai-attach-pill {
  flex: 0 0 auto;
  padding: 0 6px;
  border-radius: 9999px;
  background: var(--ai-pending-bg, rgba(120, 130, 150, 0.18));
  color: var(--ai-pending, #c0c5d0);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
  font-size: 0.85em;
}
.ai-attach-card-arrow {
  flex: 0 0 auto;
  color: var(--ai-muted, #8a93a6);
  margin-left: auto;
}
.ai-attach-card-label {
  flex: 0 0 auto;
  color: var(--ai-accent, #7aa2f7);
  font-size: 0.85em;
}
.ai-attach-card-body {
  margin: 0;
  padding: 6px 10px 10px;
  border-top: 1px solid var(--ai-border, #3a3f4b);
  background: rgba(0, 0, 0, 0.18);
  font-family: var(--ai-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 0.9em;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.ai-attach-card-body code {
  font-family: inherit;
}
</style>
