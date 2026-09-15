<script setup lang="ts">
import { computed } from 'vue'
import BoardCard from './BoardCard.vue'
import type { BoardMetadata } from '../../../shared/boardProtocol'

type BoardGalleryLayout = 'recent' | 'grid'

const props = withDefaults(defineProps<{
  boards: readonly BoardMetadata[]
  layout?: BoardGalleryLayout
  /** Compatibility alias for callers that used the original compact prop. */
  compact?: boolean
  busyBoardIds?: readonly string[]
}>(), {
  layout: undefined,
  compact: false,
  busyBoardIds: () => [],
})

const layout = computed<BoardGalleryLayout>(() => props.layout ?? (props.compact ? 'grid' : 'recent'))

const emit = defineEmits<{
  open: [board: BoardMetadata]
  rename: [board: BoardMetadata]
  delete: [board: BoardMetadata]
}>()
</script>

<template>
  <div :class="['board-gallery', `is-${layout}`]">
    <BoardCard
      v-for="board in boards"
      :key="board.id"
      :board="board"
      :layout="layout"
      :busy="busyBoardIds.includes(board.id)"
      @open="emit('open', $event)"
      @rename="emit('rename', $event)"
      @delete="emit('delete', $event)"
    />
  </div>
</template>

<style scoped>
.board-gallery {
  display: grid;
  min-width: 0;
  gap: 18px;
}
.board-gallery.is-recent { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.board-gallery.is-grid { grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); gap: 18px; }
@media (max-width: 760px) {
  .board-gallery.is-recent { grid-template-columns: 1fr; }
}
</style>
