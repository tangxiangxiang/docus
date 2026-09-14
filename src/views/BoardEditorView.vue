<script setup lang="ts">
import { NButton } from 'naive-ui'
import { useRouter } from 'vue-router'
import { useI18n } from '../composables/useI18n'

const router = useRouter()
const { t } = useI18n()

function backToBoards(): void {
  void router.push({ name: 'board' })
}
</script>

<template>
  <div class="board-editor-placeholder" data-testid="board-editor-placeholder">
    <p class="board-editor-eyebrow">{{ t('board.workspace_label') }}</p>
    <h1>{{ t('board.editor_coming_soon') }}</h1>
    <p>{{ t('board.editor_coming_soon_detail') }}</p>
    <NButton attr-type="button" type="primary" @click="backToBoards">{{ t('board.back_to_boards') }}</NButton>
  </div>
</template>

<style scoped>
.board-editor-placeholder { display: grid; min-height: 100vh; box-sizing: border-box; place-content: center; justify-items: center; gap: 12px; padding: 32px; background: var(--bg); color: var(--text); text-align: center; }
.board-editor-placeholder h1 { margin: 0; color: var(--text-h); }
.board-editor-placeholder p { max-width: 520px; margin: 0; color: var(--text-muted); }
.board-editor-eyebrow { color: var(--accent) !important; font-size: .72rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
</style>
