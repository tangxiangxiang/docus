<script setup lang="ts">
import { computed } from 'vue'
import { useHistory } from '../../composables/vault/useHistory.js'
import { useToast } from '../../composables/useToast.js'
import { useI18n } from '../../composables/useI18n.js'
import { WORKTREE_REF } from '../../lib/history-api.js'
import EmptyState from './EmptyState.vue'
import SideBySideDiff from './SideBySideDiff.vue'

const history = useHistory()
const toast = useToast()
const { t } = useI18n()

function refLabel(ref: string): string {
  if (ref === WORKTREE_REF) return t('diff.working_tree')
  const parent = ref.match(/^([0-9a-f]{7,40})~1$/i)
  if (parent) {
    const index = history.log.value.findIndex((commit) => commit.sha.startsWith(parent[1]))
    const parentCommit = index >= 0 ? history.log.value[index + 1] : undefined
    return parentCommit ? parentCommit.sha.slice(0, 7) : t('diff.empty')
  }
  return ref.slice(0, 7)
}

const canRestore = computed(() => (
  history.currentDiff.value?.ops.some((operation) => operation.oldLine !== null) ?? false
))
const stats = computed(() => (
  history.currentDiff.value?.stats ?? { added: 0, removed: 0, equal: 0 }
))
const hasDiff = computed(() => history.selectedFile.value !== null)

async function onRestore(): Promise<void> {
  const file = history.selectedFile.value
  const ref = history.selectedOldRef.value
  if (!file) return
  if (ref === WORKTREE_REF) {
    toast.error(t('diff.cannot_restore_worktree'))
    return
  }

  const label = refLabel(ref)
  const confirmed = typeof window !== 'undefined'
    && window.confirm(t('diff.restore_confirm', { file, label }))
  if (!confirmed) return

  const restored = await history.restoreFile(file, ref)
  if (restored) {
    toast.success(t('diff.restore_success', { file, label }))
  } else {
    toast.error(t('diff.restore_failed', {
      error: history.actionError.value ?? t('common.unknown_error'),
    }))
  }
}
</script>

<template>
  <section class="diff-view" :aria-label="t('diff.title')" :aria-busy="history.busy.value">
    <div v-if="!hasDiff" class="diff-empty">
      <EmptyState size="compact" :title="t('diff.no_file_selected')">
        {{ t('diff.pick_file') }}
      </EmptyState>
    </div>

    <template v-else>
      <header class="diff-header">
        <div class="diff-path">{{ history.selectedFile.value }}</div>
        <div class="diff-stats">
          <span class="diff-stat-add">+{{ stats.added }}</span>
          <span class="diff-stat-del">-{{ stats.removed }}</span>
          <span class="diff-stat-eq">{{ t('diff.unchanged', { count: stats.equal }) }}</span>
        </div>
        <div class="diff-refs">
          <span class="diff-ref">{{ refLabel(history.selectedOldRef.value) }}</span>
          <span class="diff-ref-sep">→</span>
          <span class="diff-ref">{{ refLabel(history.selectedNewRef.value) }}</span>
        </div>
        <div class="diff-actions">
          <button
            v-if="canRestore && history.selectedOldRef.value !== WORKTREE_REF"
            class="diff-restore-btn"
            :disabled="history.busy.value"
            :title="t('diff.overwrite_title', { file: history.selectedFile.value ?? '', label: refLabel(history.selectedOldRef.value) })"
            @click="onRestore"
          >{{ t('diff.restore_old') }}</button>
        </div>
      </header>

      <div v-if="history.busy.value && !history.currentDiff.value" class="diff-loading">
        <span class="diff-loading-indicator" aria-hidden="true" />
        {{ t('diff.loading') }}
      </div>
      <div
        v-else-if="history.diffError.value && !history.currentDiff.value"
        class="diff-empty diff-error"
        role="alert"
      >
        <EmptyState size="compact" :title="t('diff.unable')">
          {{ history.diffError.value }}
        </EmptyState>
      </div>
      <div v-else-if="(history.currentDiff.value?.ops.length ?? 0) === 0" class="diff-empty">
        <EmptyState size="compact" :title="t('diff.no_changes')">
          {{ t('diff.identical') }}
        </EmptyState>
      </div>
      <SideBySideDiff
        v-else-if="history.currentDiff.value"
        :diff="history.currentDiff.value"
        :old-label="t('diff.old')"
        :new-label="t('diff.new')"
        :old-ref="refLabel(history.selectedOldRef.value)"
        :new-ref="refLabel(history.selectedNewRef.value)"
      />
    </template>
  </section>
</template>
