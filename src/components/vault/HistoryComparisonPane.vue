<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { HistoryComparison } from '../../composables/vault/useHistoryComparisons'
import { useI18n } from '../../composables/useI18n'
import HistoryUnifiedDiff from './HistoryUnifiedDiff.vue'
import { formatHistoryDate } from '../../lib/history-date'

const props = defineProps<{
  comparison: HistoryComparison
  restoring?: boolean
  mutationLocked?: boolean
}>()

const emit = defineEmits<{
  restore: [comparison: HistoryComparison]
  retry: [tabId: string]
}>()

const { locale, t } = useI18n()
const headingRef = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const menuButtonRef = ref<HTMLElement | null>(null)
const menuOpen = ref(false)

const revisionTimeLabel = computed(() => formatHistoryDate(props.comparison.revisionTime, locale.value))
const revisionLabel = computed(() => props.comparison.revisionId.slice(0, 7))
const comparisonKey = computed(() => `${props.comparison.documentPath}\0${props.comparison.revisionId}`)
const stats = computed(() => props.comparison.diff?.stats ?? null)
const canRestore = computed(() => (
  props.comparison.status === 'ready'
  && !props.restoring
  && !props.mutationLocked
))

const errorLabel = computed(() => (
  props.comparison.error || t('history.comparison_load_failed')
))

function focusViewer(): void {
  headingRef.value?.focus()
}

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) {
    void nextTick(() => {
      menuRef.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    })
    document.addEventListener('pointerdown', onMenuOutside)
    document.addEventListener('keydown', onMenuEscape)
  } else {
    closeMenu()
  }
}

function closeMenu(restoreFocus = false): void {
  menuOpen.value = false
  document.removeEventListener('pointerdown', onMenuOutside)
  document.removeEventListener('keydown', onMenuEscape)
  if (restoreFocus) menuButtonRef.value?.focus()
}

function onMenuOutside(event: PointerEvent): void {
  if (!menuRef.value?.contains(event.target as Node)
    && !menuButtonRef.value?.contains(event.target as Node)) {
    closeMenu()
  }
}

function onMenuEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.preventDefault()
  closeMenu(true)
}

function restore(): void {
  closeMenu()
  emit('restore', props.comparison)
}

function retry(): void {
  emit('retry', props.comparison.tabId)
}

defineExpose({ focusViewer })
watch(() => props.comparison.status, (status) => {
  if (status !== 'ready') closeMenu()
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onMenuOutside)
  document.removeEventListener('keydown', onMenuEscape)
})
</script>

<template>
  <section
    class="history-comparison-pane"
    :class="{ 'has-summary': Boolean(comparison.summary) }"
    :aria-label="t('history.comparison_viewer')"
    :aria-busy="restoring || undefined"
  >
    <header class="history-diff-header">
      <div class="history-diff-title">
        <h2 ref="headingRef" tabindex="-1">{{ comparison.documentTitle }}</h2>
        <span class="history-comparison-direction">
          <span class="history-revision-chip">{{ revisionLabel }}</span>
          <span aria-hidden="true">→</span>
          <span class="history-revision-chip">{{ t('history.working_tree') }}</span>
        </span>
      </div>
      <div class="history-diff-header-meta">
        <span v-if="stats" class="history-diff-stats" :aria-label="t('history.diff_stats', { added: stats.added, removed: stats.removed })">
          <span class="is-added">+{{ stats.added }}</span>
          <span class="is-removed">−{{ stats.removed }}</span>
        </span>
        <button
          v-if="comparison.status === 'ready'"
          ref="menuButtonRef"
          type="button"
          class="history-pane-menu-trigger"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
          :aria-label="t('history.more_actions')"
          @click="toggleMenu"
        >
          ⋯
        </button>
        <div
          v-if="menuOpen"
          ref="menuRef"
          class="history-pane-menu"
          role="menu"
          :aria-label="t('history.version_actions')"
        >
          <button
            type="button"
            role="menuitem"
            :disabled="!canRestore"
            @click="restore"
          >
            {{ t('history.restore_version_ellipsis') }}
          </button>
        </div>
      </div>
    </header>

    <div v-if="comparison.summary" class="history-diff-summary">
      <span class="history-diff-summary-text">{{ comparison.summary }}</span>
      <span class="history-diff-summary-date">· {{ revisionTimeLabel }}</span>
    </div>

    <div v-if="comparison.status === 'loading'" class="history-diff-state" role="status">
      {{ t('history.loading_comparison') }}
    </div>
    <div
      v-else-if="comparison.status === 'error'"
      class="history-diff-state history-diff-error is-error"
      role="alert"
    >
      <span>{{ errorLabel }}</span>
      <button type="button" @click="retry">
        {{ t('history.retry') }}
      </button>
    </div>
    <div
      v-else-if="!comparison.diff || comparison.diff.ops.length === 0"
      class="history-diff-state"
    >
      {{ t('history.no_comparison_changes') }}
    </div>
    <HistoryUnifiedDiff
      v-else
      :diff="comparison.diff"
      :comparison-key="comparisonKey"
    />
  </section>
</template>
