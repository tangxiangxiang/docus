<script setup lang="ts">
import { computed } from 'vue'
import type { HistorySnapshot } from '../../composables/vault/useHistorySnapshots'
import { useI18n } from '../../composables/useI18n'
import type { Resolver as WikiResolver } from '../../lib/wikiLinks'
import ReadingPane from './ReadingPane.vue'

const props = defineProps<{
  snapshot: HistorySnapshot
  resolver?: WikiResolver
}>()

const emit = defineEmits<{
  'view-current': [path: string]
  'open-diff': [snapshot: HistorySnapshot]
  close: [tabId: string]
}>()

const { locale, t } = useI18n()

const revisionTimeLabel = computed(() => new Intl.DateTimeFormat(
  locale.value === 'zh' ? 'zh-CN' : 'en-US',
  { dateStyle: 'medium', timeStyle: 'short' },
).format(props.snapshot.revisionTime))

const errorLabel = computed(() => props.snapshot.error || t('history.snapshot_load_failed'))
</script>

<template>
  <section class="history-snapshot-pane" :aria-label="t('history.snapshot_viewer')">
    <header class="history-snapshot-banner">
      <div class="history-snapshot-notice" role="status">
        <strong>{{ t('history.viewing_historical') }}</strong>
        <span>{{ t('history.current_unchanged') }}</span>
      </div>
      <button
        type="button"
        class="history-snapshot-current"
        @click="emit('view-current', snapshot.documentPath)"
      >
        {{ t('history.view_current') }}
      </button>
    </header>

    <div class="history-snapshot-meta">
      <div class="history-snapshot-heading">
        <span>{{ t('history.viewing_revision') }}</span>
        <strong>{{ revisionTimeLabel }}</strong>
        <span v-if="snapshot.summary" class="history-snapshot-summary">{{ snapshot.summary }}</span>
      </div>
      <span class="history-readonly-badge">{{ t('history.read_only') }}</span>
      <div class="history-snapshot-toolbar" role="toolbar" :aria-label="t('history.snapshot_toolbar')">
        <button
          type="button"
          @click="emit('open-diff', snapshot)"
        >
          {{ t('history.open_diff') }}
        </button>
        <button type="button" @click="emit('close', snapshot.tabId)">
          {{ t('history.close_history') }}
        </button>
      </div>
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
      class="history-snapshot-state is-error"
      role="alert"
    >
      {{ errorLabel }}
    </div>
    <ReadingPane
      v-else
      :raw="snapshot.rawMarkdown"
      :resolver="resolver"
    />
  </section>
</template>
