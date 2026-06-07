<script setup lang="ts">
// Session picker popover for the AI panel. Renders below the
// header; lists sessions newest-first, with hover affordances for
// rename (✎) and delete (×). Closes on outside click and on Esc.
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { useAiHistory } from '../../composables/vault/useAiHistory'

const emit = defineEmits<{ close: [] }>()

const history = useAiHistory()
const popoverRef = ref<HTMLElement | null>(null)
const editingId = ref<number | null>(null)
const editingTitle = ref('')

function startEdit(id: number, currentTitle: string) {
  editingId.value = id
  editingTitle.value = currentTitle
}

function commitEdit() {
  if (editingId.value === null) return
  const id = editingId.value
  const trimmed = editingTitle.value.trim()
  editingId.value = null
  editingTitle.value = ''
  if (trimmed.length === 0) return // empty after trim → no-op
  history.renameSession(id, trimmed)
}

function cancelEdit() {
  editingId.value = null
  editingTitle.value = ''
}

async function onDelete(id: number, title: string) {
  const label = title.trim() || 'this session'
  // window.confirm is intentional per spec §6 — destructive
  // confirmations are rare enough that the native dialog is fine.
  if (!window.confirm(`Delete "${label}" and all its messages?`)) return
  await history.deleteSession(id)
}

function onGlobalPointerDown(e: PointerEvent) {
  if (!popoverRef.value) return
  if (!popoverRef.value.contains(e.target as Node)) emit('close')
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (editingId.value !== null) cancelEdit()
    else emit('close')
  }
}

onMounted(async () => {
  await history.refreshSessions()
  document.addEventListener('pointerdown', onGlobalPointerDown)
  document.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onGlobalPointerDown)
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div ref="popoverRef" class="ai-session-picker" role="dialog" aria-label="AI sessions">
    <header class="ai-sp-header">
      <span class="ai-sp-title">Sessions</span>
      <button
        class="ai-sp-new"
        type="button"
        title="New session"
        aria-label="New session"
        @click="async () => { await history.createSession(); await history.refreshSessions() }"
      >+</button>
    </header>

    <ul class="ai-sp-list">
      <li
        v-for="s in history.sessions.value"
        :key="s.id"
        class="ai-sp-row"
        :class="{ active: history.activeSession.value?.id === s.id }"
        @click="async () => { await history.switchSession(s.id); emit('close') }"
      >
        <span class="ai-sp-dot" aria-hidden="true" />
        <template v-if="editingId === s.id">
          <input
            v-model="editingTitle"
            class="ai-sp-input"
            autofocus
            @keydown.enter="commitEdit"
            @keydown.esc="cancelEdit"
            @blur="commitEdit"
            @click.stop
          />
        </template>
        <template v-else>
          <span class="ai-sp-name">{{ s.title || 'New session' }}</span>
          <span class="ai-sp-actions" @click.stop>
            <button
              class="ai-sp-action"
              type="button"
              title="Rename"
              aria-label="Rename"
              @click.stop="startEdit(s.id, s.title)"
            >✎</button>
            <button
              class="ai-sp-action danger"
              type="button"
              title="Delete"
              aria-label="Delete"
              @click.stop="onDelete(s.id, s.title)"
            >×</button>
          </span>
        </template>
      </li>
      <li v-if="history.sessions.value.length === 0" class="ai-sp-empty">
        No sessions yet. Send a message or click + to start one.
      </li>
    </ul>
  </div>
</template>

<style scoped>
.ai-session-picker {
  position: absolute;
  top: 36px;
  left: 0;
  right: 0;
  z-index: 1;
  background: var(--vs-bg-1);
  border-bottom: 1px solid var(--vs-border);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  max-height: 280px;
  display: flex;
  flex-direction: column;
}
.ai-sp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vs-border);
}
.ai-sp-title {
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--vs-text-2);
}
.ai-sp-new {
  background: transparent;
  border: 0;
  color: var(--vs-text-2);
  width: 22px;
  height: 22px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ai-sp-new:hover { background: var(--vs-hover-bg); color: var(--vs-text-1); }
.ai-sp-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow-y: auto;
  flex: 1 1 auto;
  min-height: 0;
}
.ai-sp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 0.85rem;
  color: var(--vs-text-1);
  cursor: pointer;
}
.ai-sp-row:hover { background: var(--vs-hover-bg); }
.ai-sp-row.active { background: var(--vs-active-bg); }
.ai-sp-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: transparent;
  flex-shrink: 0;
}
.ai-sp-row.active .ai-sp-dot { background: var(--vs-accent); }
.ai-sp-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-sp-actions {
  display: none;
  gap: 4px;
  flex-shrink: 0;
}
.ai-sp-row:hover .ai-sp-actions,
.ai-sp-row.active .ai-sp-actions { display: inline-flex; }
.ai-sp-action {
  background: transparent;
  border: 0;
  color: var(--vs-text-2);
  width: 20px;
  height: 20px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ai-sp-action:hover { background: var(--vs-bg-3); color: var(--vs-text-1); }
.ai-sp-action.danger:hover { color: #e06060; }
.ai-sp-input {
  flex: 1;
  min-width: 0;
  background: var(--vs-bg-1);
  border: 1px solid var(--vs-accent);
  border-radius: 3px;
  color: var(--vs-text-1);
  font: inherit;
  font-size: 0.85rem;
  padding: 1px 6px;
  outline: none;
}
.ai-sp-empty {
  padding: 14px 12px;
  font-size: 0.85rem;
  color: var(--vs-text-3);
  font-style: italic;
}
</style>
