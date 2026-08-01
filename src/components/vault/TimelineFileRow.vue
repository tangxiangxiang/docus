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
    <span class="history-file-chevron-spacer" aria-hidden="true" />
    <span class="history-file-icon" aria-hidden="true" v-html="ICON_FILE_MD" />
    <span class="history-file-label">
      <span class="history-file-title">{{ file.title }}</span>
      <span v-if="showParent && file.parentPath" class="history-file-path">{{ file.parentPath }}/</span>
    </span>
  </button>
</template>
