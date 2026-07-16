<script setup lang="ts">
import type { StatusEntry } from '../../lib/history-api'
import { useI18n } from '../../composables/useI18n'

const props = withDefaults(defineProps<{
  entries: StatusEntry[]
  selectedPaths: Set<string>
  message: string
  busy: boolean
  canCommit: boolean
  error: string | null
  indexRepairPending?: boolean
  indexRepairBusy?: boolean
}>(), {
  indexRepairPending: false,
  indexRepairBusy: false,
})
const emit = defineEmits<{
  toggle: [path: string]
  'select-all': []
  'clear-selection': []
  'update:message': [value: string]
  submit: []
  'repair-index': []
}>()
const { t } = useI18n()

function displayName(path: string): string {
  const name = path.split('/').pop() ?? path
  return name.endsWith('.md') ? name.slice(0, -3) : name
}

function statusKey(entry: StatusEntry): string {
  if (entry.index === '?' || entry.worktree === '?' || entry.index === 'A') return 'history.change_new'
  if (entry.index === 'D' || entry.worktree === 'D') return 'history.change_deleted'
  return 'history.change_modified'
}

function onMessage(event: Event): void {
  emit('update:message', (event.target as HTMLTextAreaElement).value)
}
</script>

<template>
  <section class="history-changes" :aria-labelledby="'history-changes-title'" :aria-busy="busy">
    <header class="history-changes-header">
      <h2 id="history-changes-title">{{ t('history.changes') }}</h2>
      <span>{{ entries.length }}</span>
      <span class="history-changes-actions">
        <button type="button" :disabled="busy || entries.length === 0" @click="emit('select-all')">
          {{ t('history.select_all') }}
        </button>
        <button type="button" :disabled="busy || selectedPaths.size === 0" @click="emit('clear-selection')">
          {{ t('history.clear_selection') }}
        </button>
      </span>
    </header>

    <div v-if="entries.length === 0" class="history-changes-empty">
      {{ t('history.no_changed_documents') }}
    </div>
    <ul v-else class="history-changes-list" :aria-label="t('history.changed_document_list')">
      <li v-for="entry in entries" :key="entry.path" class="history-change-row">
        <label>
          <input
            type="checkbox"
            :checked="selectedPaths.has(entry.path)"
            :disabled="busy"
            :aria-label="t('history.include_document', { path: entry.path })"
            @change="emit('toggle', entry.path)"
          >
          <span class="history-change-copy">
            <strong>{{ displayName(entry.path) }}</strong>
            <span :title="entry.path">{{ entry.path }}</span>
          </span>
          <span class="history-change-status">{{ t(statusKey(entry)) }}</span>
        </label>
      </li>
    </ul>

    <div class="history-version-composer">
      <label for="history-version-message">{{ t('history.version_message') }}</label>
      <textarea
        id="history-version-message"
        :value="message"
        rows="2"
        :disabled="busy"
        :placeholder="t('history.version_message_placeholder')"
        @input="onMessage"
        @keydown.ctrl.enter.prevent="emit('submit')"
        @keydown.meta.enter.prevent="emit('submit')"
      />
      <div v-if="error" class="history-commit-error" role="alert">{{ error }}</div>
      <button
        type="button"
        class="history-create-version"
        :disabled="!canCommit"
        @click="emit('submit')"
      >
        {{ busy ? t('history.creating_version') : t('history.create_version') }}
      </button>
      <span v-if="busy" class="sr-only" role="status">{{ t('history.creating_version') }}</span>
      <div v-if="indexRepairPending" class="history-commit-error" role="status">
        <span>{{ t('history.commit_index_refresh_failed') }}</span>
        <button type="button" :disabled="indexRepairBusy" @click="emit('repair-index')">
          {{ t('history.index_repair_action') }}
        </button>
      </div>
    </div>
  </section>
</template>
