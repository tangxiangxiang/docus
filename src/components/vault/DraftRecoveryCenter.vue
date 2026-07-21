<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../composables/useI18n'
import {
  recoveryRecordId,
  type DraftCapacitySnapshot,
  type RecoveryRecordRef,
} from '../../composables/vault/draft-recovery/draftCleanup'
import type { DraftRecoveryItem } from '../../composables/vault/draft-recovery/useUnsavedDraftRecovery'

const props = defineProps<{
  records: readonly RecoveryRecordRef[]
  items: readonly DraftRecoveryItem[]
  capacity: DraftCapacitySnapshot
  unsupportedCount: number
  selectedIds: ReadonlySet<string>
  protectedIds: ReadonlySet<string>
  loading: boolean
  error: string | null
}>()

const emit = defineEmits<{
  refresh: []
  cleanup: []
  'delete-selected': []
  'delete-all': []
  toggle: [recoveryId: string]
  open: [recoveryId: string]
  retry: [recoveryId: string]
  delete: [recoveryId: string]
}>()

const { t } = useI18n()
const itemsById = computed(() => new Map(props.items.map((item) => [item.recoveryId, item])))
const orphanCount = computed(() => props.items.filter((item) => (
  item.decision?.kind === 'missing-source' || item.decision?.kind === 'identity-mismatch'
)).length)

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function decisionLabel(id: string): string {
  const item = itemsById.value.get(id)
  if (!item) return t('draft_recovery.center.unclassified')
  if (item.status === 'error') return t('draft_recovery.center.classification_error')
  return t(`draft_recovery.center.decision.${item.decision?.kind ?? 'unknown'}`)
}
</script>

<template>
  <section class="recovery-center" :aria-busy="loading">
    <header>
      <h2>{{ t('draft_recovery.center.title') }}</h2>
      <p>{{ t('draft_recovery.center.local_only') }}</p>
    </header>

    <dl class="recovery-summary">
      <div><dt>{{ t('draft_recovery.center.records') }}</dt><dd>{{ capacity.recordCount }} / {{ capacity.recordLimit }}</dd></div>
      <div><dt>{{ t('draft_recovery.center.storage') }}</dt><dd>{{ formatBytes(capacity.contentBytes) }} / {{ formatBytes(capacity.contentByteLimit) }}</dd></div>
      <div><dt>{{ t('draft_recovery.center.orphans') }}</dt><dd>{{ orphanCount }}</dd></div>
      <div><dt>{{ t('draft_recovery.center.unsupported') }}</dt><dd>{{ unsupportedCount }}</dd></div>
    </dl>
    <p v-if="capacity.overCapacity" class="warning" role="alert">{{ t('draft_recovery.center.over_capacity') }}</p>
    <p v-if="error" class="warning" role="alert">{{ t('draft_recovery.center.load_failed') }}</p>

    <div class="recovery-toolbar">
      <button type="button" @click="emit('refresh')">{{ t('draft_recovery.center.refresh') }}</button>
      <button type="button" @click="emit('cleanup')">{{ t('draft_recovery.center.cleanup') }}</button>
      <button type="button" :disabled="selectedIds.size === 0" @click="emit('delete-selected')">{{ t('draft_recovery.center.delete_selected') }}</button>
      <button type="button" :disabled="records.length === 0" @click="emit('delete-all')">{{ t('draft_recovery.center.delete_all') }}</button>
    </div>

    <p v-if="loading" role="status">{{ t('draft_recovery.center.loading') }}</p>
    <p v-else-if="records.length === 0" class="empty">{{ t('draft_recovery.center.empty') }}</p>
    <ul v-else class="recovery-list">
      <li v-for="entry in records" :key="recoveryRecordId(entry)">
        <input
          type="checkbox"
          :aria-label="t('draft_recovery.center.select_record', { path: entry.record.documentPath })"
          :checked="selectedIds.has(recoveryRecordId(entry))"
          :disabled="protectedIds.has(recoveryRecordId(entry))"
          @change="emit('toggle', recoveryRecordId(entry))"
        >
        <div class="record-main">
          <strong>{{ entry.record.documentPath }}</strong>
          <span class="record-meta">
            {{ entry.source === 'primary' ? t('draft_recovery.center.primary') : t('draft_recovery.center.conflict') }}
            · {{ decisionLabel(recoveryRecordId(entry)) }}
            · {{ formatBytes(entry.bytes) }}
            · {{ new Date(entry.record.updatedAt).toLocaleString() }}
          </span>
          <span v-if="protectedIds.has(recoveryRecordId(entry))" class="in-use">{{ t('draft_recovery.center.in_use') }}</span>
        </div>
        <div class="record-actions">
          <button type="button" @click="emit('open', recoveryRecordId(entry))">{{ t('draft_recovery.center.open') }}</button>
          <button type="button" @click="emit('retry', recoveryRecordId(entry))">{{ t('draft_recovery.center.retry') }}</button>
          <button type="button" :disabled="protectedIds.has(recoveryRecordId(entry))" @click="emit('delete', recoveryRecordId(entry))">{{ t('draft_recovery.center.delete') }}</button>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.recovery-center { height: 100%; overflow: auto; padding: 14px; color: var(--text-primary); }
.recovery-center h2 { margin: 0 0 4px; font-size: 15px; }
.recovery-center p { margin: 4px 0 12px; color: var(--text-secondary); font-size: 12px; }
.recovery-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0; }
.recovery-summary div { padding: 8px; background: var(--bg-secondary); border-radius: 4px; }
.recovery-summary dt { color: var(--text-secondary); font-size: 11px; }
.recovery-summary dd { margin: 2px 0 0; font-size: 12px; }
.recovery-toolbar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
button { font: inherit; }
.recovery-list { list-style: none; margin: 0; padding: 0; }
.recovery-list li { display: flex; align-items: flex-start; gap: 8px; padding: 10px 0; border-top: 1px solid var(--border); }
.record-main { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; }
.record-main strong { overflow-wrap: anywhere; font-size: 12px; }
.record-meta, .in-use { color: var(--text-secondary); font-size: 11px; }
.record-actions { display: flex; flex-direction: column; gap: 4px; }
.warning { color: var(--warning, #b7791f) !important; }
.empty { text-align: center; padding: 24px 0; }
</style>
