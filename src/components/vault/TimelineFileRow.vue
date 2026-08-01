<script setup lang="ts">
import type { HistoryFileItem } from '../../composables/vault/useHistoryTimeline'
import { ICON_FILE_MD } from './icons'

defineProps<{
  file: HistoryFileItem
  selected?: boolean
  showParent?: boolean
}>()

const emit = defineEmits<{ select: [] }>()

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter') return
  event.preventDefault()
  emit('select')
}
</script>

<template>
  <button
    type="button"
    class="history-file-row"
    :class="{ active: selected }"
    data-history-row
    role="treeitem"
    aria-level="3"
    :aria-selected="selected ? 'true' : 'false'"
    :title="file.path"
    @click="emit('select')"
    @keydown="onKeydown"
  >
    <span class="history-row-icon" v-html="ICON_FILE_MD" />
    <span class="history-file-copy">
      <span class="history-row-title">{{ file.title }}</span>
      <span v-if="showParent && file.parentPath" class="history-row-meta">{{ file.parentPath }}</span>
    </span>
  </button>
</template>
