<script setup lang="ts">
import { computed, ref } from 'vue'
import type { HistoryComparison } from '../../composables/vault/useHistoryComparisons'
import { useI18n } from '../../composables/useI18n'
import SideBySideDiff from './SideBySideDiff.vue'
import { formatHistoryDate } from '../../lib/history-date'

const props = defineProps<{
  comparison: HistoryComparison
  restoring?: boolean
}>()

const emit = defineEmits<{
  'view-historical': [comparison: HistoryComparison]
  'view-current': [path: string]
  restore: [comparison: HistoryComparison]
  retry: [tabId: string]
  close: [tabId: string]
}>()

const { locale, t } = useI18n()
const headingRef = ref<HTMLElement | null>(null)

const revisionTimeLabel = computed(() => formatHistoryDate(props.comparison.revisionTime, locale.value))

const errorLabel = computed(() => (
  props.comparison.error || t('history.comparison_load_failed')
))

function focusViewer(): void {
  headingRef.value?.focus()
}

defineExpose({ focusViewer })
</script>

<template>
  <section
    class="history-comparison-pane"
    :aria-label="t('history.comparison_viewer')"
    :aria-busy="restoring || undefined"
  >
    <header class="history-viewer-header history-comparison-header">
      <div class="history-viewer-heading history-comparison-heading">
        <h2 ref="headingRef" tabindex="-1">{{ t('history.comparing_current') }}</h2>
        <span>{{ comparison.documentTitle }}</span>
      </div>
      <span class="history-readonly-badge">{{ t('history.read_only') }}</span>
      <div class="history-snapshot-toolbar" role="toolbar" :aria-label="t('history.comparison_toolbar')">
        <button
          type="button"
          class="history-restore-button"
          :disabled="comparison.status !== 'ready' || restoring"
          @click="emit('restore', comparison)"
        >
          {{ restoring ? t('history.restoring') : t('history.restore_version') }}
        </button>
        <button type="button" @click="emit('view-historical', comparison)">
          {{ t('history.view_historical') }}
        </button>
        <button type="button" @click="emit('view-current', comparison.documentPath)">
          {{ t('history.view_current') }}
        </button>
        <button type="button" @click="emit('close', comparison.tabId)">
          {{ t('history.close_diff') }}
        </button>
      </div>
    </header>

    <div class="history-viewer-meta history-comparison-meta">
      <span>{{ t('history.historical_version') }} · {{ revisionTimeLabel }}</span>
      <span v-if="comparison.summary" class="history-snapshot-summary">{{ comparison.summary }}</span>
      <span class="history-comparison-current" :class="{ 'is-dirty': comparison.currentDirty }">
        {{ t('history.current_version') }} ·
        {{ comparison.currentDirty ? t('history.current_unsaved') : t('history.current_saved') }}
      </span>
    </div>

    <div v-if="comparison.status === 'loading'" class="history-snapshot-state" role="status">
      {{ t('history.loading_comparison') }}
    </div>
    <div
      v-else-if="comparison.status === 'error'"
      class="history-snapshot-state history-viewer-error is-error"
      role="alert"
    >
      <span>{{ errorLabel }}</span>
      <button type="button" @click="emit('retry', comparison.tabId)">
        {{ t('history.retry') }}
      </button>
    </div>
    <div
      v-else-if="!comparison.diff || comparison.diff.ops.length === 0"
      class="history-snapshot-state"
    >
      {{ t('history.no_comparison_changes') }}
    </div>
    <SideBySideDiff
      v-else
      :diff="comparison.diff"
      :old-label="t('history.historical_version')"
      :new-label="t('history.current_version')"
    />
  </section>
</template>
