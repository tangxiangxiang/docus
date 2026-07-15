<script setup lang="ts">
import { computed, nextTick, ref, toRef } from 'vue'
import type { PostSummary } from '../../lib/api'
import { useHistory } from '../../composables/vault/useHistory'
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
import TimelineDocumentRow from './TimelineDocumentRow.vue'
import TimelineGroup from './TimelineGroup.vue'
import TimelineRevisionRow from './TimelineRevisionRow.vue'

const props = withDefaults(defineProps<{
  posts?: PostSummary[]
}>(), {
  posts: () => [],
})
const emit = defineEmits<{
  'open-revision': [selection: HistoryRevisionSelection]
}>()

const h = useHistory()
const { locale, t } = useI18n()
const listbox = ref<HTMLElement | null>(null)

const timelineLabels = computed(() => ({
  today: t('history.today'),
  yesterday: t('history.yesterday'),
  lastWeek: t('history.last_week'),
  earlier: t('history.earlier'),
}))

const timeline = useHistoryTimeline(h, toRef(props, 'posts'), locale, timelineLabels)
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
  const document = timeline.selectedDocument.value
  if (!document) return
  timeline.selectRevision(revision)
  emit('open-revision', toHistoryRevisionSelection(document, revision))
}

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
          <div v-if="timeline.revisionsLoading.value" class="history-skeleton" :aria-label="t('history.loading')">
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
              <TimelineRevisionRow
                v-for="revision in group.items"
                :key="revision.id"
                :revision="revision"
                :summary="revisionSummary(revision)"
                :time-label="clockLabel(revision.modifiedAt)"
                :selected="timeline.selectedRevisionId.value === revision.id"
                @select="openRevision"
              />
            </TimelineGroup>
          </template>
        </template>

        <template v-else-if="timeline.loading.value">
          <div class="history-skeleton" :aria-label="t('history.loading')">
            <span v-for="index in 7" :key="index" class="history-skeleton-row" />
          </div>
        </template>
        <template v-else-if="h.logLoading.value && timeline.documents.value.length === 0">
          <div class="history-skeleton" :aria-label="t('history.loading')">
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
    </template>
  </section>
</template>
