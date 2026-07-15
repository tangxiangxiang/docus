<script setup lang="ts">
import type { DocumentHistory } from '../../composables/vault/useHistoryTimeline'
import { ICON_FILE_MD } from './icons'

defineProps<{
  document: DocumentHistory
  timeLabel: string
  selected?: boolean
}>()

const emit = defineEmits<{ select: [document: DocumentHistory] }>()
</script>

<template>
  <button
    type="button"
    class="document-row history-document-row"
    :class="{ active: selected }"
    role="option"
    :aria-selected="selected ? 'true' : 'false'"
    @click="emit('select', document)"
    @keydown.enter.prevent="emit('select', document)"
  >
    <span class="history-row-icon" v-html="ICON_FILE_MD" />
    <span class="history-row-copy">
      <span class="history-row-title">{{ document.title }}</span>
      <span class="history-row-meta">{{ timeLabel }}</span>
    </span>
  </button>
</template>
