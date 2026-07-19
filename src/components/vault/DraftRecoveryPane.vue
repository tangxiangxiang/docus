<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DraftRecoveryTab } from '../../composables/vault/draft-recovery/useDraftRecoveryTabs'
import { computeFileDiff } from '../../lib/file-diff'
import { useI18n } from '../../composables/useI18n'
import ReadingPane from './ReadingPane.vue'
import SideBySideDiff from './SideBySideDiff.vue'

const props = defineProps<{ recovery: DraftRecoveryTab }>()
const emit = defineEmits<{
  'update-view': [view: 'content' | 'diff']
  'view-current': [recoveryId: string]
  discard: [recoveryId: string]
  close: [tabId: string]
}>()
const { t } = useI18n()
const heading = ref<HTMLElement | null>(null)
const diff = computed(() =>
  props.recovery.diskRaw === null
    ? null
    : computeFileDiff(props.recovery.diskRaw, props.recovery.draftRaw),
)
function focusViewer(): void {
  heading.value?.focus()
}
defineExpose({ focusViewer })
</script>

<template>
  <section class="draft-recovery-pane" :aria-label="t('draft_recovery.viewer')">
    <header class="history-viewer-header">
      <div class="history-viewer-heading">
        <h2 ref="heading" tabindex="-1">
          {{ t('draft_recovery.recovered_title', { title: recovery.documentTitle }) }}
        </h2>
        <span>{{ t('draft_recovery.local_only') }}</span>
      </div>
      <span class="history-readonly-badge">{{ t('history.read_only') }}</span>
      <div class="history-snapshot-toolbar" role="toolbar" :aria-label="t('draft_recovery.toolbar')">
        <button
          v-if="recovery.canViewDiff && recovery.view !== 'diff'"
          type="button"
          @click="emit('update-view', 'diff')"
        >
          {{ t('draft_recovery.view_diff') }}
        </button>
        <button
          v-if="recovery.view !== 'content'"
          type="button"
          @click="emit('update-view', 'content')"
        >
          {{ t('draft_recovery.open_content') }}
        </button>
        <button
          v-if="recovery.canViewCurrent"
          type="button"
          @click="emit('view-current', recovery.recoveryId)"
        >
          {{ t('draft_recovery.view_current') }}
        </button>
        <button type="button" @click="emit('discard', recovery.recoveryId)">
          {{ recovery.diskRaw === null ? t('draft_recovery.discard') : t('draft_recovery.use_disk') }}
        </button>
        <button type="button" @click="emit('close', recovery.tabId)">
          {{ t('draft_recovery.close') }}
        </button>
      </div>
    </header>
    <div class="history-viewer-meta">
      {{ recovery.documentPath }} · {{ t('draft_recovery.read_only') }}
    </div>
    <SideBySideDiff
      v-if="recovery.view === 'diff' && diff"
      :diff="diff"
      :old-label="t('draft_recovery.disk_version')"
      :new-label="t('draft_recovery.unsaved_draft')"
    />
    <ReadingPane v-else :raw="recovery.draftRaw" />
  </section>
</template>
