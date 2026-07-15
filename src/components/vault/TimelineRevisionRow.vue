<script setup lang="ts">
import type { TimelineRevision } from '../../composables/vault/useHistoryTimeline'

defineProps<{
  revision: TimelineRevision
  timeLabel: string
  summary: string
  selected?: boolean
}>()

const emit = defineEmits<{ select: [revision: TimelineRevision] }>()
</script>

<template>
  <button
    type="button"
    class="document-row history-revision-row"
    :class="{ active: selected }"
    role="option"
    :aria-selected="selected ? 'true' : 'false'"
    @click="emit('select', revision)"
    @keydown.enter.prevent="emit('select', revision)"
  >
    <span class="history-revision-marker" aria-hidden="true" />
    <span class="history-row-copy">
      <span class="history-row-title">{{ summary }}</span>
      <span class="history-row-meta">{{ timeLabel }}</span>
    </span>
  </button>
</template>
