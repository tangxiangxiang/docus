<script setup lang="ts">
import { computed } from 'vue'
import type { PostSummary } from '../../lib/api'
import type { StatusEntry } from '../../lib/history-api'
import { useI18n } from '../../composables/useI18n'

const props = withDefaults(defineProps<{
  entries: StatusEntry[]
  selectedPaths: Set<string>
  message: string
  busy: boolean
  mutationLocked?: boolean
  canCommit: boolean
  error: string | null
  posts?: PostSummary[]
  indexRepairPending?: boolean
  indexRepairBusy?: boolean
  indexRepairConflict?: boolean
}>(), {
  indexRepairPending: false,
  indexRepairBusy: false,
  indexRepairConflict: false,
  mutationLocked: false,
  posts: () => [],
})
const emit = defineEmits<{
  toggle: [path: string]
  'select-all': []
  'clear-selection': []
  'update:message': [value: string]
  submit: []
  'repair-index': []
  'discard-index-repair': []
}>()
const { t } = useI18n()
const allSelected = computed(() => (
  props.entries.length > 0 && props.entries.every((entry) => props.selectedPaths.has(entry.path))
))

function displayName(path: string): string {
  const name = path.split('/').pop() ?? path
  return name.endsWith('.md') ? name.slice(0, -3) : name
}

function displayTitle(path: string): string {
  const postPath = path.endsWith('.md') ? path.slice(0, -3) : path
  return props.posts.find((post) => post.path === postPath)?.title || displayName(path)
}

function statusKey(entry: StatusEntry): string {
  if (entry.index === '?' || entry.worktree === '?' || entry.index === 'A') return 'history.change_new'
  if (entry.index === 'D' || entry.worktree === 'D') return 'history.change_deleted'
  return 'history.change_modified'
}

function statusTone(entry: StatusEntry): 'new' | 'deleted' | 'modified' {
  if (entry.index === '?' || entry.worktree === '?' || entry.index === 'A') return 'new'
  if (entry.index === 'D' || entry.worktree === 'D') return 'deleted'
  return 'modified'
}

function onMessage(event: Event): void {
  emit('update:message', (event.target as HTMLTextAreaElement).value)
}

function toggleAll(): void {
  if (allSelected.value) emit('clear-selection')
  else emit('select-all')
}
</script>

<template>
  <section class="history-create-section" :aria-busy="busy || mutationLocked">
    <section class="history-changes" aria-labelledby="history-changes-title" :aria-busy="busy || mutationLocked">
      <header class="history-changes-header">
        <h2 id="history-changes-title">{{ t('history.changes') }}</h2>
        <span>{{ entries.length }}</span>
        <span class="history-changes-actions">
          <button type="button" :disabled="busy || mutationLocked || entries.length === 0" @click="toggleAll">
            {{ t(allSelected ? 'history.clear_selection' : 'history.select_all') }}
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
              :disabled="busy || mutationLocked"
              :aria-label="t('history.include_document', { path: entry.path })"
              @change="emit('toggle', entry.path)"
            >
            <span class="history-change-copy">
              <strong>{{ displayTitle(entry.path) }}</strong>
              <span :title="entry.path">{{ entry.path }}</span>
            </span>
            <span class="history-change-status" :class="`is-${statusTone(entry)}`">{{ t(statusKey(entry)) }}</span>
          </label>
        </li>
      </ul>
    </section>

    <section class="history-version-composer" :aria-label="t('history.version_message')">
      <textarea
        id="history-version-message"
        :aria-label="t('history.version_message')"
        :value="message"
        rows="2"
        :disabled="busy || mutationLocked"
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
        <span>{{ t(indexRepairConflict ? 'history.index_repair_conflict' : 'history.commit_index_refresh_failed') }}</span>
        <button v-if="!indexRepairConflict" type="button" :disabled="indexRepairBusy" @click="emit('repair-index')">
          {{ t('history.index_repair_action') }}
        </button>
        <button v-else type="button" :disabled="indexRepairBusy" @click="emit('discard-index-repair')">
          {{ t('history.index_repair_discard_action') }}
        </button>
      </div>
    </section>
  </section>
</template>
