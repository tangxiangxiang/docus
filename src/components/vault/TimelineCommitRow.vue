<script setup lang="ts">
import type { HistoryCommitItem } from '../../composables/vault/useHistoryTimeline'
import { ICON_CHEVRON } from './icons'

defineProps<{
  commit: HistoryCommitItem
  timeLabel: string
  fileCountLabel: string
  expanded: boolean
  toggleLabel: string
}>()

const emit = defineEmits<{
  toggle: []
  contextmenu: [event: MouseEvent]
  menukey: [event: KeyboardEvent]
}>()

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
    event.preventDefault()
    emit('menukey', event)
    return
  }
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  emit('toggle')
}
</script>

<template>
  <button
    type="button"
    class="history-commit-row"
    :class="{ active: expanded }"
    data-history-row
    role="treeitem"
    aria-level="2"
    :aria-expanded="expanded"
    :aria-label="toggleLabel"
    :title="commit.message"
    @click="emit('toggle')"
    @keydown="onKeydown"
    @contextmenu.prevent="emit('contextmenu', $event)"
  >
    <span class="history-disclosure" :class="{ expanded }" aria-hidden="true" v-html="ICON_CHEVRON" />
    <span class="history-row-copy">
      <span class="history-row-title">{{ commit.message }}</span>
      <span class="history-row-meta">
        {{ timeLabel }} · <span class="history-commit-sha">{{ commit.shortId }}</span> · {{ fileCountLabel }}
      </span>
    </span>
  </button>
</template>
