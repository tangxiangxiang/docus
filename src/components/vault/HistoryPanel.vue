<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, toRef, watch } from 'vue'
import type { PostSummary } from '../../lib/api'
import type { HistoryState } from '../../composables/vault/useHistory'
import type { HistoryCommitState } from '../../composables/vault/useHistoryCommit'
import type { HistoryWithdrawState } from '../../composables/vault/useHistoryWithdraw'
import {
  toHistoryRevisionSelection,
  useHistoryTimeline,
  type DocumentHistory,
  type TimelineRevision,
} from '../../composables/vault/useHistoryTimeline'
import type { HistoryRevisionSelection } from '../../composables/vault/useHistorySnapshots'
import { useI18n } from '../../composables/useI18n'
import { ICON_CHEVRON, ICON_FILE_MD } from './icons'
import EmptyState from './EmptyState.vue'
import HistoryChangesPanel from './HistoryChangesPanel.vue'
import TimelineDocumentRow from './TimelineDocumentRow.vue'
import TimelineGroup from './TimelineGroup.vue'
import TimelineRevisionRow from './TimelineRevisionRow.vue'

const props = withDefaults(defineProps<{
  history: HistoryState
  commit: HistoryCommitState
  withdraw: HistoryWithdrawState
  posts?: PostSummary[]
}>(), {
  posts: () => [],
})
const emit = defineEmits<{
  'open-revision': [selection: HistoryRevisionSelection]
}>()

const h = props.history
const commit = props.commit
const { locale, t } = useI18n()
const listbox = ref<HTMLElement | null>(null)
const timelineHeading = ref<HTMLElement | null>(null)
const revisionMenu = ref<HTMLElement | null>(null)
const revisionMenuOpen = ref(false)
const revisionMenuX = ref(0)
const revisionMenuY = ref(0)
const revisionMenuRevision = ref<TimelineRevision | null>(null)
let revisionMenuOrigin: HTMLElement | null = null

const timelineLabels = computed(() => ({
  today: t('history.today'),
  yesterday: t('history.yesterday'),
  lastWeek: t('history.last_week'),
  earlier: t('history.earlier'),
}))

const timeline = useHistoryTimeline(h, toRef(props, 'posts'), locale, timelineLabels)
watch(commit.completionId, async () => {
  const document = timeline.selectedDocument.value
  if (!document || !commit.lastCommittedPaths.value.includes(`${document.path}.md`)) return
  await timeline.selectDocument(document)
})
watch(commit.repositoryChangeId, async () => {
  const document = timeline.selectedDocument.value
  if (document) await timeline.selectDocument(document)
})
watch(props.withdraw.completionId, async () => {
  closeRevisionMenu()
  const document = timeline.selectedDocument.value
  if (document) {
    await timeline.selectDocument(document)
    if (timeline.selectedDocument.value?.revisions.length === 0) timeline.showDocuments()
  }
  await nextTick()
  timelineHeading.value?.focus()
})
watch(() => timeline.selectedDocument.value?.path, () => closeRevisionMenu())
watch(timeline.revisionsLoading, () => closeRevisionMenu())
watch(() => h.log.value, () => closeRevisionMenu())
watch(props.withdraw.busy, (busy) => {
  if (busy) closeRevisionMenu()
})
const revisionsErrorLabel = computed(() => (
  timeline.revisionsError.value?.message || t('history.load_failed')
))
const logErrorLabel = computed(() => h.logError.value?.message || t('history.load_failed'))

function localeCode(): string {
  return locale.value === 'zh' ? 'zh-CN' : 'en-US'
}

function isSameDay(left: number, right: number): boolean {
  const a = new Date(left)
  const b = new Date(right)
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

function clockLabel(timestamp: number): string {
  return new Intl.DateTimeFormat(localeCode(), {
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function documentTimeLabel(timestamp: number): string {
  const now = Date.now()
  if (isSameDay(timestamp, now)) return clockLabel(timestamp)
  if (isSameDay(timestamp, now - 86_400_000)) {
    return `${t('history.yesterday')} ${clockLabel(timestamp)}`
  }
  return new Intl.DateTimeFormat(localeCode(), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function revisionSummary(revision: TimelineRevision): string {
  if (timeline.selectedDocument.value?.revisionCount === 1) return t('history.created')
  return revision.summary || t('history.updated')
}

function openRevision(revision: TimelineRevision): void {
  closeRevisionMenu()
  const document = timeline.selectedDocument.value
  if (!document) return
  timeline.selectRevision(revision)
  emit('open-revision', toHistoryRevisionSelection(document, revision))
}

function isLatestRevision(revision: TimelineRevision): boolean {
  return revision.id === h.log.value[0]?.sha
}

function closeRevisionMenu(restoreFocus = false): void {
  revisionMenuOpen.value = false
  revisionMenuRevision.value = null
  document.removeEventListener('pointerdown', onRevisionMenuOutside)
  document.removeEventListener('keydown', onRevisionMenuEscape)
  if (restoreFocus) revisionMenuOrigin?.focus()
  if (!restoreFocus) revisionMenuOrigin = null
}

function onRevisionMenuOutside(event: PointerEvent): void {
  if (!revisionMenu.value?.contains(event.target as Node)) closeRevisionMenu()
}

function onRevisionMenuEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.preventDefault()
  closeRevisionMenu(true)
}

async function showRevisionMenu(
  revision: TimelineRevision,
  origin: HTMLElement,
  x: number,
  y: number,
): Promise<void> {
  closeRevisionMenu()
  if (!isLatestRevision(revision) || !props.withdraw.canWithdraw.value || props.withdraw.busy.value) return
  revisionMenuRevision.value = revision
  revisionMenuOrigin = origin
  revisionMenuX.value = x
  revisionMenuY.value = y
  revisionMenuOpen.value = true
  await nextTick()
  const menu = revisionMenu.value
  if (!menu) return
  const gutter = 8
  revisionMenuX.value = Math.max(gutter, Math.min(x, window.innerWidth - menu.offsetWidth - gutter))
  revisionMenuY.value = Math.max(gutter, Math.min(y, window.innerHeight - menu.offsetHeight - gutter))
  menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  document.addEventListener('pointerdown', onRevisionMenuOutside)
  document.addEventListener('keydown', onRevisionMenuEscape)
}

function onRevisionContextMenu(event: MouseEvent, revision: TimelineRevision): void {
  event.preventDefault()
  void showRevisionMenu(revision, event.currentTarget as HTMLElement, event.clientX, event.clientY)
}

function onRevisionMenuKeydown(event: KeyboardEvent, revision: TimelineRevision): void {
  if (!(event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))) return
  event.preventDefault()
  const origin = event.currentTarget as HTMLElement
  const rect = origin.getBoundingClientRect()
  void showRevisionMenu(revision, origin, rect.left + Math.min(24, rect.width / 2), rect.bottom)
}

function withdrawRevision(): void {
  const revision = revisionMenuRevision.value
  closeRevisionMenu()
  if (!revision || !isLatestRevision(revision) || !props.withdraw.canWithdraw.value || props.withdraw.busy.value) return
  void props.withdraw.withdraw(revision.id)
}

onBeforeUnmount(closeRevisionMenu)

async function selectDocument(document: DocumentHistory): Promise<void> {
  await timeline.selectDocument(document)
  if (timeline.selectedDocument.value?.path !== document.path) return
  await nextTick()
  focusFirstOption()
}

function showDocuments(): void {
  timeline.showDocuments()
  void nextTick(focusFirstOption)
}

function focusFirstOption(): void {
  listbox.value?.querySelector<HTMLElement>('[role="option"]')?.focus()
}

function onListKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    if (timeline.selectedDocument.value) showDocuments()
    else (document.activeElement as HTMLElement | null)?.blur()
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return

  const options = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="option"]')]
  if (options.length === 0) return
  event.preventDefault()
  const current = options.indexOf(document.activeElement as HTMLElement)
  const next = event.key === 'ArrowDown'
    ? Math.min(current + 1, options.length - 1)
    : Math.max(current < 0 ? options.length - 1 : current - 1, 0)
  options[next]?.focus()
}
</script>

<template>
  <section class="history-panel" :aria-label="t('history.title')">
    <header class="history-header">
      <button
        v-if="timeline.selectedDocument.value"
        type="button"
        class="history-back-button"
        :title="t('history.back_to_documents')"
        :aria-label="t('history.back_to_documents')"
        @click="showDocuments"
      >
        <span v-html="ICON_CHEVRON" />
      </button>
      <span class="history-title">{{ t('history.title') }}</span>
    </header>

    <div v-if="h.capability.value && !h.capability.value.gitAvailable" class="history-empty">
      <EmptyState size="compact" :title="t('history.git_unavailable')">
        {{ t('history.git_unavailable_body') }}
      </EmptyState>
    </div>
    <div v-else-if="h.capability.value && !h.capability.value.repoInitialized" class="history-empty">
      <EmptyState size="compact" :title="h.capability.value.initError ? t('history.vault_git_unavailable') : t('history.initializing')">
        <template v-if="h.capability.value.initError">{{ h.capability.value.initError }}</template>
      </EmptyState>
    </div>

    <template v-else>
      <HistoryChangesPanel
        :entries="h.status.value"
        :selected-paths="commit.selectedPaths.value"
        :message="commit.message.value"
        :busy="commit.busy.value"
        :mutation-locked="props.withdraw.busy.value"
        :can-commit="commit.canCommit.value"
        :error="commit.error.value"
        :index-repair-pending="commit.indexRepairPaths.value.length > 0"
        :index-repair-busy="commit.indexRepairBusy.value"
        :index-repair-conflict="commit.indexRepairConflictToken.value !== null"
        @toggle="commit.toggle"
        @select-all="commit.selectAll"
        @clear-selection="commit.clearSelection"
        @update:message="commit.message.value = $event"
        @submit="commit.submit"
        @repair-index="commit.retryIndexRepair"
        @discard-index-repair="commit.discardConflictingIndexRepair"
      />
      <div ref="timelineHeading" class="history-timeline-heading" tabindex="-1">{{ t('history.timeline') }}</div>
      <div v-if="h.logError.value && !timeline.selectedDocument.value" class="history-error" role="alert">
        <span>{{ logErrorLabel }}</span>
        <button type="button" @click="h.refreshLog()">
          {{ t('history.retry') }}
        </button>
      </div>
      <div v-if="timeline.selectedDocument.value" class="history-document-header">
        <span class="history-document-header-icon" v-html="ICON_FILE_MD" />
        <span class="history-document-header-copy">
          <strong>{{ timeline.selectedDocument.value.title }}</strong>
          <span>{{ t('history.revisions', { count: timeline.selectedDocument.value.revisionCount }) }}</span>
        </span>
      </div>

      <div
        ref="listbox"
        class="history-timeline-scroll"
        role="listbox"
        :aria-label="timeline.selectedDocument.value ? t('history.revision_list') : t('history.document_list')"
        @keydown="onListKeydown"
      >
        <template v-if="timeline.selectedDocument.value">
          <div v-if="timeline.revisionsLoading.value" class="history-skeleton" role="status" :aria-label="t('history.loading')">
            <span v-for="index in 5" :key="index" class="history-skeleton-row" />
          </div>
          <div v-else-if="timeline.revisionsError.value" class="history-error" role="alert">
            <span>{{ revisionsErrorLabel }}</span>
            <button type="button" @click="timeline.retrySelectedDocument">
              {{ t('history.retry') }}
            </button>
          </div>
          <div
            v-else-if="timeline.selectedDocument.value.revisions.length === 0"
            class="history-empty-inline"
          >
            {{ t('history.no_revisions') }}
          </div>
          <template v-else>
            <TimelineGroup
              v-for="group in timeline.revisionGroups.value"
              :key="group.key"
              :label="group.label"
            >
              <template v-for="revision in group.items" :key="revision.id">
                <TimelineRevisionRow
                  :revision="revision"
                  :summary="revisionSummary(revision)"
                  :time-label="clockLabel(revision.modifiedAt)"
                  :selected="timeline.selectedRevisionId.value === revision.id"
                  @select="openRevision"
                  @contextmenu="onRevisionContextMenu($event, revision)"
                  @keydown="onRevisionMenuKeydown($event, revision)"
                />
              </template>
            </TimelineGroup>
          </template>
        </template>

        <template v-else-if="timeline.loading.value">
          <div class="history-skeleton" role="status" :aria-label="t('history.loading')">
            <span v-for="index in 7" :key="index" class="history-skeleton-row" />
          </div>
        </template>
        <template v-else-if="h.logLoading.value && timeline.documents.value.length === 0">
          <div class="history-skeleton" role="status" :aria-label="t('history.loading')">
            <span v-for="index in 7" :key="index" class="history-skeleton-row" />
          </div>
        </template>
        <div
          v-else-if="timeline.documents.value.length === 0 && !h.logError.value"
          class="history-empty-inline"
        >
          {{ t('history.no_history') }}
        </div>
        <template v-else>
          <TimelineGroup
            v-for="group in timeline.documentGroups.value"
            :key="group.key"
            :label="group.label"
          >
            <TimelineDocumentRow
              v-for="document in group.items"
              :key="document.path"
              :document="document"
              :time-label="documentTimeLabel(document.modifiedAt)"
              @select="selectDocument"
            />
          </TimelineGroup>
        </template>
      </div>
      <Teleport to="body">
        <div
          v-if="revisionMenuOpen"
          ref="revisionMenu"
          class="history-context-menu"
          role="menu"
          :aria-label="t('history.version_actions')"
          :style="{ left: revisionMenuX + 'px', top: revisionMenuY + 'px' }"
        >
          <button type="button" role="menuitem" class="danger" @click="withdrawRevision">
            {{ t('history.withdraw_latest') }}
          </button>
        </div>
      </Teleport>
    </template>
  </section>
</template>
