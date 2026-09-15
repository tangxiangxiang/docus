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
  favoriteBoardIds?: readonly string[]
  busyBoardIds?: readonly string[]
}>(), {
  layout: undefined,
  compact: false,
  favoriteBoardIds: () => [],
  busyBoardIds: () => [],
})

const layout = computed<BoardGalleryLayout>(() => props.layout ?? (props.compact ? 'grid' : 'recent'))

const emit = defineEmits<{
  open: [board: BoardMetadata]
  favorite: [board: BoardMetadata]
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
      :favorite="favoriteBoardIds.includes(board.id)"
      :busy="busyBoardIds.includes(board.id)"
      @open="emit('open', $event)"
      @favorite="emit('favorite', $event)"
      @rename="emit('rename', $event)"
      @delete="emit('delete', $event)"
    />
  </div>
</template>

<style scoped>
.board-gallery {
  display: grid;
  min-width: 0;
  gap: 16px;
}
.board-gallery.is-grid,
.board-gallery.is-recent { grid-template-columns: repeat(5, minmax(0, 1fr)); }
@media (max-width: 1279px) {
  .board-gallery.is-grid,
  .board-gallery.is-recent { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@media (max-width: 1023px) {
  .board-gallery.is-grid,
  .board-gallery.is-recent { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 767px) {
  .board-gallery.is-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .board-gallery.is-recent {
    display: flex;
    overflow-x: auto;
    padding-bottom: 4px;
    scrollbar-width: thin;
  }
  .board-gallery.is-recent > .board-card {
    flex: 0 0 calc((100% - 16px) / 2);
  }
}
@media (max-width: 600px) {
  .board-gallery.is-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
