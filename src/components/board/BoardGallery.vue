<script setup lang="ts">
import BoardCard from './BoardCard.vue'
import type { BoardMetadata } from '../../../shared/boardProtocol'

withDefaults(defineProps<{
  boards: readonly BoardMetadata[]
  compact?: boolean
  busyBoardIds?: readonly string[]
}>(), {
  compact: false,
  busyBoardIds: () => [],
})

const emit = defineEmits<{
  open: [board: BoardMetadata]
  rename: [board: BoardMetadata]
  delete: [board: BoardMetadata]
}>()
</script>

<template>
  <div :class="['board-gallery', { 'is-compact': compact }]">
    <BoardCard
      v-for="board in boards"
      :key="board.id"
      :board="board"
      :compact="compact"
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
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 270px), 1fr));
  gap: 16px;
}
.board-gallery.is-compact { grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); gap: 12px; }
</style>
