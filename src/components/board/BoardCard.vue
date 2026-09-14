<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NDropdown, type DropdownOption } from 'naive-ui'
import type { BoardMetadata } from '../../../shared/boardProtocol'
import { boardAssetUrl } from '../../features/board/api'
import { useI18n } from '../../composables/useI18n'

const props = withDefaults(defineProps<{
  board: BoardMetadata
  compact?: boolean
  busy?: boolean
}>(), {
  compact: false,
  busy: false,
})

const emit = defineEmits<{
  open: [board: BoardMetadata]
  rename: [board: BoardMetadata]
  delete: [board: BoardMetadata]
}>()

const { t } = useI18n()
const thumbnailFailed = ref(false)
const menuOptions = computed<DropdownOption[]>(() => [
  { label: t('board.rename'), key: 'rename' },
  { label: t('board.delete'), key: 'delete' },
])
const thumbnailUrl = computed(() => props.board.thumbnailAssetId
  ? boardAssetUrl(props.board.thumbnailAssetId)
  : '')
const updatedLabel = computed(() => {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(props.board.updatedAt))
  } catch {
    return String(props.board.updatedAt)
  }
})

watch(() => props.board.thumbnailAssetId, () => { thumbnailFailed.value = false })

function selectMenu(key: string | number): void {
  if (key === 'rename') emit('rename', props.board)
  if (key === 'delete') emit('delete', props.board)
}
</script>

<template>
  <article :class="['board-card', { 'is-compact': compact, 'is-busy': busy }]" :data-board-id="board.id">
    <button
      class="board-card-open"
      type="button"
      :aria-label="t('board.open', { title: board.title })"
      :disabled="busy"
      @click="emit('open', board)"
    >
      <span class="board-card-thumbnail" aria-hidden="true">
        <img
          v-if="thumbnailUrl && !thumbnailFailed"
          :src="thumbnailUrl"
          :alt="t('board.thumbnail_alt', { title: board.title })"
          loading="lazy"
          @error="thumbnailFailed = true"
        />
        <span v-else class="board-card-placeholder">{{ board.title.slice(0, 1).toUpperCase() || 'B' }}</span>
      </span>
      <span class="board-card-copy">
        <strong class="board-card-title" data-testid="board-card-title">{{ board.title }}</strong>
        <span class="board-card-updated">{{ t('board.updated', { date: updatedLabel }) }}</span>
      </span>
    </button>
    <NDropdown :options="menuOptions" trigger="click" @select="selectMenu">
      <NButton
        class="board-card-menu"
        attr-type="button"
        quaternary
        :bordered="false"
        :disabled="busy"
        :aria-label="t('board.card_menu', { title: board.title })"
        :title="t('board.card_menu', { title: board.title })"
        @click.stop
      >
        <span aria-hidden="true">⋯</span>
      </NButton>
    </NDropdown>
  </article>
</template>

<style scoped>
.board-card {
  position: relative;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg);
  box-shadow: 0 2px 8px rgb(15 23 42 / 4%);
  transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease;
}
.board-card:hover,
.board-card:focus-within {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  box-shadow: 0 8px 20px rgb(15 23 42 / 9%);
  transform: translateY(-1px);
}
.board-card.is-busy { opacity: .64; }
.board-card-open {
  display: flex;
  width: 100%;
  min-width: 0;
  gap: 14px;
  align-items: center;
  padding: 14px;
  border: 0;
  border-radius: inherit;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.board-card-open:disabled { cursor: default; }
.board-card-thumbnail {
  display: grid;
  flex: 0 0 96px;
  width: 96px;
  height: 72px;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 18%, var(--bg-soft)), var(--bg-soft));
  color: var(--accent);
  font-size: 1.65rem;
  font-weight: 700;
}
.board-card.is-compact .board-card-thumbnail {
  flex-basis: 72px;
  width: 72px;
  height: 56px;
  font-size: 1.2rem;
}
.board-card-thumbnail img { display: block; width: 100%; height: 100%; object-fit: cover; }
.board-card-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 3px; padding-right: 28px; }
.board-card-title { overflow: hidden; color: var(--text-h); font-size: .98rem; text-overflow: ellipsis; white-space: nowrap; }
.board-card-updated { overflow: hidden; color: var(--text-muted); font-size: .75rem; text-overflow: ellipsis; white-space: nowrap; }
.board-card-menu { position: absolute; top: 8px; right: 8px; min-width: 28px; min-height: 28px; padding: 0 6px; color: var(--text-muted); }
.board-card-menu span { display: block; transform: translateY(-3px); font-size: 1.25rem; line-height: 1; letter-spacing: 2px; }
@media (max-width: 600px) {
  .board-card-thumbnail { flex-basis: 72px; width: 72px; height: 60px; }
  .board-card-open { gap: 10px; padding: 12px; }
}
</style>
