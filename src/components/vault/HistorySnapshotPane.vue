<script setup lang="ts">
import { computed, ref } from 'vue'
import type { HistorySnapshot } from '../../composables/vault/useHistorySnapshots'
import { useI18n } from '../../composables/useI18n'
import type { Resolver as WikiResolver } from '../../lib/wikiLinks'
import ReadingPane from './ReadingPane.vue'
import { formatHistoryDate } from '../../lib/history-date'

const props = defineProps<{
  snapshot: HistorySnapshot
  resolver?: WikiResolver
  restoring?: boolean
  mutationLocked?: boolean
}>()

const emit = defineEmits<{
  'view-current': [path: string]
  'open-diff': [snapshot: HistorySnapshot]
  restore: [snapshot: HistorySnapshot]
  retry: [tabId: string]
  close: [tabId: string]
}>()

const { locale, t } = useI18n()
const headingRef = ref<HTMLElement | null>(null)

const revisionTimeLabel = computed(() => formatHistoryDate(props.snapshot.revisionTime, locale.value))

const errorLabel = computed(() => props.snapshot.error || t('history.snapshot_load_failed'))

function focusViewer(): void {
  headingRef.value?.focus()
}

defineExpose({ focusViewer })
</script>

<template>
  <section
    class="history-snapshot-pane"
    :aria-label="t('history.snapshot_viewer')"
    :aria-busy="restoring || undefined"
  >
    <header class="history-viewer-header history-snapshot-banner">
      <div class="history-viewer-heading history-snapshot-notice" role="status">
        <h2 ref="headingRef" tabindex="-1">{{ t('history.viewing_historical') }}</h2>
        <span>{{ t('history.current_unchanged') }}</span>
      </div>
      <span class="history-readonly-badge">{{ t('history.read_only') }}</span>
      <div class="history-snapshot-toolbar" role="toolbar" :aria-label="t('history.snapshot_toolbar')">
        <button
          type="button"
          class="history-restore-button"
          :disabled="snapshot.status !== 'ready' || restoring || mutationLocked"
          @click="emit('restore', snapshot)"
        >
          {{ restoring ? t('history.restoring') : t('history.restore_version') }}
        </button>
        <button
          type="button"
          :disabled="snapshot.status !== 'ready'"
          @click="emit('open-diff', snapshot)"
        >
          {{ t('history.open_diff') }}
        </button>
        <button type="button" @click="emit('view-current', snapshot.documentPath)">
          {{ t('history.view_current') }}
        </button>
        <button type="button" @click="emit('close', snapshot.tabId)">
          {{ t('history.close_history') }}
        </button>
      </div>
    </header>

    <div class="history-viewer-meta history-snapshot-meta">
      <span>{{ t('history.viewing_revision') }} · {{ revisionTimeLabel }}</span>
      <span v-if="snapshot.summary" class="history-snapshot-summary">{{ snapshot.summary }}</span>
    </div>

    <div
      v-if="snapshot.status === 'loading'"
      class="history-snapshot-state"
      role="status"
    >
      {{ t('history.loading_revision') }}
    </div>
    <div
      v-else-if="snapshot.status === 'error'"
      class="history-snapshot-state history-viewer-error is-error"
      role="alert"
    >
      <span>{{ errorLabel }}</span>
      <button type="button" @click="emit('retry', snapshot.tabId)">
        {{ t('history.retry') }}
      </button>
    </div>
    <ReadingPane
      v-else
      :raw="snapshot.rawMarkdown"
      :resolver="resolver"
    />
  </section>
</template>
