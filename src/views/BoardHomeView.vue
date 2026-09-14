<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NEmpty, NInput, NModal, NResult, NSpin, type InputInst } from 'naive-ui'
import BoardGallery from '../components/board/BoardGallery.vue'
import {
  BoardApiError,
  createBoard,
  deleteBoard,
  renameBoard,
} from '../features/board/api'
import { createIndexedDbBoardCheckpointStore } from '../features/board/checkpointStore'
import { boardMetadataSource } from '../features/board/boardMetadataSource'
import type { BoardMetadata } from '../../shared/boardProtocol'
import { useConfirm } from '../composables/useConfirm'
import { useI18n } from '../composables/useI18n'
import { useToast } from '../composables/useToast'

const router = useRouter()
const { confirm } = useConfirm()
const { t } = useI18n()
const toast = useToast()
const boards = computed(() => boardMetadataSource.getSnapshot())
const query = ref('')
const loading = ref(false)
const loadError = ref('')
const mutationBoardIds = ref<string[]>([])
const renameOpen = ref(false)
const renameBusy = ref(false)
const renameTitle = ref('')
const renameTarget = ref<BoardMetadata | null>(null)
const renameInput = ref<InputInst | null>(null)
const recoveryStore = createIndexedDbBoardCheckpointStore()

const normalizedQuery = computed(() => query.value.trim().toLocaleLowerCase())
const filteredBoards = computed(() => {
  if (!normalizedQuery.value) return boards.value
  return boards.value.filter((board) => board.title.toLocaleLowerCase().includes(normalizedQuery.value))
})
const recentBoards = computed(() => filteredBoards.value.slice(0, 6))
const hasBoards = computed(() => boards.value.length > 0)
const hasSearch = computed(() => normalizedQuery.value.length > 0)

function messageFor(error: unknown, fallback: string): string {
  return error instanceof BoardApiError && error.message.trim() ? error.message : fallback
}

function invalidateIfUncertain(error: unknown): void {
  if (error instanceof BoardApiError && error.uncertain) boardMetadataSource.invalidate()
}

async function loadBoards(): Promise<void> {
  if (loading.value) return
  loading.value = true
  loadError.value = ''
  try {
    await boardMetadataSource.ensureLoaded()
  } catch (error) {
    loadError.value = messageFor(error, t('board.load_failed'))
  } finally {
    loading.value = false
  }
}

onMounted(() => { void loadBoards() })

function setMutationBusy(boardId: string, busy: boolean): void {
  mutationBoardIds.value = busy
    ? [...new Set([...mutationBoardIds.value, boardId])]
    : mutationBoardIds.value.filter((id) => id !== boardId)
}

async function newBoard(): Promise<void> {
  if (mutationBoardIds.value.includes('__create__')) return
  setMutationBusy('__create__', true)
  try {
    const aggregate = await createBoard()
    boardMetadataSource.upsert(aggregate.metadata)
    toast.success(t('board.created'))
    await router.push({ name: 'board-editor', params: { boardId: aggregate.metadata.id } })
  } catch (error) {
    invalidateIfUncertain(error)
    toast.error(messageFor(error, t('board.create_failed')))
  } finally {
    setMutationBusy('__create__', false)
  }
}

function openBoard(board: BoardMetadata): void {
  void router.push({ name: 'board-editor', params: { boardId: board.id } })
}

async function submitRename(): Promise<void> {
  const target = renameTarget.value
  if (!target || renameBusy.value) return
  renameBusy.value = true
  setMutationBusy(target.id, true)
  try {
    const updated = await renameBoard(target.id, renameTitle.value)
    boardMetadataSource.upsert(updated)
    renameOpen.value = false
    toast.success(t('board.renamed'))
  } catch (error) {
    invalidateIfUncertain(error)
    toast.error(messageFor(error, t('board.rename_failed')))
  } finally {
    renameBusy.value = false
    setMutationBusy(target.id, false)
  }
}

function openRename(board: BoardMetadata): void {
  renameTarget.value = board
  renameTitle.value = board.title
  renameOpen.value = true
  void nextTick(() => renameInput.value?.focus())
}

function closeRename(): void {
  if (renameBusy.value) return
  renameOpen.value = false
  renameTarget.value = null
}

async function removeBoard(board: BoardMetadata): Promise<void> {
  if (mutationBoardIds.value.includes(board.id)) return
  const confirmed = await confirm(
    t('board.delete_title', { title: board.title }),
    t('board.delete_detail'),
    { destructive: true },
  )
  if (!confirmed) return

  setMutationBusy(board.id, true)
  try {
    await deleteBoard(board.id)
    boardMetadataSource.remove(board.id)
    try {
      await recoveryStore.clearBoardRecovery(board.id)
    } catch {
      toast.error(t('board.recovery_cleanup_failed'))
    }
    toast.success(t('board.deleted'))
  } catch (error) {
    invalidateIfUncertain(error)
    toast.error(messageFor(error, t('board.delete_failed')))
  } finally {
    setMutationBusy(board.id, false)
  }
}
</script>

<template>
  <div class="board-home" data-testid="board-home">
    <header class="board-home-header">
      <div>
        <p class="board-home-eyebrow">{{ t('board.workspace_label') }}</p>
        <h1>{{ t('board.title') }}</h1>
      </div>
      <NButton
        class="board-new-button"
        attr-type="button"
        type="primary"
        :loading="mutationBoardIds.includes('__create__')"
        :disabled="mutationBoardIds.includes('__create__')"
        @click="newBoard"
      >
        + {{ t('board.new') }}
      </NButton>
    </header>

    <div class="board-home-search">
      <NInput
        v-model:value="query"
        clearable
        type="text"
        :placeholder="t('board.search_placeholder')"
        :input-props="{ 'aria-label': t('board.search_label'), autocomplete: 'off' }"
      />
    </div>

    <section v-if="loading && !hasBoards" class="board-state board-loading" data-testid="board-loading" role="status" aria-live="polite">
      <NSpin size="medium" />
      <span>{{ t('board.loading') }}</span>
    </section>

    <section v-else-if="loadError && !hasBoards" class="board-state board-error" data-testid="board-error" role="alert">
      <NResult status="error" :title="t('board.load_failed')" :description="loadError">
        <template #footer>
          <NButton attr-type="button" type="primary" @click="loadBoards">{{ t('common.retry') }}</NButton>
        </template>
      </NResult>
    </section>

    <template v-else-if="hasBoards">
      <p v-if="loadError" class="board-inline-error" role="alert">{{ loadError }}</p>

      <section v-if="!hasSearch" class="board-section" aria-labelledby="board-recent-heading">
        <div class="board-section-heading">
          <h2 id="board-recent-heading">{{ t('board.recent') }}</h2>
        </div>
        <BoardGallery
          :boards="recentBoards"
          :busy-board-ids="mutationBoardIds"
          @open="openBoard"
          @rename="openRename"
          @delete="removeBoard"
        />
      </section>

      <section class="board-section" aria-labelledby="board-all-heading">
        <div class="board-section-heading">
          <h2 id="board-all-heading">{{ hasSearch ? t('board.search_results') : t('board.all_boards') }}</h2>
          <span class="board-count">{{ filteredBoards.length }}</span>
        </div>
        <BoardGallery
          v-if="filteredBoards.length"
          :boards="filteredBoards"
          compact
          :busy-board-ids="mutationBoardIds"
          @open="openBoard"
          @rename="openRename"
          @delete="removeBoard"
        />
        <NEmpty v-else :description="t('board.no_results')" />
      </section>
    </template>

    <section v-else class="board-state board-empty" data-testid="board-empty">
      <NEmpty :description="t('board.empty')">
        <template #extra>
          <NButton attr-type="button" type="primary" @click="newBoard">{{ t('board.create_first') }}</NButton>
        </template>
      </NEmpty>
    </section>

    <NModal
      v-model:show="renameOpen"
      preset="dialog"
      :title="t('board.rename_title')"
      :show-icon="false"
      :closable="!renameBusy"
      :mask-closable="!renameBusy"
      :close-on-esc="!renameBusy"
      :on-mask-click="closeRename"
    >
      <NInput
        ref="renameInput"
        v-model:value="renameTitle"
        :disabled="renameBusy"
        :placeholder="t('board.title_placeholder')"
        :input-props="{ 'aria-label': t('board.title_label'), autocomplete: 'off' }"
        @keydown.enter.prevent="submitRename"
      />
      <template #action>
        <NButton attr-type="button" :disabled="renameBusy" @click="closeRename">{{ t('common.cancel') }}</NButton>
        <NButton data-testid="board-rename-submit" attr-type="button" type="primary" :loading="renameBusy" @click="submitRename">{{ t('common.save') }}</NButton>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.board-home { min-height: calc(100vh - 36px); box-sizing: border-box; padding: 34px clamp(18px, 4vw, 64px) 64px; background: var(--bg); color: var(--text); }
.board-home-header { display: flex; max-width: 1180px; margin: 0 auto 28px; align-items: flex-end; justify-content: space-between; gap: 20px; }
.board-home-eyebrow { margin: 0 0 4px; color: var(--accent); font-size: .72rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
h1 { margin: 0; color: var(--text-h); font-size: clamp(1.55rem, 3vw, 2.15rem); line-height: 1.2; }
.board-new-button { min-height: 36px; }
.board-home-search { max-width: 1180px; margin: 0 auto 36px; }
.board-home-search :deep(.n-input) { max-width: 430px; }
.board-section { max-width: 1180px; margin: 0 auto 38px; }
.board-section-heading { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; }
.board-section-heading h2 { margin: 0; color: var(--text-h); font-size: 1.1rem; }
.board-count { color: var(--text-muted); font-size: .78rem; }
.board-state { display: grid; min-height: 300px; place-items: center; gap: 12px; margin: 0 auto; color: var(--text-muted); text-align: center; }
.board-error { max-width: 620px; place-items: stretch; text-align: left; }
.board-error :deep(.n-result) { padding: 0; }
.board-inline-error { max-width: 1180px; margin: -16px auto 20px; color: var(--docus-negative, #b42318); font-size: .85rem; }
.board-empty :deep(.n-empty) { transform: translateY(-12px); }
@media (max-width: 600px) {
  .board-home { padding-top: 24px; }
  .board-home-header { align-items: flex-start; flex-direction: column; }
  .board-new-button { align-self: stretch; }
}
</style>
