<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NEmpty, NIcon, NInput, NModal, NResult, NSelect, type InputInst, type SelectOption } from 'naive-ui'
import { LayoutGrid, Plus, Search } from '@vicons/tabler'
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
import { useBoardFavorites } from '../composables/useBoardFavorites'
import { useConfirm } from '../composables/useConfirm'
import { useI18n } from '../composables/useI18n'
import { useToast } from '../composables/useToast'

const router = useRouter()
const { confirm } = useConfirm()
const { locale, t } = useI18n()
const toast = useToast()
const { favoriteBoardIds, isFavorite, setFavorite } = useBoardFavorites()
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

type BoardSortKey = 'updated' | 'name' | 'created'

const normalizedQuery = computed(() => query.value.trim().toLocaleLowerCase())
const filteredBoards = computed(() => {
  if (!normalizedQuery.value) return boards.value
  return boards.value.filter((board) => board.title.toLocaleLowerCase().includes(normalizedQuery.value))
})
const sortBy = ref<BoardSortKey>('name')
const sortOptions = computed<SelectOption[]>(() => [
  { label: t('board.sort_updated'), value: 'updated' },
  { label: t('board.sort_name'), value: 'name' },
  { label: t('board.sort_created'), value: 'created' },
])
const sortCollator = computed(() => new Intl.Collator(locale.value === 'zh' ? 'zh-CN' : 'en-US', {
  numeric: true,
  sensitivity: 'base',
}))
const sortedBoards = computed(() => [...filteredBoards.value].sort((left, right) => {
  if (sortBy.value === 'name') {
    return sortCollator.value.compare(left.title, right.title) || right.updatedAt - left.updatedAt
  }
  if (sortBy.value === 'created') {
    return right.createdAt - left.createdAt || right.updatedAt - left.updatedAt
  }
  return right.updatedAt - left.updatedAt || right.id.localeCompare(left.id)
}))
const recentBoardLimit = 5
const recentOrderedBoards = computed(() => [...boards.value]
  .sort((left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id))
)
const recentBoards = computed(() => recentOrderedBoards.value.slice(0, recentBoardLimit))
const favoriteBoards = computed(() => recentOrderedBoards.value.filter((board) => isFavorite(board.id)))
const favoriteBoardLimit = 5
const favoriteQuickExpanded = ref(false)
type QuickAccessTab = 'recent' | 'favorites'
const quickAccessTab = ref<QuickAccessTab>('recent')
const quickAccessBoards = computed(() => {
  if (quickAccessTab.value === 'recent' || favoriteQuickExpanded.value) return quickAccessTab.value === 'recent' ? recentBoards.value : favoriteBoards.value
  return favoriteBoards.value.slice(0, favoriteBoardLimit)
})
const hasMoreFavorites = computed(() => quickAccessTab.value === 'favorites' && !favoriteQuickExpanded.value && favoriteBoards.value.length > favoriteBoardLimit)
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

function toggleFavorite(board: BoardMetadata): void {
  const nextFavorite = !isFavorite(board.id)
  setFavorite(board.id, nextFavorite)
  toast.success(t(nextFavorite ? 'board.favorited' : 'board.unfavorited'))
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
    setFavorite(board.id, false)
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
    <div class="board-home-content">
      <header class="board-home-header">
        <div class="board-home-heading">
          <p class="board-home-eyebrow">{{ t('board.title') }}</p>
          <h1>{{ t('board.workspace_label') }}</h1>
          <p class="board-home-subtitle">{{ t('board.subtitle') }}</p>
        </div>
        <NButton
          class="board-new-button"
          attr-type="button"
          size="small"
          type="primary"
          :loading="mutationBoardIds.includes('__create__')"
          :disabled="mutationBoardIds.includes('__create__')"
          @click="newBoard"
        >
          <NIcon aria-hidden="true"><Plus /></NIcon>
          {{ t('board.new') }}
        </NButton>
      </header>

      <section v-if="loading && !hasBoards" class="board-loading" data-testid="board-loading" role="status" aria-live="polite" :aria-label="t('board.loading')">
        <div class="board-skeleton-recent" aria-hidden="true">
          <span v-for="index in 5" :key="index" class="board-skeleton-card">
            <span class="board-skeleton-preview" />
            <span class="board-skeleton-lines"><i /><i /><i /></span>
          </span>
        </div>
      </section>

      <section v-else-if="loadError && !hasBoards" class="board-state board-error" data-testid="board-error" role="alert">
        <NResult size="small" status="error" :title="t('board.load_failed')" :description="loadError">
          <template #footer>
            <NButton attr-type="button" size="small" type="primary" @click="loadBoards">{{ t('common.retry') }}</NButton>
          </template>
        </NResult>
      </section>

      <template v-else-if="hasBoards">
        <p v-if="loadError" class="board-inline-error" role="alert">{{ loadError }}</p>

        <section v-if="!hasSearch" class="board-section board-recent-section" aria-labelledby="board-quick-access-heading">
          <div class="board-section-heading">
            <h2 id="board-quick-access-heading">{{ t('board.quick_access') }}</h2>
            <div class="board-quick-tabs" role="tablist" :aria-label="t('board.quick_access')">
              <button
                class="board-quick-tab"
                :class="{ 'is-active': quickAccessTab === 'recent' }"
                type="button"
                role="tab"
                :aria-selected="quickAccessTab === 'recent'"
                data-testid="board-quick-tab-recent"
                @click="quickAccessTab = 'recent'"
              >
                {{ t('board.recent') }}
              </button>
              <button
                class="board-quick-tab"
                :class="{ 'is-active': quickAccessTab === 'favorites' }"
                type="button"
                role="tab"
                :aria-selected="quickAccessTab === 'favorites'"
                data-testid="board-quick-tab-favorites"
                @click="quickAccessTab = 'favorites'"
              >
                {{ t('board.favorites') }}
              </button>
            </div>
          </div>
          <div class="board-quick-content">
            <BoardGallery
              v-if="quickAccessBoards.length"
              layout="recent"
              :boards="quickAccessBoards"
              :favorite-board-ids="favoriteBoardIds"
              :busy-board-ids="mutationBoardIds"
              @open="openBoard"
              @favorite="toggleFavorite"
              @rename="openRename"
              @delete="removeBoard"
            />
            <div v-else class="board-quick-empty">
              <NEmpty size="small" :description="t('board.no_favorites')" />
            </div>
            <div class="board-quick-more">
              <NButton
                v-if="hasMoreFavorites"
                data-testid="board-quick-more-favorites"
                attr-type="button"
                size="small"
                quaternary
                type="primary"
                @click="favoriteQuickExpanded = true"
              >
                {{ t('board.view_more') }}
              </NButton>
            </div>
          </div>
        </section>

        <section id="board-all-section" class="board-section board-all-section" aria-labelledby="board-all-heading">
          <div class="board-section-heading board-all-section-heading">
            <h2 id="board-all-heading">{{ hasSearch ? t('board.search_results') : t('board.all_boards') }} <span class="board-count">{{ sortedBoards.length }}</span></h2>
            <div class="board-all-heading-controls">
              <NInput
                v-model:value="query"
                class="board-search-input board-all-search"
                clearable
                size="small"
                type="text"
                :placeholder="t('board.search_placeholder')"
                :input-props="{ 'aria-label': t('board.search_label'), autocomplete: 'off' }"
              >
                <template #prefix><NIcon aria-hidden="true"><Search /></NIcon></template>
              </NInput>
              <NSelect
                v-model:value="sortBy"
                class="board-sort-select"
                size="small"
                :options="sortOptions"
                :aria-label="t('board.sort_label')"
              />
            </div>
          </div>
          <BoardGallery
            v-if="sortedBoards.length"
            layout="grid"
            :boards="sortedBoards"
            :favorite-board-ids="favoriteBoardIds"
            :busy-board-ids="mutationBoardIds"
            @open="openBoard"
            @favorite="toggleFavorite"
            @rename="openRename"
            @delete="removeBoard"
          />
          <NEmpty v-else size="small" :description="t('board.no_results')" />
        </section>
      </template>

      <section v-else class="board-empty" data-testid="board-empty">
        <span class="board-empty-icon" aria-hidden="true"><NIcon><LayoutGrid /></NIcon></span>
        <h2>{{ t('board.empty') }}</h2>
        <p>{{ t('board.empty_detail') }}</p>
        <NButton attr-type="button" size="small" type="primary" @click="newBoard">
          <NIcon aria-hidden="true"><Plus /></NIcon>
          {{ t('board.create_first') }}
        </NButton>
      </section>
    </div>

    <NModal
      v-model:show="renameOpen"
      preset="dialog"
      size="small"
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
        size="small"
        :disabled="renameBusy"
        :placeholder="t('board.title_placeholder')"
        :input-props="{ 'aria-label': t('board.title_label'), autocomplete: 'off' }"
        @keydown.enter.prevent="submitRename"
      />
      <template #action>
        <NButton attr-type="button" size="small" :disabled="renameBusy" @click="closeRename">{{ t('common.cancel') }}</NButton>
        <NButton data-testid="board-rename-submit" attr-type="button" size="small" type="primary" :loading="renameBusy" @click="submitRename">{{ t('common.save') }}</NButton>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.board-home {
  min-height: calc(100vh - var(--navbar-h, 36px));
  box-sizing: border-box;
  padding: clamp(30px, 4vw, 56px) clamp(20px, 4vw, 64px) 72px;
  background: var(--bg);
  color: var(--text);
}
.board-home-content { width: min(100%, 1440px); margin: 0 auto; container-type: inline-size; }
.board-home-header {
  display: flex;
  margin: 0 0 24px;
  align-items: flex-start;
  justify-content: space-between;
  gap: 28px;
}
.board-home-heading { min-width: 0; }
.board-home-eyebrow { margin: 0 0 4px; color: var(--accent); font-size: .78rem; font-weight: 650; letter-spacing: .04em; }
.board-home-header h1 { margin: 0; color: var(--text-h); font-size: clamp(2.5rem, 4vw, 2.75rem); font-weight: 700; letter-spacing: -.035em; line-height: 1.1; }
.board-home-subtitle { margin: 8px 0 0; color: var(--text-muted); font-size: .92rem; line-height: 1.45; }
.board-new-button { border-radius: 9px; font-weight: 650; }
.board-new-button :deep(.n-icon) { margin-right: 2px; }
.board-search-input { width: min(100%, 780px); min-width: 0; flex: 0 1 780px; }
.board-search-input { border-radius: 10px; }
.board-search-input :deep(.n-input__prefix) { color: var(--text-muted); font-size: 19px; }
.board-search-input :deep(.n-input__input) { font-size: .9rem; }
.board-all-section-heading { align-items: center; }
.board-all-heading-controls { display: flex; min-width: 0; align-items: center; gap: 8px; }
.board-all-search { width: min(100%, 360px); flex: 0 1 360px; }
.board-sort-select { width: 148px; }
.board-sort-select :deep(.n-base-selection) { border-radius: 10px; }
.board-section { margin: 0 0 38px; }
.board-section-heading { display: flex; min-height: 34px; margin-bottom: 16px; align-items: center; justify-content: space-between; gap: 16px; }
.board-section-heading h2 { margin: 0; color: var(--text-h); font-size: 1.18rem; font-weight: 650; letter-spacing: -.02em; }
.board-count { margin-left: 5px; color: var(--text-muted); font-size: .82rem; font-weight: 500; }
.board-quick-tabs {
  display: inline-flex;
  height: 34px;
  box-sizing: border-box;
  padding: 2px;
  border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  border-radius: 9px;
  background: color-mix(in srgb, var(--bg-soft) 44%, transparent);
}
.board-quick-tab {
  min-width: 82px;
  padding: 5px 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: .82rem;
  cursor: pointer;
}
.board-quick-tab:hover { color: var(--text-h); }
.board-quick-tab.is-active {
  background: color-mix(in srgb, var(--accent) 10%, var(--bg));
  color: var(--accent);
  font-weight: 650;
}
.board-quick-tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.board-quick-content { min-height: calc(12.5cqi + 60px); }
.board-quick-empty { display: grid; min-height: inherit; box-sizing: border-box; place-items: center; border: 1px dashed color-mix(in srgb, var(--border) 78%, transparent); border-radius: 12px; }
.board-quick-empty :deep(.n-empty) { padding: 18px; }
.board-quick-more { display: grid; min-height: 32px; place-items: center; }
.board-state { display: grid; min-height: 300px; place-items: center; gap: 12px; margin: 0 auto; color: var(--text-muted); text-align: center; }
.board-error { max-width: 620px; place-items: stretch; text-align: left; }
.board-error :deep(.n-result) { padding: 0; }
.board-inline-error { margin: -12px 0 20px; color: var(--docus-negative, #b42318); font-size: .85rem; }
.board-empty {
  display: flex;
  min-height: 310px;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 8px;
  padding: 40px 20px;
  border: 1px dashed color-mix(in srgb, var(--border) 92%, transparent);
  border-radius: 16px;
  color: var(--text-muted);
  text-align: center;
}
.board-empty-icon { display: grid; width: 52px; height: 52px; margin-bottom: 6px; place-items: center; border-radius: 15px; background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--accent); font-size: 26px; }
.board-empty h2 { margin: 0; color: var(--text-h); font-size: 1.15rem; }
.board-empty p { margin: 0 0 10px; font-size: .85rem; }
.board-loading { display: grid; gap: 32px; }
.board-skeleton-recent { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 16px; }
.board-skeleton-card { display: grid; min-width: 0; overflow: hidden; box-sizing: border-box; border: 1px solid color-mix(in srgb, var(--border) 80%, transparent); border-radius: 14px; background: var(--bg); }
.board-skeleton-preview { width: calc(100% - 24px); margin: 12px 12px 0; aspect-ratio: 16 / 10; border-radius: 11px; background: var(--bg-soft); }
.board-skeleton-lines { display: grid; gap: 9px; padding: 13px 14px 16px; border-top: 1px solid color-mix(in srgb, var(--border) 74%, transparent); }
.board-skeleton-lines i { display: block; height: 10px; border-radius: 5px; background: var(--bg-soft); }
.board-skeleton-lines i:first-child { width: 76%; height: 14px; }
.board-skeleton-lines i:last-child { width: 48%; }
@keyframes board-skeleton-pulse { 0%, 100% { background-position: 100% 0; } 50% { background-position: 0 0; } }
@media (max-width: 1279px) {
  .board-quick-content { min-height: calc(15.625cqi + 58px); }
  .board-skeleton-recent { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@media (max-width: 1023px) {
  .board-quick-content { min-height: calc(20.833cqi + 56px); }
  .board-skeleton-recent { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 767px) {
  .board-quick-content { min-height: calc(31.25cqi + 69px); }
  .board-skeleton-recent { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 600px) {
  .board-home { padding-top: 28px; }
  .board-home-header { align-items: stretch; flex-direction: column; }
  .board-home-subtitle { max-width: 32rem; }
  .board-new-button { align-self: stretch; }
  .board-all-section-heading { align-items: stretch; flex-direction: column; gap: 10px; }
  .board-all-heading-controls { width: 100%; }
  .board-all-search { width: auto; flex: 1 1 auto; }
  .board-skeleton-recent { display: flex; overflow-x: hidden; }
  .board-skeleton-card { flex: 0 0 calc((100% - 18px) / 2); }
}
</style>
