<script setup lang="ts">
import { computed } from 'vue'
import type { DocumentSavePresentation } from '../../composables/vault/editor-tabs/savePresentation'
import type { ExternalChangeKind } from './tabs'
import {
  ICON_STATUS_ERROR,
  ICON_STATUS_LOADING,
  ICON_STATUS_MODIFIED,
  ICON_STATUS_OFFLINE,
  ICON_STATUS_SUCCESS,
} from './icons'
import { useI18n } from '../../composables/useI18n'

const props = defineProps<{
  path: string | null
  save: DocumentSavePresentation
  error: string | null
  size: number
  focusWidth: boolean
  externalKind?: ExternalChangeKind | null
}>()
const emit = defineEmits<{
  'toggle-focus-width': []
  'retry-save': []
  'copy-content': []
  'external-diff': []
  'external-disk': []
  'external-local': []
}>()
const { t } = useI18n()

// Status icon. Each presentation status maps to one of the ICON_STATUS_*
// glyphs (or no glyph for "idle"). The glyph renders inline next
// to the text label via v-html.
const statusIcon = computed<string>(() => {
  switch (props.save.status) {
    case 'dirty':    return ICON_STATUS_MODIFIED
    case 'saving':   return ICON_STATUS_LOADING
    case 'saving-dirty': return ICON_STATUS_LOADING
    case 'saved':    return ICON_STATUS_SUCCESS
    case 'error':    return ICON_STATUS_ERROR
    case 'offline':  return ICON_STATUS_OFFLINE
    case 'external': return ICON_STATUS_MODIFIED
    default:         return ''
  }
})

const statusLabel = computed(() => {
  if (!props.path) return '—'
  if (props.save.status === 'saving') return t('status.saving')
  if (props.save.status === 'saving-dirty') return t('status.saving_dirty')
  if (props.save.status === 'dirty') return t('status.unsaved')
  if (props.save.status === 'saved') return t('status.saved')
  if (props.save.status === 'error') return props.error ?? t('status.error')
  if (props.save.status === 'offline') return t('status.offline')
  if (props.save.status === 'external') return t('status.external')
  return t('status.idle')
})

const sizeLabel = computed(() => {
  if (!props.size) return ''
  if (props.size < 1024) return `${props.size} B`
  return `${(props.size / 1024).toFixed(1)} KB`
})

// Path segments for the center group. Drops the .md extension from
// the leaf segment — it's an internal storage detail, not part of
// the document's identity. Rendered inline with `›`
// separators in a single text run so a single `text-overflow:
// ellipsis` on the wrapper handles long-path truncation.
const pathLabel = computed(() => {
  if (!props.path) return null
  const segs = props.path.split('/')
  const last = segs.length - 1
  if (last >= 0 && segs[last].endsWith('.md')) segs[last] = segs[last].slice(0, -3)
  return segs.join(' › ')
})
</script>

<template>
  <footer class="status-bar" :aria-label="t('status.label')">
    <div class="sb-left" aria-live="polite" aria-atomic="true">
      <!-- aria-live="polite" so screen readers hear the save state
           change ("Unsaved" → "Saving…" → "Saved") without being
           interrupted. aria-atomic="true" re-announces the whole
           status instead of just the diff. -->
      <button
        v-if="save.retryable"
        type="button"
        class="sb-item sb-status sb-status-retry"
        :data-status="save.status"
        :title="t('status.retry_title', { status: statusLabel })"
        :aria-label="t('status.retry')"
        @click="emit('retry-save')"
      >
        <span v-if="statusIcon" class="sb-status-glyph" v-html="statusIcon" aria-hidden="true" />
        {{ statusLabel }}
      </button>
      <span
        v-else
        class="sb-item sb-status"
        :data-status="save.status"
        :title="save.status === 'error' ? statusLabel : undefined"
      >
        <span v-if="statusIcon" class="sb-status-glyph" v-html="statusIcon" aria-hidden="true" />
        {{ statusLabel }}
      </span>
    </div>
    <!-- Center group carries the document path (formerly the
         breadcrumb row above the editor). It owns the flexible
         middle of the footer so the left save-status and the right
         size/format metadata never get squeezed. The chain
         ellipsizes from the right edge when the path is longer
         than the available width. -->
    <div class="sb-center" :aria-label="t('status.path')">
      <span v-if="pathLabel" class="sb-path" :title="pathLabel">{{ pathLabel }}</span>
      <span v-else class="sb-path sb-path-empty">—</span>
    </div>
    <div class="sb-right">
      <template v-if="save.status === 'external' && externalKind !== 'deleted'">
        <button type="button" class="sb-copy-content" :title="t('status.external_diff')" :aria-label="t('status.external_diff')" @click="emit('external-diff')">⇄</button>
        <button type="button" class="sb-copy-content" :title="t('status.use_disk')" :aria-label="t('status.use_disk')" @click="emit('external-disk')">↓</button>
        <button type="button" class="sb-copy-content" :title="t('status.keep_local')" :aria-label="t('status.keep_local')" @click="emit('external-local')">↑</button>
      </template>
      <template v-else-if="save.status === 'external'">
        <button type="button" class="sb-copy-content" :title="t('status.external_diff')" :aria-label="t('status.external_diff')" @click="emit('external-diff')">&#8644;</button>
        <button type="button" class="sb-copy-content" :title="t('status.keep_local')" :aria-label="t('status.keep_local')" @click="emit('external-local')">&#8593;</button>
      </template>
      <button
        v-if="save.dirty || save.attention"
        type="button"
        class="sb-copy-content"
        :aria-label="t('status.copy_content')"
        :title="t('status.copy_content')"
        @click="emit('copy-content')"
      >⧉</button>
      <button
        type="button"
        class="sb-focus-width"
        :class="{ active: focusWidth }"
        :aria-pressed="focusWidth"
        :aria-label="t('status.toggle_focus')"
        :title="t(focusWidth ? 'status.full_width' : 'status.focus_width')"
        @click="emit('toggle-focus-width')"
      >⇔</button>
      <span class="sb-item">{{ t('status.markdown') }}</span>
      <span v-if="sizeLabel" class="sb-item">{{ sizeLabel }}</span>
    </div>
  </footer>
</template>

<style scoped>
/* Center group owns the flexible middle of the footer. `min-width: 0`
   is the critical bit — without it, flex children refuse to shrink
   below their intrinsic content width and overflow the footer.
   The .sb-path inline block inside lets text-overflow:ellipsis
   actually clip the run; flex containers themselves don't honor it. */
.sb-center {
  flex: 1 1 auto;
  min-width: 0;
  padding: 0 12px;
  font-size: 0.75rem;
  color: var(--vs-text-2, #aaa);
  user-select: none;
  overflow: hidden;
  display: flex;
  align-items: center;
}
.sb-path {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.sb-path-empty {
  font-style: italic;
  color: var(--vs-text-3, #888);
}
.sb-status-retry {
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.sb-status-glyph {
  display: inline-flex;
  align-items: center;
  vertical-align: -2px;
  margin-right: 3px;
  color: currentColor;
}
.sb-status-glyph :deep(svg) { display: block; }
.sb-focus-width, .sb-copy-content {
  width: 22px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--vs-text-3, #888);
  font: inherit;
  cursor: pointer;
}
.sb-focus-width:hover { background: var(--vs-hover-bg); color: var(--vs-text-1); }
.sb-focus-width.active { color: var(--vs-accent); }
</style>
