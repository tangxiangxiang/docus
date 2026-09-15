<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NEmpty, NIcon, NInput, NModal, NResult, NSelect, type InputInst, type SelectOption } from 'naive-ui'
import { ArrowRight, Clock, LayoutGrid, List, Plus, Search } from '@vicons/tabler'
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
const { locale, t } = useI18n()
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

type BoardSortKey = 'updated' | 'name' | 'created'

const normalizedQuery = computed(() => query.value.trim().toLocaleLowerCase())
const filteredBoards = computed(() => {
  if (!normalizedQuery.value) return boards.value
  return boards.value.filter((board) => board.title.toLocaleLowerCase().includes(normalizedQuery.value))
})
const sortBy = ref<BoardSortKey>('updated')
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
const recentBoardLimit = 2
const recentBoards = computed(() => sortedBoards.value.slice(0, recentBoardLimit))
const hasBoards = computed(() => boards.value.length > 0)
const hasSearch = computed(() => normalizedQuery.value.length > 0)
const hasMoreRecentBoards = computed(() => !hasSearch.value && boards.value.length > recentBoardLimit)
const recentBoardCount = computed(() => Math.min(boards.value.length, recentBoardLimit))

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
    <div class="board-home-content">
      <header class="board-home-header">
        <div class="board-home-heading">
          <p class="board-home-eyebrow">{{ t('board.workspace_label') }}</p>
          <h1>{{ t('board.title') }}</h1>
          <p class="board-home-subtitle">{{ t('board.subtitle') }}</p>
        </div>
        <NButton
          class="board-new-button"
          attr-type="button"
          type="primary"
          :loading="mutationBoardIds.includes('__create__')"
          :disabled="mutationBoardIds.includes('__create__')"
          @click="newBoard"
        >
          <NIcon aria-hidden="true"><Plus /></NIcon>
          {{ t('board.new') }}
        </NButton>
      </header>

      <div class="board-toolbar" data-testid="board-toolbar">
        <NInput
          v-model:value="query"
          class="board-search-input"
          clearable
          size="large"
          type="text"
          :placeholder="t('board.search_placeholder')"
          :input-props="{ 'aria-label': t('board.search_label'), autocomplete: 'off' }"
        >
          <template #prefix><NIcon aria-hidden="true"><Search /></NIcon></template>
        </NInput>
        <div class="board-toolbar-controls">
          <NSelect
            v-model:value="sortBy"
            class="board-sort-select"
            size="large"
            :options="sortOptions"
            :aria-label="t('board.sort_label')"
          />
          <div class="board-view-toggle" role="group" :aria-label="t('board.view_label')">
            <NButton
              class="board-view-button is-selected"
              attr-type="button"
              quaternary
              :bordered="false"
              :aria-label="t('board.view_grid')"
              aria-pressed="true"
              data-testid="board-grid-view"
            >
              <NIcon aria-hidden="true"><LayoutGrid /></NIcon>
            </NButton>
            <NButton
              class="board-view-button"
              attr-type="button"
              quaternary
              :bordered="false"
              disabled
              :aria-label="t('board.view_list_unavailable')"
              aria-pressed="false"
              :title="t('board.view_list_unavailable')"
              data-testid="board-list-view"
            >
              <NIcon aria-hidden="true"><List /></NIcon>
            </NButton>
          </div>
        </div>
      </div>

      <div v-if="!loading && (!loadError || hasBoards)" class="board-summary" :aria-label="t('board.summary_label')">
        <article class="board-summary-card" data-testid="board-summary-all">
          <span class="board-summary-icon" aria-hidden="true"><NIcon><LayoutGrid /></NIcon></span>
          <span class="board-summary-copy">
            <span class="board-summary-label">{{ t('board.summary_all') }}</span>
            <strong>{{ boards.length }}</strong>
          </span>
        </article>
        <article class="board-summary-card" data-testid="board-summary-recent">
          <span class="board-summary-icon" aria-hidden="true"><NIcon><Clock /></NIcon></span>
          <span class="board-summary-copy">
            <span class="board-summary-label">{{ t('board.summary_recent') }}</span>
            <strong>{{ recentBoardCount }}</strong>
          </span>
        </article>
      </div>

      <section v-if="loading && !hasBoards" class="board-loading" data-testid="board-loading" role="status" aria-live="polite" :aria-label="t('board.loading')">
        <div class="board-skeleton-summary" aria-hidden="true">
          <span v-for="index in 2" :key="index" class="board-skeleton-summary-card" />
        </div>
        <div class="board-skeleton-recent" aria-hidden="true">
          <span v-for="index in 2" :key="index" class="board-skeleton-card">
            <span class="board-skeleton-preview" />
            <span class="board-skeleton-lines"><i /><i /><i /></span>
          </span>
        </div>
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

        <section v-if="!hasSearch" class="board-section board-recent-section" aria-labelledby="board-recent-heading">
          <div class="board-section-heading">
            <h2 id="board-recent-heading">{{ t('board.recent') }}</h2>
            <a v-if="hasMoreRecentBoards" class="board-section-link" href="#board-all-section">
              {{ t('board.view_all') }}
              <NIcon aria-hidden="true"><ArrowRight /></NIcon>
            </a>
          </div>
          <BoardGallery
            layout="recent"
            :boards="recentBoards"
            :busy-board-ids="mutationBoardIds"
            @open="openBoard"
            @rename="openRename"
            @delete="removeBoard"
          />
        </section>

        <section id="board-all-section" class="board-section board-all-section" aria-labelledby="board-all-heading">
          <div class="board-section-heading">
            <h2 id="board-all-heading">{{ hasSearch ? t('board.search_results') : t('board.all_boards') }} <span class="board-count">{{ sortedBoards.length }}</span></h2>
          </div>
          <BoardGallery
            v-if="sortedBoards.length"
            layout="grid"
            :boards="sortedBoards"
            :busy-board-ids="mutationBoardIds"
            @open="openBoard"
            @rename="openRename"
            @delete="removeBoard"
          />
          <NEmpty v-else :description="t('board.no_results')" />
        </section>
      </template>

      <section v-else class="board-empty" data-testid="board-empty">
        <span class="board-empty-icon" aria-hidden="true"><NIcon><LayoutGrid /></NIcon></span>
        <h2>{{ t('board.empty') }}</h2>
        <p>{{ t('board.empty_detail') }}</p>
        <NButton attr-type="button" type="primary" @click="newBoard">
          <NIcon aria-hidden="true"><Plus /></NIcon>
          {{ t('board.create_first') }}
        </NButton>
      </section>
    </div>

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
.board-home {
  min-height: calc(100vh - var(--navbar-h, 36px));
  box-sizing: border-box;
  padding: clamp(30px, 4vw, 56px) clamp(20px, 4vw, 64px) 72px;
  background:
    radial-gradient(circle at 86% 0%, color-mix(in srgb, var(--accent) 6%, transparent), transparent 28rem),
    var(--bg);
  color: var(--text);
}
.board-home-content { width: min(100%, 1440px); margin: 0 auto; }
.board-home-header {
  display: flex;
  margin: 0 0 28px;
  align-items: flex-start;
  justify-content: space-between;
  gap: 28px;
}
.board-home-heading { min-width: 0; }
.board-home-eyebrow { margin: 0 0 4px; color: var(--accent); font-size: .8rem; font-weight: 650; letter-spacing: .04em; }
.board-home-header h1 { margin: 0; color: var(--text-h); font-size: clamp(2.35rem, 4vw, 3rem); font-weight: 700; letter-spacing: -.035em; line-height: 1.12; }
.board-home-subtitle { margin: 9px 0 0; color: var(--text-muted); font-size: .94rem; line-height: 1.5; }
.board-new-button { min-height: 46px; padding-inline: 18px; border-radius: 11px; font-size: .9rem; font-weight: 650; }
.board-new-button :deep(.n-icon) { margin-right: 2px; font-size: 18px; }
.board-toolbar {
  display: flex;
  min-width: 0;
  margin-bottom: 20px;
  align-items: center;
  gap: 14px;
}
.board-search-input { min-width: 0; flex: 1; }
.board-search-input :deep(.n-input) { border-radius: 11px; }
.board-search-input :deep(.n-input__prefix) { color: var(--text-muted); font-size: 20px; }
.board-toolbar-controls { display: flex; flex: 0 0 auto; align-items: center; gap: 12px; }
.board-sort-select { width: 154px; }
.board-sort-select :deep(.n-base-selection) { border-radius: 11px; }
.board-view-toggle {
  display: inline-flex;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--bg-soft);
}
.board-view-button { min-width: 38px; height: 38px; padding: 0; border-radius: 8px; color: var(--text-muted); }
.board-view-button.is-selected { background: color-mix(in srgb, var(--accent) 11%, var(--bg)); color: var(--accent); }
.board-view-button:disabled { opacity: .55; }
.board-summary {
  display: grid;
  max-width: 850px;
  margin-bottom: 32px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.board-summary-card {
  display: flex;
  min-height: 68px;
  box-sizing: border-box;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
  border-radius: 13px;
  background: color-mix(in srgb, var(--bg-soft) 58%, transparent);
}
.board-summary-icon {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
  font-size: 19px;
}
.board-summary-copy { display: grid; min-width: 0; gap: 1px; }
.board-summary-label { overflow: hidden; color: var(--text-muted); font-size: .78rem; text-overflow: ellipsis; white-space: nowrap; }
.board-summary-copy strong { color: var(--text-h); font-size: 1.15rem; line-height: 1.2; }
.board-section { margin: 0 0 42px; }
.board-section-heading { display: flex; min-height: 30px; margin-bottom: 14px; align-items: center; justify-content: space-between; gap: 16px; }
.board-section-heading h2 { margin: 0; color: var(--text-h); font-size: 1.22rem; font-weight: 700; letter-spacing: -.02em; }
.board-count { margin-left: 5px; color: var(--text-muted); font-size: .82rem; font-weight: 500; }
.board-section-link { display: inline-flex; align-items: center; gap: 5px; color: var(--accent); font-size: .8rem; text-decoration: none; }
.board-section-link:hover { color: var(--accent-hover); text-decoration: none; }
.board-section-link :deep(.n-icon) { font-size: 15px; }
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
.board-loading { display: grid; gap: 28px; }
.board-skeleton-summary { display: grid; max-width: 850px; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.board-skeleton-summary-card { height: 68px; border-radius: 13px; background: linear-gradient(90deg, var(--bg-soft), color-mix(in srgb, var(--border) 35%, var(--bg-soft)), var(--bg-soft)); background-size: 220% 100%; animation: board-skeleton-pulse 1.4s ease-in-out infinite; }
.board-skeleton-recent { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.board-skeleton-card { display: flex; min-height: 164px; box-sizing: border-box; align-items: center; gap: 18px; padding: 12px; border: 1px solid var(--border); border-radius: 16px; background: var(--bg); }
.board-skeleton-preview { width: 38%; aspect-ratio: 16 / 10; border-radius: 11px; background: var(--bg-soft); }
.board-skeleton-lines { display: grid; flex: 1; gap: 9px; }
.board-skeleton-lines i { display: block; height: 10px; border-radius: 5px; background: var(--bg-soft); }
.board-skeleton-lines i:first-child { width: 76%; height: 14px; }
.board-skeleton-lines i:last-child { width: 48%; }
@keyframes board-skeleton-pulse { 0%, 100% { background-position: 100% 0; } 50% { background-position: 0 0; } }
@media (max-width: 600px) {
  .board-home { padding-top: 28px; }
  .board-home-header { align-items: stretch; flex-direction: column; }
  .board-home-subtitle { max-width: 32rem; }
  .board-new-button { align-self: stretch; }
  .board-toolbar { align-items: stretch; flex-direction: column; }
  .board-toolbar-controls { justify-content: space-between; }
  .board-sort-select { flex: 1; width: auto; }
  .board-summary { grid-template-columns: 1fr; }
  .board-skeleton-summary,
  .board-skeleton-recent { grid-template-columns: 1fr; }
}
</style>
